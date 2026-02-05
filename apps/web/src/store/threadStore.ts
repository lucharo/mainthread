import { create } from 'zustand';
import { STREAMING_BLOCK_CLEAR_DELAY_MS, RECENT_TOOLS_EXPANDED } from '../constants/animations';

// Re-export types from the types module for backward compatibility
export type {
  ThreadStatus,
  Message,
  ModelType,
  PermissionMode,
  Thread,
  SSEConnection,
  ToolUse,
  StreamingBlock,
  AgentQuestionOption,
  AgentQuestion,
  ThreadCreatedNotification,
  CreateThreadOptions,
  PaginationState,
  TokenInfo,
  PendingPlanApproval,
  DirectoryEntry,
  GitInfo,
  ChildPendingQuestion,
} from './types';

import type {
  ThreadStatus,
  Message,
  ModelType,
  PermissionMode,
  Thread,
  SSEConnection,
  StreamingBlock,
  AgentQuestion,
  ThreadCreatedNotification,
  CreateThreadOptions,
  PaginationState,
  PendingPlanApproval,
  ChildPendingQuestion,
} from './types';

interface ThreadState {
  threads: Thread[];
  activeThreadId: string | null;
  isLoading: boolean;
  error: string | null;
  showArchived: boolean;
  sseConnections: Record<string, SSEConnection>;
  // Unified chronological streaming blocks - the source of truth for real-time content
  streamingBlocks: Record<string, StreamingBlock[]>;
  // Track which streaming block is currently expanded per thread (only one at a time)
  expandedStreamingBlockId: Record<string, string | null>;
  // FIFO queue of recent tool block IDs per thread (for FIFO collapsing)
  recentToolBlockIds: Record<string, string[]>;
  pendingQuestion: Record<string, AgentQuestion[] | null>;
  pendingPlanApproval: Record<string, PendingPlanApproval | null>;
  threadNotifications: Record<string, ThreadCreatedNotification[]>;
  // Pagination state per thread
  pagination: Record<string, PaginationState>;
  // Maps SpawnThread tool_use_id to the created thread's ID (for reliable thread lookup)
  spawnedThreadIds: Record<string, string>;
  // Track last seen SSE event ID per thread (for dedup on reconnection)
  lastSeenEventId: Record<string, string>;
  // Child thread pending questions (forwarded from sub-threads)
  childPendingQuestions: Record<string, ChildPendingQuestion[]>;
  // Track threads waiting in queue for an available slot
  queueWaiting: Record<string, boolean>;

  // Actions
  setActiveThread: (id: string | null) => void;
  fetchThreads: (includeArchived?: boolean) => Promise<void>;
  createThread: (options: CreateThreadOptions) => Promise<Thread>;
  sendMessage: (threadId: string, content: string, options?: {
    images?: Array<{ data: string; media_type: string }>;
    fileRefs?: string[];
    allowNestedSubthreads?: boolean;
    maxThreadDepth?: number;
  }) => Promise<void>;
  stopThread: (threadId: string) => Promise<void>;
  updateThreadStatus: (threadId: string, status: ThreadStatus) => void;
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  updateThreadConfig: (threadId: string, config: { model?: ModelType; extendedThinking?: boolean; permissionMode?: PermissionMode; autoReact?: boolean }) => Promise<void>;
  clearThreadMessages: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  unarchiveThread: (threadId: string) => Promise<void>;
  resetAllThreads: () => Promise<void>;
  setShowArchived: (show: boolean) => void;
  loadMoreMessages: (threadId: string) => Promise<void>;
  subscribeToThread: (threadId: string, lastEventId?: string) => void;
  unsubscribeFromThread: (threadId: string) => void;
  // Unified streaming block actions
  appendStreamingBlock: (threadId: string, block: Omit<StreamingBlock, 'timestamp'>) => void;
  appendTextToLastBlock: (threadId: string, content: string) => void;
  appendThinkingToLastBlock: (threadId: string, content: string) => void;
  markBlockComplete: (threadId: string, toolUseId: string, isError?: boolean, errorMessage?: string) => void;
  updateBlockInput: (threadId: string, toolUseId: string, input: Record<string, unknown>) => void;
  collapseToolBlock: (threadId: string, toolUseId: string) => void;
  clearStreamingBlocks: (threadId: string) => void;
  setExpandedStreamingBlockId: (threadId: string, blockId: string | null) => void;
  setPendingQuestion: (threadId: string, questions: AgentQuestion[] | null) => void;
  clearPendingQuestion: (threadId: string) => void;
  answerQuestion: (threadId: string, answers: Record<string, string>) => Promise<void>;
  setPendingPlanApproval: (threadId: string, plan: PendingPlanApproval | null) => void;
  clearPendingPlanApproval: (threadId: string) => void;
  handlePlanAction: (threadId: string, action: 'proceed' | 'modify' | 'compact', permissionMode?: PermissionMode) => Promise<void>;
  addThreadNotification: (threadId: string, notification: ThreadCreatedNotification) => void;
  clearThreadNotifications: (threadId: string) => void;
  cleanupAllConnections: () => void;
  setSpawnedThreadId: (toolUseId: string, threadId: string) => void;
  getSpawnedThreadId: (toolUseId: string) => string | undefined;
  setChildPendingQuestion: (parentThreadId: string, question: ChildPendingQuestion) => void;
  clearChildPendingQuestion: (parentThreadId: string, childThreadId: string) => void;
}

const API_BASE = '/api';

/**
 * Safely parse JSON, returning a default value on error.
 */
function safeJsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return defaultValue;
  }
}

/**
 * Determines if a thread status update should be applied.
 * Guards against race conditions where late-arriving SSE events
 * try to overwrite a 'done' status with non-done statuses.
 *
 * @param currentStatus - The current status of the thread
 * @param newStatus - The proposed new status
 * @returns true if the status update should be applied
 */
