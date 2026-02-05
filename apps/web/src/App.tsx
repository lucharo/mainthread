import { useEffect, useRef, useCallback, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { ThreadSidebar } from './components/ThreadSidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { CommandPalette } from './components/CommandPalette';
import { WelcomeModal } from './components/WelcomeModal';
import { useThreadStore } from './store/threadStore';
import { useSettingsStore } from './store/settingsStore';

// Apply theme class to document
function useThemeEffect() {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const applyTheme = () => {
      const isDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', isDark);
    };

    applyTheme();

    // Listen for system preference changes when in system mode
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', applyTheme);
      return () => mediaQuery.removeEventListener('change', applyTheme);
    }
  }, [theme]);
}

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_DEFAULT_WIDTH = 288; // 18rem = w-72
const SIDEBAR_WIDTH_KEY = 'mainthread-sidebar-width';

// Hook to sync activeThreadId with URL path (e.g., /thread-id)
function useUrlThreadSync() {
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const threads = useThreadStore((state) => state.threads);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);

  // Tracks whether URL->state sync is in progress (prevents state->URL sync loop)
  const isUpdatingFromUrl = useRef(false);

  // Ensures URL->state sync only happens once on initial mount after threads load.
  // This ref persists across React StrictMode double-renders (development only),
  // so the initialization logic runs exactly once. This prevents URL sync from
  // overriding user thread selection after the initial page load.
  const hasInitialized = useRef(false);

  // Read thread ID from URL path ONLY on initial mount when threads first load
  useEffect(() => {
    // Only run this logic once after threads are loaded
    if (hasInitialized.current || threads.length === 0) {
      return;
    }
    hasInitialized.current = true;

    // Extract thread ID from pathname (e.g., "/abc123" -> "abc123")
    const urlThreadId = window.location.pathname.slice(1) || null;

    if (urlThreadId) {
      // Verify the thread exists
      const threadExists = threads.some((t) => t.id === urlThreadId);
      if (threadExists) {
        isUpdatingFromUrl.current = true;
        setActiveThread(urlThreadId);
      } else {
        // Thread doesn't exist, clear the URL path
        window.history.replaceState({}, '', '/');
      }
    }
  }, [threads, setActiveThread]);

  // Update URL when activeThreadId changes (but not when we're reading from URL)
  useEffect(() => {
    if (isUpdatingFromUrl.current) {
      isUpdatingFromUrl.current = false;
      return;
    }

    // Get current thread ID from pathname
    const currentUrlThreadId = window.location.pathname.slice(1) || null;

    if (activeThreadId !== currentUrlThreadId) {
      const newPath = activeThreadId ? `/${activeThreadId}` : '/';
      window.history.pushState({}, '', newPath);
    }
  }, [activeThreadId]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const urlThreadId = window.location.pathname.slice(1) || null;
      const threads = useThreadStore.getState().threads;

      if (urlThreadId) {
        const threadExists = threads.some((t) => t.id === urlThreadId);
        if (threadExists) {
          isUpdatingFromUrl.current = true;
          setActiveThread(urlThreadId);
        }
      } else {
        // No thread in URL, select first main thread
        const mainThread = threads.find((t) => !t.parentId) || threads[0];
        if (mainThread) {
          isUpdatingFromUrl.current = true;
          setActiveThread(mainThread.id);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setActiveThread]);
}

export default function App() {
  const fetchThreads = useThreadStore((state) => state.fetchThreads);
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const createThread = useThreadStore((state) => state.createThread);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);
  const setShowArchived = useThreadStore((state) => state.setShowArchived);
  const toggleSettings = useSettingsStore((state) => state.toggleSettings);
  const showArchivedByDefault = useSettingsStore((state) => state.showArchivedByDefault);
  const toggleCommandPalette = useSettingsStore((state) => state.toggleCommandPalette);

  // Apply theme class
  useThemeEffect();

  // Sync thread ID with URL
  useUrlThreadSync();

  const initRef = useRef(false);
  const lastFetchRef = useRef<number>(0);

  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? Math.min(Math.max(parseInt(saved, 10), SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH) : SIDEBAR_DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Handle sidebar resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      // Dragging left decreases sidebar width (sidebar is on the right)
      const delta = resizeRef.current.startX - e.clientX;
      const newWidth = Math.min(Math.max(resizeRef.current.startWidth + delta, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Calculate final width from ref to avoid stale closure
      if (resizeRef.current) {
        const delta = resizeRef.current.startX - e.clientX;
        const finalWidth = Math.min(Math.max(resizeRef.current.startWidth + delta, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth));
      }
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]); // Removed sidebarWidth to prevent listener recreation on every drag

  // Debounced fetch - prevents duplicate fetches within 5 seconds
  const debouncedFetch = useCallback((includeArchived: boolean) => {
    const now = Date.now();
    if (now - lastFetchRef.current < 5000) {
      return; // Skip if fetched within last 5 seconds
    }
    lastFetchRef.current = now;
    fetchThreads(includeArchived);
  }, [fetchThreads]);

  useEffect(() => {
    // Prevent double-init from StrictMode
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      lastFetchRef.current = Date.now();
      // Always fetch with archived=true so we can display accurate archived count
      await fetchThreads(true);
      const state = useThreadStore.getState();
      const threads = state.threads;

      if (threads.length === 0) {
        // Auto-create default main thread if none exist
        try {
          const thread = await createThread({
            title: 'Main Thread',
            workDir: undefined, // API will use current directory
          });
          setActiveThread(thread.id);
        } catch (err) {
          console.error('Failed to create default thread:', err);
        }
      } else if (!state.activeThreadId) {
        // Auto-select the first main thread (no parent) or first thread
        const mainThread = threads.find(t => !t.parentId) || threads[0];
        setActiveThread(mainThread.id);
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch threads on visibility change (handles SSE race conditions)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Always fetch with archived=true for accurate count display
        debouncedFetch(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [debouncedFetch]);

  // Periodic refresh fallback (every 60s when tab is active)
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        // Always fetch with archived=true for accurate count display
        debouncedFetch(true);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [debouncedFetch]);

  // Apply showArchivedByDefault on initial mount
  useEffect(() => {
    setShowArchived(showArchivedByDefault);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Keyboard shortcuts: Cmd+, for settings, Cmd+K for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        toggleSettings();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleSettings, toggleCommandPalette]);

  return (
    <div className={`flex h-screen bg-background overflow-hidden ${isResizing ? 'select-none' : ''}`}>
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-h-0">
        <header className="border-b border-border px-6 py-4 flex-shrink-0">
          <h1 className="text-xl font-semibold">MainThread</h1>
          <p className="text-sm text-muted-foreground">
            {activeThreadId ? `Thread: ${activeThreadId}` : 'Main conversation'}
          </p>
        </header>
        <ChatPanel />
      </div>

      {/* Resize handle */}
      <div
        className={`w-1 cursor-col-resize hover:bg-primary/30 transition-colors flex-shrink-0 ${isResizing ? 'bg-primary/50' : 'bg-transparent'}`}
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />

      {/* Thread sidebar - resizable */}
      <div style={{ width: sidebarWidth }} className="flex-shrink-0">
        <ThreadSidebar />
      </div>

      {/* Settings panel (global modal) */}
      <SettingsPanel />

      {/* Command palette (Cmd+K) */}
      <CommandPalette />

      {/* Welcome modal (first-time users) */}
      <WelcomeModal />
    </div>
  );
}
