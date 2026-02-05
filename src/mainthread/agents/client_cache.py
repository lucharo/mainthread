"""Session-based client caching for Claude SDK.

Caches clients by thread session to reduce subprocess spawn overhead
for sequential messages to the same thread.
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

logger = logging.getLogger(__name__)


@dataclass
class CachedClient:
    """A cached Claude SDK client with metadata."""

    client: ClaudeSDKClient
    thread_id: str
    session_id: str | None
    created_at: float
    last_used: float
    options_hash: str  # Hash of config to detect changes
    in_use: int = field(default=0)  # Reference count to prevent eviction while active


def _hash_options(options: ClaudeAgentOptions) -> str:
    """Create a simple hash of options to detect config changes."""
    # Key fields that would require a new client
    key_parts = [
        str(options.model),
        str(options.permission_mode),
        str(options.cwd),
        str(options.resume),  # session_id
    ]
    return ":".join(key_parts)


class SessionClientCache:
    """Cache clients by thread session for reuse within conversations.

    Benefits:
    - Reduces subprocess spawn latency for sequential messages
    - Keeps connections warm for active threads

    Limitations:
    - Each cached client = ~50-100MB RAM
    - Different thread configs cannot share clients
    - Must handle stale clients gracefully

    Thread Safety:
    - All cache mutations are protected by _lock
    - Reference counting prevents eviction of in-use clients
    """

    def __init__(
        self,
        max_cached: int | None = None,
        ttl_seconds: float | None = None,
        enabled: bool | None = None,
    ):
        # CACHE_ENABLED defaults to false: client caching currently loses conversation
        # context between turns (cache key changes from "thread:new" to "thread:session_id").
        # TODO: Re-enable by default once session-aware caching is implemented.
        self._enabled = enabled if enabled is not None else os.getenv("CACHE_ENABLED", "false").lower() == "true"
        self._max_cached = max_cached or int(os.getenv("CACHE_MAX_CLIENTS", "5"))
        self._ttl = ttl_seconds or float(os.getenv("CACHE_TTL_SECONDS", "300"))

        self._cache: dict[str, CachedClient] = {}
        self._lock = asyncio.Lock()
        self._shutdown = False

        # Stats for monitoring (protected by lock)
        self._hits = 0
        self._misses = 0

        logger.info(
            f"SessionClientCache initialized: enabled={self._enabled}, max_cached={self._max_cached}, ttl={self._ttl}s"
        )

    @property
    def stats(self) -> dict[str, Any]:
        """Get cache statistics."""
        return {
            "enabled": self._enabled,
            "cached_clients": len(self._cache),
            "max_cached": self._max_cached,
            "ttl_seconds": self._ttl,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": self._hits / (self._hits + self._misses) if (self._hits + self._misses) > 0 else 0,
        }

    async def startup(self) -> None:
        """Initialize cache (placeholder for future pre-warming)."""
        self._shutdown = False
        logger.info("SessionClientCache started")

    async def shutdown(self) -> None:
        """Close all cached clients gracefully."""
        self._shutdown = True
        logger.info(f"SessionClientCache shutting down, closing {len(self._cache)} cached clients")

        async with self._lock:
            for cache_key, cached in list(self._cache.items()):
                try:
                    logger.debug(f"Closing cached client: {cache_key}")
                    await cached.client.__aexit__(None, None, None)
                except Exception as e:
                    logger.warning(f"Error closing cached client {cache_key}: {e}")
            self._cache.clear()

        logger.info("SessionClientCache shutdown complete")

    async def _evict_oldest(self) -> None:
        """Remove the least recently used cached client that's not in use.

        Must be called with _lock held.
        """
        if not self._cache:
            return

        # Find oldest client that's not in use
        evictable = [
            (key, cached) for key, cached in self._cache.items()
            if cached.in_use == 0
        ]

        if not evictable:
            logger.warning("All cached clients are in use, cannot evict")
            return

        oldest_key = min(evictable, key=lambda x: x[1].last_used)[0]
        cached = self._cache.pop(oldest_key)
        logger.debug(f"Evicting cached client: {oldest_key}")

        try:
            await cached.client.__aexit__(None, None, None)
        except Exception as e:
            logger.warning(f"Error closing evicted client {oldest_key}: {e}")

    async def _cleanup_expired(self) -> None:
        """Remove expired clients from cache that are not in use.

        Must be called with _lock held.
        """
        now = time.time()
        expired_keys = [
            key for key, cached in self._cache.items()
            if now - cached.last_used > self._ttl and cached.in_use == 0
        ]

        for key in expired_keys:
            cached = self._cache.pop(key)
            logger.debug(f"Cleaning up expired client: {key}")
            try:
                await cached.client.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Error closing expired client {key}: {e}")

    @asynccontextmanager
    async def get_client(
        self,
        thread_id: str,
        session_id: str | None,
        options_factory: Callable[[], ClaudeAgentOptions],
    ) -> AsyncIterator[ClaudeSDKClient]:
        """Get or create a client for a thread session.

        Args:
            thread_id: The thread ID
            session_id: Optional session ID for resumption
            options_factory: Factory function that creates ClaudeAgentOptions

        Yields:
            ClaudeSDKClient ready for use

        Note: The client may be reused from cache or freshly created.
        Cache hits avoid subprocess spawn latency (~500ms-2s savings).
        """
        if self._shutdown or not self._enabled:
            # If shutting down or caching disabled, just create a fresh client
            if not self._enabled:
                logger.debug("Cache disabled, creating fresh client")
            else:
                logger.debug("Cache shutdown, creating fresh client")
            options = options_factory()
            client = ClaudeSDKClient(options=options)
            async with client:
                yield client
            return

        cache_key = f"{thread_id}:{session_id or 'new'}"
        options = options_factory()
        options_hash = _hash_options(options)
        cached_entry: CachedClient | None = None
        client: ClaudeSDKClient | None = None
        is_new_client = False

        # Try to get from cache
        async with self._lock:
            await self._cleanup_expired()

            if cache_key in self._cache:
                cached = self._cache[cache_key]
                now = time.time()

                # Check if still valid (not expired and config matches)
                if (
                    now - cached.last_used < self._ttl
                    and cached.options_hash == options_hash
                ):
                    cached.last_used = now
                    cached.in_use += 1  # Mark as in use
                    cached_entry = cached
                    self._hits += 1
                    logger.debug(f"Cache HIT for {cache_key} (in_use={cached.in_use})")
                else:
                    # Expired or config changed - close and remove
                    logger.debug(f"Cache STALE for {cache_key}, removing")
                    self._cache.pop(cache_key, None)
                    try:
                        await cached.client.__aexit__(None, None, None)
                    except Exception:
                        pass

            if cached_entry is None:
                # Cache miss - track stat under lock
                self._misses += 1
                logger.debug(f"Cache MISS for {cache_key}, will create new client")

        # If we got a cached client, use it
        if cached_entry is not None:
            try:
                yield cached_entry.client
            finally:
                # Release the reference
                async with self._lock:
                    if cache_key in self._cache:
                        self._cache[cache_key].in_use -= 1
                        self._cache[cache_key].last_used = time.time()
            return

        # Create new client outside of lock (expensive operation)
        client = ClaudeSDKClient(options=options)
        try:
            await client.__aenter__()
            is_new_client = True
        except Exception as e:
            logger.error(f"Failed to create client for {cache_key}: {e}")
            raise

        # Store in cache
        try:
            async with self._lock:
                # Evict if at capacity
                while len(self._cache) >= self._max_cached:
                    await self._evict_oldest()
                    # If we couldn't evict anything, break to avoid infinite loop
                    if len(self._cache) >= self._max_cached:
                        logger.warning("Cache at capacity with all clients in use")
                        break

                now = time.time()
                cached_entry = CachedClient(
                    client=client,
                    thread_id=thread_id,
                    session_id=session_id,
                    created_at=now,
                    last_used=now,
                    options_hash=options_hash,
                    in_use=1,  # Mark as in use immediately
                )
                self._cache[cache_key] = cached_entry

            yield client

        except Exception as e:
            # On error, remove from cache and clean up
            logger.warning(f"Client error for {cache_key}: {e}")
            async with self._lock:
                self._cache.pop(cache_key, None)
            if is_new_client:
                try:
                    await client.__aexit__(type(e), e, e.__traceback__)
                except Exception:
                    pass
            raise

        finally:
            # Release the reference
            async with self._lock:
                if cache_key in self._cache:
                    self._cache[cache_key].in_use -= 1
                    self._cache[cache_key].last_used = time.time()


# Singleton instance
_client_cache: SessionClientCache | None = None


def get_client_cache() -> SessionClientCache:
    """Get the global client cache singleton."""
    global _client_cache
    if _client_cache is None:
        _client_cache = SessionClientCache()
    return _client_cache


def reset_client_cache() -> None:
    """Reset the client cache (for hot reload)."""
    global _client_cache
    _client_cache = None