export function shouldUpdateThreadStatus(
  currentStatus: ThreadStatus | undefined,
  newStatus: ThreadStatus
): boolean {
  // Don't overwrite 'done' with non-done statuses (race condition guard)
  if (currentStatus === 'done' && newStatus !== 'done') {
    return false;
  }
  return true;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  isLoading: false,
  error: null,
  showArchived: false,
  sseConnections: {},
  streamingBlocks: {},
  expandedStreamingBlockId: {},
  recentToolBlockIds: {},
  pendingQuestion: {},
  pendingPlanApproval: {},
  threadNotifications: {},
  pagination: {},
  spawnedThreadIds: {},
  lastSeenEventId: {},
  childPendingQuestions: {},
  queueWaiting: {},

  setActiveThread: (id) => {
    const prevId = get().activeThreadId;
    const threads = get().threads;

    // Find the new thread to check if it's a sub-thread
    const newThread = threads.find(t => t.id === id);
    const prevThread = threads.find(t => t.id === prevId);

    // Unsubscribe from previous thread ONLY if:
    // 1. It's not the parent of the new thread
    // 2. The new thread is not a sub-thread of the previous thread
    if (prevId && prevId !== id) {
      const isParentOfNew = newThread?.parentId === prevId;
      const isChildOfPrev = prevThread?.parentId === id;
      if (!isParentOfNew && !isChildOfPrev) {
        get().unsubscribeFromThread(prevId);
      }
    }

    set({ activeThreadId: id });

    // Subscribe to new thread
    if (id) {
      get().subscribeToThread(id);
    }

    // Also subscribe to parent thread if viewing a sub-thread
    if (newThread?.parentId) {
      get().subscribeToThread(newThread.parentId);
    }

    // Subscribe to active child threads so their streaming blocks accumulate
    // This ensures when you switch to a subthread, you see full history
    if (id) {
      const childThreads = threads.filter(t => t.parentId === id && !t.archivedAt);
      for (const child of childThreads) {
        if (child.status === 'pending' || child.status === 'active') {
          get().subscribeToThread(child.id);
        }
      }
    }
  },

  fetchThreads: async (includeArchived?: boolean) => {
    set({ isLoading: true, error: null });
    try {
      const params = includeArchived ? '?include_archived=true' : '';
      const res = await fetch(`${API_BASE}/threads${params}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const detail = errorData.detail || res.statusText;
        throw new Error(`${detail} (HTTP ${res.status})`);
      }
      const fetchedThreads = await res.json();

      // Preserve lastUsage and lastCostUsd from existing threads
      // These are only stored in memory from SSE events, not persisted to DB
      const existingThreads = get().threads;
      const usageMap = new Map(
        existingThreads.map((t) => [t.id, { lastUsage: t.lastUsage, lastCostUsd: t.lastCostUsd }])
      );

      const threads = fetchedThreads.map((thread: Thread) => ({
        ...thread,
        lastUsage: usageMap.get(thread.id)?.lastUsage,
        lastCostUsd: usageMap.get(thread.id)?.lastCostUsd,
      }));

      // Initialize pagination state for each thread
      // We assume all messages are initially loaded for existing threads
      // hasMore is true if the thread might have more messages (we estimate based on message count)
      const paginationState: Record<string, PaginationState> = {};
      for (const thread of threads) {
        const messageCount = thread.messages?.length || 0;
        paginationState[thread.id] = {
          hasMore: messageCount >= 50, // Assume there might be more if at or above limit
          total: messageCount,
          loadedCount: messageCount,
          isLoading: false,
        };
      }
      set({ threads, pagination: paginationState, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch threads';
      set({ error: message, isLoading: false });
    }
  },

  createThread: async (options) => {
    const res = await fetch(`${API_BASE}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    const thread = await res.json();
    set((state) => ({ threads: [...state.threads, thread] }));
    return thread;
  },

  sendMessage: async (threadId, content, options) => {
    const tempId = `temp-${Date.now()}`;
    const userMsg: Message = {
      id: tempId,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    // Optimistic update
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: [...t.messages, userMsg],
              status: 'pending' as ThreadStatus,
            }
          : t,
      ),
    }));

    // Clear any previous streaming blocks
    get().clearStreamingBlocks(threadId);

    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout

    // Build request body
    const requestBody: {
      content: string;
      images?: Array<{ data: string; media_type: string }>;
      file_references?: string[];
      allow_nested_subthreads?: boolean;
      max_thread_depth?: number;
    } = { content };
    if (options?.images && options.images.length > 0) {
      requestBody.images = options.images;
    }
    if (options?.fileRefs && options.fileRefs.length > 0) {
      requestBody.file_references = options.fileRefs;
    }
    // Include nested subthread settings
    if (options?.allowNestedSubthreads !== undefined) {
      requestBody.allow_nested_subthreads = options.allowNestedSubthreads;
    }
    if (options?.maxThreadDepth !== undefined) {
      requestBody.max_thread_depth = options.maxThreadDepth;
    }

    try {
      const res = await fetch(`${API_BASE}/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        // 499 = user cancelled (pressed escape) - not an error, just silently return
        if (res.status === 499) {
          // Remove temp message and reset thread status
          set((state) => ({
            threads: state.threads.map((t) =>
              t.id === threadId
                ? { ...t, messages: t.messages.filter((m) => m.id !== tempId), status: 'active' as ThreadStatus }
                : t,
            ),
          }));
          return; // Silent return - no error
        }
        const errorData = await res.json().catch(() => ({}));
        const detail = errorData.detail || res.statusText;
        const errorType = errorData.type ? ` [${errorData.type}]` : '';
        throw new Error(`${detail}${errorType} (HTTP ${res.status})`);
      }

      // HTTP response is fire-and-forget for success case.
      // The SSE 'complete' event is the sole source of truth for final messages.
      await res.json();
    } catch (err) {
      // Handle abort/timeout specifically
      if (err instanceof DOMException && err.name === 'AbortError') {
        const message = 'Request timed out after 5 minutes';
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? { ...t, status: 'needs_attention' as ThreadStatus }
              : t,
          ),
          error: message,
        }));
        throw new Error(message);
      }

      const message = err instanceof Error ? err.message : 'Failed to send message';
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === threadId
            ? { ...t, status: 'needs_attention' as ThreadStatus }
            : t,
        ),
        error: message,
      }));
      throw err; // Re-throw so callers can handle
    } finally {
      clearTimeout(timeoutId);
    }
  },

  stopThread: async (threadId) => {
    try {
      const res = await fetch(`${API_BASE}/threads/${threadId}/stop`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
      }
      // Clear streaming blocks and update status (SSE will also handle this)
      get().clearStreamingBlocks(threadId);
      get().updateThreadStatus(threadId, 'active');
    } catch (err) {
      // If no active task, don't show error - it just means we're already done
      if (err instanceof Error && err.message.includes('No active task')) {
        return;
      }
      throw err;
    }
  },

  updateThreadStatus: (threadId, status) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, status } : t,
      ),
    }));
  },

  updateThreadTitle: async (threadId, title) => {
    const res = await fetch(`${API_BASE}/threads/${threadId}/title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    // Update local state (SSE will also update, but this makes it immediate)
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, title } : t,
      ),
    }));
  },

  updateThreadConfig: async (threadId, config) => {
    const res = await fetch(`${API_BASE}/threads/${threadId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    // Update local state
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, ...config } : t,
      ),
    }));
  },

  clearThreadMessages: async (threadId) => {
    const res = await fetch(`${API_BASE}/threads/${threadId}/messages`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    // Update local state - clear messages, sessionId, and thread notifications
    set((state) => {
      const { [threadId]: _, ...remainingNotifications } = state.threadNotifications;
      return {
        threads: state.threads.map((t) =>
          t.id === threadId ? { ...t, messages: [], sessionId: null } : t,
        ),
        threadNotifications: remainingNotifications,
      };
    });
  },

  archiveThread: async (threadId) => {
    const res = await fetch(`${API_BASE}/threads/${threadId}/archive`, {
      method: 'POST',
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    // Update local state
    set((state) => {
      const archivedThread = state.threads.find((t) => t.id === threadId);
      const isActiveThread = state.activeThreadId === threadId;

      // Navigate away from archived thread
      let newActiveId = state.activeThreadId;
      if (isActiveThread) {
        if (archivedThread?.parentId) {
          // For sub-threads, go to parent
          newActiveId = archivedThread.parentId;
        } else {
          // For main threads, find first unarchived main thread
          const firstUnarchived = state.threads.find(
            (t) => t.id !== threadId && !t.parentId && !t.archivedAt
          );
          newActiveId = firstUnarchived?.id || null;
        }
      }

      return {
        threads: state.threads.map((t) =>
          t.id === threadId ? { ...t, archivedAt: new Date().toISOString() } : t,
        ),
        activeThreadId: newActiveId,
      };
    });
  },

  unarchiveThread: async (threadId) => {
    const res = await fetch(`${API_BASE}/threads/${threadId}/unarchive`, {
      method: 'POST',
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    // Update local state
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, archivedAt: null } : t,
      ),
    }));
  },

  resetAllThreads: async () => {
    const res = await fetch(`${API_BASE}/threads/all?confirm=true`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    // Clear all local state
    get().cleanupAllConnections();
    set({
      threads: [],
      activeThreadId: null,
      error: null,
    });
  },

  setShowArchived: (show) => {
    set({ showArchived: show });
    // Always fetch with archived=true so we can display accurate archived count
    // The toggle only controls display, not what's fetched
    get().fetchThreads(true);
  },

  loadMoreMessages: async (threadId) => {
    const { pagination, threads } = get();
    const paginationState = pagination[threadId];
    const thread = threads.find(t => t.id === threadId);

    // Don't load if already loading or no more messages
    if (paginationState?.isLoading || !paginationState?.hasMore) {
      return;
    }

    // Set loading state
    set((state) => ({
      pagination: {
        ...state.pagination,
        [threadId]: { ...state.pagination[threadId], isLoading: true },
      },
    }));

    try {
      // Calculate offset (current loaded count)
      const currentMessages = thread?.messages || [];
      const offset = currentMessages.length;

      const res = await fetch(`${API_BASE}/threads/${threadId}/messages?limit=50&offset=${offset}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      // Prepend older messages to the thread
      set((state) => {
        const existingThread = state.threads.find(t => t.id === threadId);
        if (!existingThread) return state;

        // Filter out duplicates
        const existingIds = new Set(existingThread.messages.map(m => m.id));
        const newMessages = data.messages.filter((m: Message) => !existingIds.has(m.id));

        return {
          threads: state.threads.map(t =>
            t.id === threadId
              ? { ...t, messages: [...newMessages, ...t.messages] }
              : t
          ),
          pagination: {
            ...state.pagination,
            [threadId]: {
              hasMore: data.hasMore,
              total: data.total,
              loadedCount: existingThread.messages.length + newMessages.length,
              isLoading: false,
            },
          },
        };
      });
    } catch (err) {
      console.error('Failed to load more messages:', err);
      set((state) => ({
        pagination: {
          ...state.pagination,
          [threadId]: { ...state.pagination[threadId], isLoading: false },
        },
      }));
    }
  },

  subscribeToThread: (threadId, lastEventId?: string) => {
    const { sseConnections } = get();

    // Don't create duplicate connections
    if (sseConnections[threadId]) {
      return;
    }

    // Include lastEventId for reconnection recovery
    const url = lastEventId
      ? `${API_BASE}/threads/${threadId}/stream?last_event_id=${lastEventId}`
      : `${API_BASE}/threads/${threadId}/stream`;
    const eventSource = new EventSource(url);

    // Helper to track last event ID for reconnection recovery
    const updateLastEventId = (event: MessageEvent) => {
      if (event.lastEventId) {
        set((state) => {
          const connection = state.sseConnections[threadId];
          if (connection) {
            return {
              sseConnections: {
                ...state.sseConnections,
                [threadId]: { ...connection, lastEventId: event.lastEventId },
              },
            };
          }
          return state;
        });
      }
    };

    eventSource.addEventListener('connected', () => {
      console.log(`[SSE] Connected to thread ${threadId}`);
      // Reset reconnect attempts on successful connection
      set((state) => {
        const connection = state.sseConnections[threadId];
        if (connection) {
          return {
            sseConnections: {
              ...state.sseConnections,
              [threadId]: { ...connection, reconnectAttempts: 0, reconnectTimeoutId: undefined },
            },
          };
        }
        return state;
      });
    });

    eventSource.addEventListener('text_delta', (event) => {
      updateLastEventId(event);
      // Dedup: skip events with IDs already processed (reconnection replay)
      if (event.lastEventId) {
        const lastSeen = get().lastSeenEventId[threadId];
        const lastSeenNum = parseInt(lastSeen, 10);
        const currentNum = parseInt(event.lastEventId, 10);
        if (!isNaN(lastSeenNum) && !isNaN(currentNum)) {
          // Detect server restart: seq_id dropped significantly (stale lastSeenEventId)
          if (lastSeenNum > 10 && currentNum < lastSeenNum) {
            console.log(`[SSE] Server restart detected for thread ${threadId}: seq went from ${lastSeenNum} to ${currentNum}, resetting lastSeenEventId`);
            set((state) => ({
              lastSeenEventId: { ...state.lastSeenEventId, [threadId]: '0' },
            }));
          } else if (currentNum <= lastSeenNum) {
            return; // Skip already-seen event
          }
        }
        set((state) => ({
          lastSeenEventId: { ...state.lastSeenEventId, [threadId]: event.lastEventId },
        }));
      }
      const data = safeJsonParse(event.data, { content: '' });
      console.log('[SSE] text_delta received:', data.content?.slice(0, 50));
      if (data.content) {
        // Append to last text block or create new one
        get().appendTextToLastBlock(threadId, data.content);
      }
    });

    eventSource.addEventListener('thinking', (event) => {
      updateLastEventId(event);
      // Dedup: skip events with IDs already processed (reconnection replay)
      if (event.lastEventId) {
        const lastSeen = get().lastSeenEventId[threadId];
        const lastSeenNum = parseInt(lastSeen, 10);
        const currentNum = parseInt(event.lastEventId, 10);
        if (!isNaN(lastSeenNum) && !isNaN(currentNum)) {
          // Detect server restart: seq_id dropped significantly (stale lastSeenEventId)
          if (lastSeenNum > 10 && currentNum < lastSeenNum) {
            console.log(`[SSE] Server restart detected for thread ${threadId}: seq went from ${lastSeenNum} to ${currentNum}, resetting lastSeenEventId`);
            set((state) => ({
              lastSeenEventId: { ...state.lastSeenEventId, [threadId]: '0' },
            }));
          } else if (currentNum <= lastSeenNum) {
            return; // Skip already-seen event
          }
        }
        set((state) => ({
          lastSeenEventId: { ...state.lastSeenEventId, [threadId]: event.lastEventId },
        }));
      }
      const data = safeJsonParse<{ content?: string; signature?: string }>(event.data, {});
      console.log('[SSE] thinking received:', data.content?.slice(0, 50));
      if (data.content) {
        // Append to last thinking block or create new one
        get().appendThinkingToLastBlock(threadId, data.content);
      }
    });

    eventSource.addEventListener('tool_use', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ tool?: string; name?: string; input?: Record<string, unknown>; id?: string }>(event.data, {});
      console.log('[SSE] tool_use received:', data, 'id:', data.id);
      const toolName = data.tool || data.name;
      if (toolName) {
        get().appendStreamingBlock(threadId, {
          type: 'tool_use',
          name: toolName,
          input: data.input,
          id: data.id,
          isComplete: false,
        });
      }
    });

    eventSource.addEventListener('tool_input', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ id?: string; input?: Record<string, unknown> }>(event.data, {});
      console.log('[SSE] tool_input received:', data);
      if (data.id && data.input) {
        get().updateBlockInput(threadId, data.id, data.input);
      }
    });

    eventSource.addEventListener('tool_result', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ tool_use_id?: string; thread_id?: string; content?: unknown; is_error?: boolean }>(event.data, {});
      console.log('[SSE] tool_result received:', data, 'tool_use_id:', data.tool_use_id);
      if (data.tool_use_id) {
        // Prefer the explicit is_error flag from the backend.
        // String-based detection is a fallback heuristic and may have false positives/negatives.
        const isError = data.is_error === true;
        const errorMessage = isError && typeof data.content === 'string' ? data.content : undefined;
        console.log('[SSE] Marking block complete:', data.tool_use_id, 'isError:', isError);
        get().markBlockComplete(threadId, data.tool_use_id, isError, errorMessage);
        // Track spawned thread ID for SpawnThread tool (avoids unreliable title-based lookup)
        if (data.thread_id) {
          get().setSpawnedThreadId(data.tool_use_id, data.thread_id);
        }
      } else {
        console.warn('[SSE] tool_result missing tool_use_id:', data);
      }
    });

    eventSource.addEventListener('question', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ questions?: AgentQuestion[] }>(event.data, {});
      if (data.questions && data.questions.length > 0) {
        get().setPendingQuestion(threadId, data.questions);
      }
    });

    eventSource.addEventListener('plan_approval', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{
        planFilePath?: string;
        planContent?: string;
        allowedPrompts?: Array<{ tool: string; prompt: string }>;
        timeout?: boolean;
        message?: string;
      }>(event.data, {});

      // Handle timeout notification - just log it, don't set pending approval
      if (data.timeout) {
        console.warn('[SSE] Plan approval timed out:', data.message);
        return;
      }

      // Set pending plan approval if we have content (planFilePath is optional now)
      if (data.planContent !== undefined) {
        get().setPendingPlanApproval(threadId, {
          planFilePath: data.planFilePath || 'Plan',
          planContent: data.planContent || '',
          allowedPrompts: data.allowedPrompts,
        });
      }
    });

    eventSource.addEventListener('message', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ message?: Message; status?: ThreadStatus }>(event.data, {});
      if (data.message) {
        // This event is used for notification messages (e.g., sub-thread completion).
        // Assistant messages are delivered via the 'complete' event.
        set((state) => {
          const thread = state.threads.find((t) => t.id === threadId);
          const messageExists = thread?.messages.some((m) => m.id === data.message!.id);
          if (messageExists) {
            // Just update status if message already exists
            return {
              threads: state.threads.map((t) =>
                t.id === threadId ? { ...t, status: data.status || t.status } : t
              ),
            };
          }
          return {
            threads: state.threads.map((t) =>
              t.id === threadId
                ? {
                    ...t,
                    messages: [...t.messages, data.message!],
                    status: data.status || t.status,
                  }
                : t
            ),
          };
        });
      }
    });

    eventSource.addEventListener('status_change', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ status?: ThreadStatus }>(event.data, {});
      if (data.status) {
        get().updateThreadStatus(threadId, data.status);
      }
    });

    eventSource.addEventListener('stopped', (event) => {
      updateLastEventId(event);
      console.log('[SSE] stopped received for thread', threadId);
      // Mark all remaining incomplete tool_use blocks as complete before clearing.
      // This prevents spinner artifacts when a thread is stopped mid-execution.
      const currentBlocks = get().streamingBlocks[threadId] || [];
      currentBlocks.forEach((block) => {
        if (block.type === 'tool_use' && block.id && !block.isComplete) {
          console.log('[SSE] stopped: force-completing incomplete tool block:', block.id);
          get().markBlockComplete(threadId, block.id);
        }
      });
      // Clear streaming blocks and update status
      get().clearStreamingBlocks(threadId);
      get().updateThreadStatus(threadId, 'active');
    });

    eventSource.addEventListener('config_change', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ model?: ModelType; extendedThinking?: boolean; permissionMode?: PermissionMode; autoReact?: boolean }>(event.data, {});
      // Update thread config in state
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === threadId
            ? {
                ...t,
                ...(data.model !== undefined && { model: data.model }),
                ...(data.extendedThinking !== undefined && { extendedThinking: data.extendedThinking }),
                ...(data.permissionMode !== undefined && { permissionMode: data.permissionMode }),
                ...(data.autoReact !== undefined && { autoReact: data.autoReact }),
              }
            : t
        ),
      }));
    });

    eventSource.addEventListener('title_change', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ title?: string }>(event.data, {});
      if (data.title) {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId ? { ...t, title: data.title! } : t
          ),
        }));
      }
    });

    eventSource.addEventListener('subthread_status', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ threadId?: string; status?: ThreadStatus; title?: string }>(event.data, {});
      if (data.threadId && data.status) {
        // Race condition fix: Don't overwrite 'done' with other statuses
        // This prevents late-arriving events from incorrectly showing a thread as pending/active
        // after it has already completed
        const currentThread = get().threads.find(t => t.id === data.threadId);
        if (!shouldUpdateThreadStatus(currentThread?.status, data.status)) {
          console.log(`[SSE] Ignoring status change from '${currentThread?.status}' to '${data.status}' for thread ${data.threadId}`);
          return;
        }

        // Update the sub-thread's status
        get().updateThreadStatus(data.threadId, data.status);
        // Add completion notification for parent thread (done or needs_attention)
        if (data.status === 'done' || data.status === 'needs_attention') {
          get().addThreadNotification(threadId, {
            threadId: data.threadId,
            threadTitle: data.title || 'Sub-thread',
            timestamp: new Date().toISOString(),
            status: data.status,
          });
        }
      }
    });

    eventSource.addEventListener('thread_created', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ thread?: Thread }>(event.data, {});
      if (data.thread) {
        // Add the new thread to our list if not already present
        set((state) => {
          const exists = state.threads.some((t) => t.id === data.thread!.id);
          if (exists) return state;
          return { threads: [...state.threads, data.thread!] };
        });

        // Cross-reference with current streaming blocks to find the SpawnThread tool_use
        // that created this thread. This fires before tool_result, so we populate
        // spawnedThreadIds early to prevent duplicate notifications.
        const blocks = get().streamingBlocks[threadId] || [];
        let matchedToolUseId: string | undefined;
        for (const block of blocks) {
          if (
            block.type === 'tool_use' &&
            block.name === 'SpawnThread' &&
            block.id &&
            !get().spawnedThreadIds[block.id]
          ) {
            // Match by title from the tool input
            const inputTitle = block.input?.title as string | undefined;
            if (inputTitle && inputTitle === data.thread!.title) {
              get().setSpawnedThreadId(block.id, data.thread!.id);
              matchedToolUseId = block.id;
              break;
            }
          }
        }

        if (!matchedToolUseId) {
          // SpawnThread block may not have arrived yet - defer and retry
          setTimeout(() => {
            const retryBlocks = get().streamingBlocks[threadId] || [];
            const retryMatch = retryBlocks.find(
              (b) =>
                b.type === 'tool_use' &&
                b.name === 'SpawnThread' &&
                b.id &&
                !get().spawnedThreadIds[b.id!] &&
                (b.input?.title as string | undefined) === data.thread!.title
            );
            if (retryMatch && retryMatch.id) {
              // Found it on retry - add to spawnedThreadIds mapping
              get().setSpawnedThreadId(retryMatch.id, data.thread!.id);
            } else {
              // Still no match after delay - show notification
              get().addThreadNotification(threadId, {
                threadId: data.thread!.id,
                threadTitle: data.thread!.title,
                timestamp: new Date().toISOString(),
              });
            }
          }, 200);
        } else {
          // Matched immediately - add notification
          get().addThreadNotification(threadId, {
            threadId: data.thread!.id,
            threadTitle: data.thread!.title,
            timestamp: new Date().toISOString(),
          });
        }
        // Auto-subscribe to the new child thread to accumulate its streaming blocks
        // This ensures we don't miss any content when the subthread starts processing
        if (data.thread.parentId === threadId) {
          // Subscribe immediately with last_event_id=0 to request ALL stored events
          // This ensures we receive all events even if the agent started before we subscribed
          // Guard: only subscribe if parent connection still exists (prevents orphan subscriptions)
          if (get().sseConnections[threadId]) {
            get().subscribeToThread(data.thread!.id, '0');
          }
        }
      }
    });

    eventSource.addEventListener('subagent_start', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{
        threadId?: string;
        title?: string;
        parentId?: string;
        status?: ThreadStatus;
      }>(event.data, {});
      if (data.threadId) {
        // Add ephemeral thread to the threads array
        set((state) => {
          const exists = state.threads.some((t) => t.id === data.threadId);
          if (exists) return state;
          const ephemeralThread: Thread = {
            id: data.threadId!,
            title: data.title || 'Sub-agent',
            status: data.status || 'active',
            parentId: data.parentId || threadId,
            messages: [],
            sessionId: null,
            model: 'claude-sonnet-4-5',
            extendedThinking: false,
            permissionMode: 'bypassPermissions',
            autoReact: false,
            gitBranch: null,
            gitRepo: null,
            isWorktree: false,
            worktreeBranch: null,
            archivedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isEphemeral: true,
            isReadOnly: true,
          };
          return { threads: [...state.threads, ephemeralThread] };
        });
      }
    });

    eventSource.addEventListener('subagent_stop', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{
        threadId?: string;
        status?: ThreadStatus;
      }>(event.data, {});
      if (data.threadId) {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === data.threadId
              ? { ...t, status: data.status || 'done' }
              : t
          ),
        }));
      }
    });

    eventSource.addEventListener('child_question', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{
        childThreadId?: string;
        childTitle?: string;
        questions?: AgentQuestion[];
      }>(event.data, {});
      if (data.childThreadId && data.questions && data.questions.length > 0) {
        // Key by parent thread ID (threadId) since the parent needs to look this up
        get().setChildPendingQuestion(threadId, {
          childThreadId: data.childThreadId,
          childTitle: data.childTitle || 'Sub-thread',
          questions: data.questions,
        });
      }
    });

    eventSource.addEventListener('thread_archived', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ threadId?: string }>(event.data, {});
      if (data.threadId) {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === data.threadId ? { ...t, archivedAt: new Date().toISOString() } : t
          ),
        }));
      }
    });

    eventSource.addEventListener('thread_unarchived', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ threadId?: string }>(event.data, {});
      if (data.threadId) {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === data.threadId ? { ...t, archivedAt: null } : t
          ),
        }));
      }
    });

    eventSource.addEventListener('usage', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ usage?: Record<string, number>; totalCostUsd?: number }>(event.data, {});
      // Store usage data on the thread for display
      if (data.usage) {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? { ...t, lastUsage: data.usage, lastCostUsd: data.totalCostUsd }
              : t
          ),
        }));
      }
    });

    eventSource.addEventListener('queue_waiting', (event) => {
      updateLastEventId(event);
      console.log('[SSE] queue_waiting received for thread', threadId);
      set((state) => ({
        queueWaiting: { ...state.queueWaiting, [threadId]: true },
      }));
    });

    eventSource.addEventListener('queue_acquired', (event) => {
      updateLastEventId(event);
      console.log('[SSE] queue_acquired received for thread', threadId);
      set((state) => ({
        queueWaiting: { ...state.queueWaiting, [threadId]: false },
      }));
    });

    eventSource.addEventListener('complete', (event) => {
      updateLastEventId(event);
      const data = safeJsonParse<{ userMessage?: Message; assistantMessage?: Message; status?: ThreadStatus }>(event.data, {});
      console.log('[SSE] complete received');

      // Mark all remaining incomplete tool_use blocks as complete immediately.
      // This prevents spinner artifacts when tool_result SSE events were missed
      // or arrived out of order (e.g., SpawnThread tool_result race condition).
      const currentBlocks = get().streamingBlocks[threadId] || [];
      currentBlocks.forEach((block) => {
        if (block.type === 'tool_use' && block.id && !block.isComplete) {
          console.log('[SSE] complete: force-completing incomplete tool block:', block.id);
          get().markBlockComplete(threadId, block.id);
        }
      });

      // Delay BOTH clearing streaming blocks AND updating messages so they happen
      // at the same time. This prevents a ~600ms window where both streaming blocks
      // AND persisted message content render simultaneously.
      setTimeout(() => {
        get().clearStreamingBlocks(threadId);

        // Update thread with final messages and status (single source of truth)
        set((state) => {
          const thread = state.threads.find((t) => t.id === threadId);
          if (!thread) return state;

          let updatedMessages = [...thread.messages];

          // Replace optimistic user message with persisted one (matching by content or temp ID)
          if (data.userMessage) {
            const tempIdx = updatedMessages.findIndex(
              (m) => m.id.startsWith('temp-') && m.role === 'user'
            );
            if (tempIdx >= 0) {
              updatedMessages[tempIdx] = data.userMessage;
            } else if (!updatedMessages.some((m) => m.id === data.userMessage!.id)) {
              updatedMessages.push(data.userMessage);
            }
          }

          // Add assistant message if not already present
          if (data.assistantMessage) {
            const assistantExists = updatedMessages.some((m) => m.id === data.assistantMessage!.id);
            if (!assistantExists) {
              updatedMessages.push(data.assistantMessage);
            }
          }

          return {
            threads: state.threads.map((t) =>
              t.id === threadId
                ? { ...t, messages: updatedMessages, status: data.status || t.status }
                : t
            ),
          };
        });
      }, STREAMING_BLOCK_CLEAR_DELAY_MS);
    });

    eventSource.addEventListener('error', (event: Event) => {
      // SSE error events don't have data in the standard format
      const messageEvent = event as MessageEvent;
      const data = messageEvent.data
        ? safeJsonParse<{ error?: string }>(messageEvent.data, {})
        : {};
      console.error(`[SSE] Error for thread ${threadId}:`, data.error || 'Unknown error');
    });

    eventSource.onerror = () => {
      const connection = get().sseConnections[threadId];
      const attempts = connection?.reconnectAttempts ?? 0;
      const maxRetries = 5;

      console.error(`[SSE] Connection lost for thread ${threadId} (attempt ${attempts + 1}/${maxRetries})`);

      // Clear any pending reconnect timeout
      if (connection?.reconnectTimeoutId) {
        clearTimeout(connection.reconnectTimeoutId);
      }

      // Close the current connection
      eventSource.close();

      // Check if we should retry
      if (attempts >= maxRetries) {
        console.error(`[SSE] Max reconnection attempts reached for thread ${threadId}`);
        get().unsubscribeFromThread(threadId);
        return;
      }

      // Only reconnect if this is the active thread OR parent of active thread
      // (Parent needs to stay subscribed to receive sub-thread completion notifications)
      const activeId = get().activeThreadId;
      const activeThread = activeId ? get().threads.find((t) => t.id === activeId) : null;
      const isParentOfActive = activeThread?.parentId === threadId;

      if (activeId !== threadId && !isParentOfActive) {
        get().unsubscribeFromThread(threadId);
        return;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = Math.min(1000 * Math.pow(2, attempts), 16000);
      console.log(`[SSE] Reconnecting to thread ${threadId} in ${delay}ms`);

      const timeoutId = setTimeout(() => {
        // Double-check active thread or parent relationship before reconnecting
        const currentActiveId = get().activeThreadId;
        const currentActiveThread = currentActiveId ? get().threads.find((t) => t.id === currentActiveId) : null;
        const stillRelevant = currentActiveId === threadId || currentActiveThread?.parentId === threadId;

        if (stillRelevant) {
          // Get lastEventId for reconnection recovery before removing connection
          const lastEventId = get().sseConnections[threadId]?.lastEventId;
          // Remove old connection and create new one
          const { [threadId]: _, ...rest } = get().sseConnections;
          set({ sseConnections: rest });
          // Recursively subscribe with lastEventId to recover missed events
          get().subscribeToThread(threadId, lastEventId);
        }
      }, delay);

      // Store the timeout ID and increment attempts
      set((state) => ({
        sseConnections: {
          ...state.sseConnections,
          [threadId]: { ...connection!, reconnectAttempts: attempts + 1, reconnectTimeoutId: timeoutId },
        },
      }));
    };

    // Create new object to trigger state update
    // Preserve initial lastEventId for reconnection recovery (e.g., '0' for full replay)
    set({
      sseConnections: {
        ...sseConnections,
        [threadId]: { eventSource, threadId, reconnectAttempts: 0, lastEventId },
      },
    });
  },

  unsubscribeFromThread: (threadId) => {
    const { sseConnections } = get();
    const connection = sseConnections[threadId];

    if (connection) {
      // Clear any pending reconnect timeout
      if (connection.reconnectTimeoutId) {
        clearTimeout(connection.reconnectTimeoutId);
      }
      connection.eventSource.close();

      // Create new object without this thread
      const { [threadId]: _, ...rest } = sseConnections;
      set({ sseConnections: rest });
    }
  },

  // Unified streaming block actions
  appendStreamingBlock: (threadId, block) => {
    set((state) => {
      const existingBlocks = state.streamingBlocks[threadId] || [];
      const existingQueue = state.recentToolBlockIds[threadId] || [];

      // Dedup: skip tool_use blocks that already exist (e.g., on SSE reconnection replay)
      if (block.type === 'tool_use' && block.id) {
        const alreadyExists = existingBlocks.some(
          (b) => b.type === 'tool_use' && b.id === block.id
        );
        if (alreadyExists) {
          return state;
        }
      }

      // Start with finalized blocks
      let updatedBlocks = existingBlocks.map(b => ({ ...b, isFinalized: true }));
      let updatedQueue = [...existingQueue];

      // Handle FIFO collapsing for tool_use blocks (atomic with block addition)
      if (block.type === 'tool_use' && block.id) {
        console.log(`[FIFO] New tool_use block: ${block.id}, queue before:`, updatedQueue, `limit: ${RECENT_TOOLS_EXPANDED}`);
        // FIFO: Collapse oldest blocks until under limit
        while (updatedQueue.length >= RECENT_TOOLS_EXPANDED) {
          const oldestId = updatedQueue.shift();
          console.log(`[FIFO] Collapsing oldest block: ${oldestId}`);
          if (oldestId) {
            // Mark oldest block as collapsed inline
            updatedBlocks = updatedBlocks.map((b) =>
              b.type === 'tool_use' && b.id === oldestId
                ? { ...b, isCollapsed: true }
                : b
            );
          }
        }
        // Add new block ID to queue
        updatedQueue.push(block.id);
        console.log(`[FIFO] Queue after:`, updatedQueue);
      } else if (block.type === 'tool_use') {
        console.log(`[FIFO] Tool block missing id:`, block);
      }

      return {
        streamingBlocks: {
          ...state.streamingBlocks,
          [threadId]: [
            ...updatedBlocks,
            { ...block, timestamp: Date.now(), isFinalized: false },
          ],
        },
        // Collapse any previously expanded block when a new block is added
        expandedStreamingBlockId: {
          ...state.expandedStreamingBlockId,
          [threadId]: null,
        },
        // Update FIFO queue
        recentToolBlockIds: {
          ...state.recentToolBlockIds,
          [threadId]: updatedQueue,
        },
      };
    });
  },

  appendTextToLastBlock: (threadId, content) => {
    set((state) => {
      const blocks = state.streamingBlocks[threadId] || [];
      const lastBlock = blocks[blocks.length - 1];

      // If last block is text and not finalized, append to it
      if (lastBlock && lastBlock.type === 'text' && !lastBlock.isFinalized) {
        const updatedBlocks = [...blocks];
        updatedBlocks[blocks.length - 1] = {
          ...lastBlock,
          content: (lastBlock.content || '') + content,
          isFinalized: false,  // Keep streaming
        };
        return {
          streamingBlocks: {
            ...state.streamingBlocks,
            [threadId]: updatedBlocks,
          },
        };
      } else {
        // Create new text block - finalize previous blocks first
        const finalizedBlocks = blocks.map(b => ({ ...b, isFinalized: true }));
        return {
          streamingBlocks: {
            ...state.streamingBlocks,
            [threadId]: [
              ...finalizedBlocks,
              { type: 'text' as const, content, timestamp: Date.now(), isFinalized: false },
            ],
          },
        };
      }
    });
  },

  appendThinkingToLastBlock: (threadId, content) => {
    set((state) => {
      const blocks = state.streamingBlocks[threadId] || [];
      const lastBlock = blocks[blocks.length - 1];

      // If last block is thinking and not finalized, append to it
      if (lastBlock && lastBlock.type === 'thinking' && !lastBlock.isFinalized) {
        const updatedBlocks = [...blocks];
        updatedBlocks[blocks.length - 1] = {
          ...lastBlock,
          content: (lastBlock.content || '') + content,
          isFinalized: false,  // Keep streaming
        };
        return {
          streamingBlocks: {
            ...state.streamingBlocks,
            [threadId]: updatedBlocks,
          },
        };
      } else {
        // Create new thinking block - finalize previous blocks first
        const finalizedBlocks = blocks.map(b => ({ ...b, isFinalized: true }));
        return {
          streamingBlocks: {
            ...state.streamingBlocks,
            [threadId]: [
              ...finalizedBlocks,
              { type: 'thinking' as const, content, timestamp: Date.now(), isFinalized: false },
            ],
          },
        };
      }
    });
  },

  markBlockComplete: (threadId, toolUseId, isError = false, errorMessage) => {
    console.log(`[SSE] markBlockComplete called: threadId=${threadId}, toolUseId=${toolUseId}, isError=${isError}`);
    set((state) => {
      const blocks = state.streamingBlocks[threadId] || [];
      const blockIndex = blocks.findIndex((b) => b.type === 'tool_use' && b.id === toolUseId);
      console.log(`[SSE] Found block at index ${blockIndex}, total blocks: ${blocks.length}`);
      return {
        streamingBlocks: {
          ...state.streamingBlocks,
          [threadId]: blocks.map((b) =>
            b.type === 'tool_use' && b.id === toolUseId
              ? { ...b, isComplete: true, isFinalized: true, isError, errorMessage }
              : b
          ),
        },
      };
    });
  },

  updateBlockInput: (threadId, toolUseId, input) => {
    console.log(`[SSE] updateBlockInput called: threadId=${threadId}, toolUseId=${toolUseId}`);
    set((state) => {
      const blocks = state.streamingBlocks[threadId] || [];
      return {
        streamingBlocks: {
          ...state.streamingBlocks,
          [threadId]: blocks.map((b) =>
            b.type === 'tool_use' && b.id === toolUseId
              ? { ...b, input }
              : b
          ),
        },
      };
    });
  },

  collapseToolBlock: (threadId, toolUseId) => {
    set((state) => {
      const blocks = state.streamingBlocks[threadId] || [];
      return {
        streamingBlocks: {
          ...state.streamingBlocks,
          [threadId]: blocks.map((b) =>
            b.type === 'tool_use' && b.id === toolUseId
              ? { ...b, isCollapsed: true }
              : b
          ),
        },
      };
    });
  },

  clearStreamingBlocks: (threadId) => {
    set((state) => {
      const { [threadId]: _, ...restBlocks } = state.streamingBlocks;
      const { [threadId]: __, ...restExpanded } = state.expandedStreamingBlockId;
      const { [threadId]: ___, ...restQueue } = state.recentToolBlockIds;
      return {
        streamingBlocks: restBlocks,
        expandedStreamingBlockId: restExpanded,
        recentToolBlockIds: restQueue,
      };
    });
  },

  setExpandedStreamingBlockId: (threadId, blockId) => {
    set((state) => ({
      expandedStreamingBlockId: {
        ...state.expandedStreamingBlockId,
        [threadId]: blockId,
      },
    }));
  },

  setPendingQuestion: (threadId, questions) => {
    set((state) => ({
      pendingQuestion: {
        ...state.pendingQuestion,
        [threadId]: questions,
      },
    }));
  },

  clearPendingQuestion: (threadId) => {
    set((state) => {
      const { [threadId]: _, ...rest } = state.pendingQuestion;
      return { pendingQuestion: rest };
    });
  },

  answerQuestion: async (threadId, answers) => {
    const res = await fetch(`${API_BASE}/threads/${threadId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    // Store submitted answers in the AskUserQuestion tool block for display
    set((state) => {
      const blocks = state.streamingBlocks[threadId] || [];
      // Find the most recent AskUserQuestion tool block that doesn't have answers yet
      const updatedBlocks = [...blocks];
      for (let i = updatedBlocks.length - 1; i >= 0; i--) {
        const block = updatedBlocks[i];
        if (block.type === 'tool_use' && block.name === 'AskUserQuestion' && !block.submittedAnswers) {
          updatedBlocks[i] = { ...block, submittedAnswers: answers, isComplete: true };
          break;
        }
      }
      return {
        streamingBlocks: { ...state.streamingBlocks, [threadId]: updatedBlocks },
      };
    });
    // Clear the pending question after successful answer submission
    get().clearPendingQuestion(threadId);
  },

  setPendingPlanApproval: (threadId, plan) => {
    set((state) => ({
      pendingPlanApproval: {
        ...state.pendingPlanApproval,
        [threadId]: plan,
      },
    }));
  },

  clearPendingPlanApproval: (threadId) => {
    set((state) => {
      const { [threadId]: _, ...rest } = state.pendingPlanApproval;
      return { pendingPlanApproval: rest };
    });
  },

  handlePlanAction: async (threadId, action, permissionMode) => {
    const res = await fetch(`${API_BASE}/threads/${threadId}/plan-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, permissionMode }),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }
    // Clear the pending plan approval after successful action
    get().clearPendingPlanApproval(threadId);
  },

  addThreadNotification: (threadId, notification) => {
    set((state) => ({
      threadNotifications: {
        ...state.threadNotifications,
        [threadId]: [...(state.threadNotifications[threadId] || []), notification],
      },
    }));
  },

  clearThreadNotifications: (threadId) => {
    set((state) => {
      const { [threadId]: _, ...rest } = state.threadNotifications;
      return { threadNotifications: rest };
    });
  },

  cleanupAllConnections: () => {
    const { sseConnections } = get();
    Object.values(sseConnections).forEach((conn) => {
      // Clear any pending reconnect timeouts to prevent memory leaks
      if (conn.reconnectTimeoutId) {
        clearTimeout(conn.reconnectTimeoutId);
      }
      conn.eventSource.close();
    });
    set({ sseConnections: {}, streamingBlocks: {}, expandedStreamingBlockId: {}, recentToolBlockIds: {}, pendingQuestion: {}, pendingPlanApproval: {}, threadNotifications: {}, pagination: {}, spawnedThreadIds: {}, lastSeenEventId: {}, childPendingQuestions: {}, queueWaiting: {} });
  },

  setSpawnedThreadId: (toolUseId, threadId) => {
    set((state) => ({
      spawnedThreadIds: { ...state.spawnedThreadIds, [toolUseId]: threadId },
    }));
  },

  getSpawnedThreadId: (toolUseId) => {
    return get().spawnedThreadIds[toolUseId];
  },

  setChildPendingQuestion: (parentThreadId, question) => {
    set((state) => {
      const existing = state.childPendingQuestions[parentThreadId] || [];
      // Replace if same child already has a question, otherwise append
      const filtered = existing.filter((q) => q.childThreadId !== question.childThreadId);
      return {
        childPendingQuestions: {
          ...state.childPendingQuestions,
          [parentThreadId]: [...filtered, question],
        },
      };
    });
  },

  clearChildPendingQuestion: (parentThreadId, childThreadId) => {
    set((state) => {
      const existing = state.childPendingQuestions[parentThreadId] || [];
      const filtered = existing.filter((q) => q.childThreadId !== childThreadId);
      if (filtered.length === 0) {
        const { [parentThreadId]: _, ...rest } = state.childPendingQuestions;
        return { childPendingQuestions: rest };
      }
      return {
        childPendingQuestions: {
          ...state.childPendingQuestions,
          [parentThreadId]: filtered,
        },
      };
    });
  },
}));
