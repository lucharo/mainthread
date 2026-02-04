import { useMemo, useState, useRef, useEffect } from 'react';
import {
  type ModelType,
  type Thread,
  type ThreadStatus,
  useThreadStore,
} from '../store/threadStore';
import { useSettingsStore } from '../store/settingsStore';
import { CreateThreadModal } from './CreateThreadModal';
import { Toggle } from './Toggle';

// Simplified status colors: Green (ready), Red (stopped), Orange (processing)
const STATUS_COLORS: Record<ThreadStatus, { bg: string; label: string }> = {
  needs_attention: { bg: 'bg-red-500', label: 'Needs attention' },
  pending: { bg: 'bg-orange-500', label: 'Processing' },
  active: { bg: 'bg-green-500', label: 'Active' },
  done: { bg: 'bg-green-500', label: 'Done' },
  new_message: { bg: 'bg-red-500', label: 'New message' },
};

function StatusDot({ status }: { status: ThreadStatus }) {
  const config = STATUS_COLORS[status];
  const isPending = status === 'pending';
  return (
    <span
      className={`w-2 h-2 rounded-full ${config.bg} flex-shrink-0 ${isPending ? 'animate-neon-blink' : ''}`}
      title={config.label}
      aria-label={`Thread status: ${config.label}`}
      role="status"
    />
  );
}

const MODEL_BADGES: Record<ModelType, { short: string; full: string; color: string }> = {
  'claude-sonnet-4-5': { short: 'Sonnet', full: 'Sonnet 4.5', color: 'bg-purple-500/20 text-purple-600' },
  'claude-opus-4-5': { short: 'Opus', full: 'Opus 4.5', color: 'bg-orange-500/20 text-orange-600' },
  'claude-haiku-4-5': { short: 'Haiku', full: 'Haiku 4.5', color: 'bg-green-500/20 text-green-600' },
};

const DEFAULT_BADGE = { short: '?', full: 'Unknown', color: 'bg-gray-500/20 text-gray-600' };

export function ThreadSidebar() {
  // Use individual selectors to avoid over-subscription
  const threads = useThreadStore((state) => state.threads);
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const showArchived = useThreadStore((state) => state.showArchived);

  // Actions are stable references, won't cause re-renders
  const setActiveThread = useThreadStore((state) => state.setActiveThread);
  const createThread = useThreadStore((state) => state.createThread);
  const archiveThread = useThreadStore((state) => state.archiveThread);
  const unarchiveThread = useThreadStore((state) => state.unarchiveThread);
  const resetAllThreads = useThreadStore((state) => state.resetAllThreads);
  const setShowArchived = useThreadStore((state) => state.setShowArchived);
  const stopThread = useThreadStore((state) => state.stopThread);
  const sendMessage = useThreadStore((state) => state.sendMessage);
  const updateThreadTitle = useThreadStore((state) => state.updateThreadTitle);

  // Use global modal state (supports Cmd+N shortcut)
  const isCreateModalOpen = useSettingsStore((state) => state.isCreateThreadModalOpen);
  const openCreateModal = useSettingsStore((state) => state.openCreateThreadModal);
  const closeCreateModal = useSettingsStore((state) => state.closeCreateThreadModal);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track expanded threads in React state (not module-level) to trigger proper re-renders
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  // Memoize thread groupings - separate active and archived (including sub-threads)
  const { mainThreads, archivedMainThreads, archivedSubThreads, subThreadsByParent, totalArchivedCount } = useMemo(() => {
    const mains = threads.filter((t) => !t.parentId && !t.archivedAt);
    const archivedMains = threads.filter((t) => !t.parentId && t.archivedAt);
    const archivedSubs = threads.filter((t) => t.parentId && t.archivedAt);
    const subsMap = new Map<string, Thread[]>();

    // Only include non-archived sub-threads in the active sub-threads map
    threads
      .filter((t) => t.parentId && !t.archivedAt)
      .forEach((t) => {
        const existing = subsMap.get(t.parentId!) || [];
        subsMap.set(t.parentId!, [...existing, t]);
      });

    return {
      mainThreads: mains,
      archivedMainThreads: archivedMains,
      archivedSubThreads: archivedSubs,
      subThreadsByParent: subsMap,
      totalArchivedCount: archivedMains.length + archivedSubs.length,
    };
  }, [threads]);

  const handleCreateMain = async (options: { title: string; workDir?: string; model?: ModelType; extendedThinking?: boolean }) => {
    closeCreateModal();
    setError(null);

    try {
      const thread = await createThread(options);
      setActiveThread(thread.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create thread';
      setError(message);
    }
  };

  const handleArchive = async (threadId: string) => {
    setError(null);
    try {
      await archiveThread(threadId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to archive thread';
      setError(message);
    }
  };

  const handleToggleExpand = (threadId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  };

  const handleUnarchive = async (threadId: string) => {
    setError(null);
    try {
      await unarchiveThread(threadId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unarchive thread';
      setError(message);
    }
  };

  const handleStopThread = async (threadId: string) => {
    setError(null);
    try {
      await stopThread(threadId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop thread';
      setError(message);
    }
  };


  const handleResetAll = async () => {
    setShowResetConfirm(false);
    setError(null);
    try {
      await resetAllThreads();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset threads';
      setError(message);
    }
  };

  const handleRenameThread = async (threadId: string, newTitle: string) => {
    setError(null);
    try {
      await updateThreadTitle(threadId, newTitle);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rename thread';
      setError(message);
      throw err; // Re-throw so ThreadItem can revert
    }
  };

  return (
    <aside className="w-full h-full border-l border-border bg-muted/30 flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <h2 className="font-semibold">Threads</h2>
        <button
          onClick={openCreateModal}
          className="text-sm px-2 py-1 rounded hover:bg-muted"
          aria-label="Create new thread"
          title="Create new thread (&#8984;N)"
        >
          + New
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 bg-red-500/10">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {threads.length === 0 && (
          <p className="text-sm text-muted-foreground p-2">No threads yet</p>
        )}

        {mainThreads.map((thread) => (
          <ThreadItem
            key={thread.id}
            thread={thread}
            subThreads={subThreadsByParent.get(thread.id) || []}
            isActive={thread.id === activeThreadId}
            onSelect={() => setActiveThread(thread.id)}
            activeThreadId={activeThreadId}
            onSelectSub={setActiveThread}
            onArchive={handleArchive}
            onStop={handleStopThread}
            onRename={handleRenameThread}
            isExpanded={expandedThreads.has(thread.id)}
            onToggleExpand={handleToggleExpand}
          />
        ))}

        {/* Archived threads section */}
        {showArchived && totalArchivedCount > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground px-2 mb-2 uppercase tracking-wide">Archived</p>
            {/* Archived main threads */}
            {archivedMainThreads.map((thread) => (
              <ArchivedThreadItem
                key={thread.id}
                thread={thread}
                onUnarchive={handleUnarchive}
                onSelect={() => setActiveThread(thread.id)}
                isActive={thread.id === activeThreadId}
              />
            ))}
            {/* Archived sub-threads (shown with parent reference) */}
            {archivedSubThreads.map((thread) => (
              <ArchivedThreadItem
                key={thread.id}
                thread={thread}
                onUnarchive={handleUnarchive}
                onSelect={() => setActiveThread(thread.id)}
                isActive={thread.id === activeThreadId}
                isSubThread
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with toggle and reset */}
      <div className="p-3 border-t border-border space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <Toggle
            enabled={showArchived}
            onChange={setShowArchived}
            label="Show archived"
          />
          <span className="text-xs text-muted-foreground">
            {totalArchivedCount} archived
          </span>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="w-full text-xs px-2 py-1.5 rounded border border-red-500/30 text-red-600 hover:bg-red-500/10"
        >
          Reset All Threads
        </button>
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg p-6 max-w-sm mx-4">
            <h3 className="font-semibold text-lg mb-2">Reset All Threads?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will permanently delete all threads and messages. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleResetAll}
                className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700"
              >
                Reset All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create thread modal */}
      <CreateThreadModal
        isOpen={isCreateModalOpen}
        onSubmit={handleCreateMain}
        onCancel={closeCreateModal}
      />
    </aside>
  );
}

interface ThreadItemProps {
  thread: Thread;
  subThreads: Thread[];
  isActive: boolean;
  onSelect: () => void;
  activeThreadId: string | null;
  onSelectSub: (id: string) => void;
  onArchive: (threadId: string) => void;
  onStop: (threadId: string) => void;
  onRename: (threadId: string, newTitle: string) => Promise<void>;
  isExpanded: boolean;
  onToggleExpand: (threadId: string) => void;
}

function ThreadItem({
  thread,
  subThreads,
  isActive,
  onSelect,
  activeThreadId,
  onSelectSub,
  onArchive,
  onStop,
  onRename,
  isExpanded,
  onToggleExpand,
}: ThreadItemProps) {
  const statusConfig = STATUS_COLORS[thread.status];
  const modelBadge = MODEL_BADGES[thread.model] || DEFAULT_BADGE;
  const hasSubThreads = subThreads.length > 0;

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(thread.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-expand if a sub-thread is active
  const isSubActive = subThreads.some((sub) => sub.id === activeThreadId);
  const showSubThreads = isExpanded || isSubActive;

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(thread.id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(thread.title);
    setIsEditing(true);
  };

  const handleSaveTitle = async () => {
    const trimmedTitle = editTitle.trim();
    if (trimmedTitle && trimmedTitle !== thread.title) {
      try {
        await onRename(thread.id, trimmedTitle);
      } catch {
        // Revert on error
        setEditTitle(thread.title);
      }
    } else {
      setEditTitle(thread.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditTitle(thread.title);
      setIsEditing(false);
    }
  };

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <div className="mb-1 group">
      <div className="flex items-center">
        {/* Expand/collapse button for threads with sub-threads */}
        {hasSubThreads ? (
          <button
            onClick={toggleExpand}
            className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label={isExpanded ? 'Collapse sub-threads' : 'Expand sub-threads'}
          >
            <svg
              className={`w-3 h-3 transition-transform ${showSubThreads ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <div className="w-5 flex-shrink-0" />
        )}

        <button
          onClick={onSelect}
          onDoubleClick={handleDoubleClick}
          className={`flex-1 text-left px-2 py-2 rounded-lg flex items-center gap-2
                      ${isActive ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted'}`}
          aria-label={`Select thread: ${thread.title}, status: ${statusConfig.label}`}
        >
          <StatusDot status={thread.status} />
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="w-full text-sm bg-background border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                maxLength={255}
              />
            ) : (
              <span className="block truncate text-sm">{thread.title}</span>
            )}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {/* Model + thinking combined badge */}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${modelBadge.color}`} title={thread.model}>
                {modelBadge.short}{thread.extendedThinking ? ' · Thinking' : ''}
              </span>
              {/* Git branch badge */}
              {thread.gitBranch && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600 truncate max-w-[80px]" title={thread.gitBranch}>
                  {thread.gitBranch}
                </span>
              )}
              {/* Sub-thread count badge */}
              {hasSubThreads && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-600">
                  {subThreads.length} sub-thread{subThreads.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0 w-5 text-right">
            {thread.messages.length}
          </span>
        </button>

        {/* Stop button - shown on hover for pending threads */}
        {thread.status === 'pending' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStop(thread.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-600 transition-opacity"
            title="Stop thread"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        )}

        {/* Archive button - shown on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArchive(thread.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
          title="Archive thread"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        </button>
      </div>

      {/* Sub-threads - collapsible with scroll for many items */}
      {showSubThreads && subThreads.length > 0 && (
        <ScrollableSubThreads
          subThreads={subThreads}
          activeThreadId={activeThreadId}
          onSelectSub={onSelectSub}
          onStop={onStop}
          onArchive={onArchive}
          onRename={onRename}
        />
      )}
    </div>
  );
}

const MAX_VISIBLE_SUBTHREADS = 5;
const SUBTHREAD_ITEM_HEIGHT = 52; // Approximate height of each sub-thread item in pixels

interface ScrollableSubThreadsProps {
  subThreads: Thread[];
  activeThreadId: string | null;
  onSelectSub: (id: string) => void;
  onStop: (threadId: string) => void;
  onArchive: (threadId: string) => void;
  onRename: (threadId: string, newTitle: string) => Promise<void>;
}

function ScrollableSubThreads({
  subThreads,
  activeThreadId,
  onSelectSub,
  onStop,
  onArchive,
  onRename,
}: ScrollableSubThreadsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const needsScroll = subThreads.length > MAX_VISIBLE_SUBTHREADS;
  const maxHeight = MAX_VISIBLE_SUBTHREADS * SUBTHREAD_ITEM_HEIGHT;

  // Update scroll indicators based on scroll position
  const updateScrollIndicators = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(el.scrollTop < el.scrollHeight - el.clientHeight - 1);
  };

  // Initial check and on sub-threads change
  useEffect(() => {
    updateScrollIndicators();
  }, [subThreads.length]);

  // Scroll to active sub-thread if it exists
  useEffect(() => {
    if (!activeThreadId || !scrollRef.current) return;
    const activeIndex = subThreads.findIndex((s) => s.id === activeThreadId);
    if (activeIndex >= 0) {
      const targetScroll = activeIndex * SUBTHREAD_ITEM_HEIGHT;
      scrollRef.current.scrollTo({ top: targetScroll - SUBTHREAD_ITEM_HEIGHT, behavior: 'smooth' });
    }
  }, [activeThreadId, subThreads]);

  return (
    <div className="ml-5 mt-1 relative">
      {/* Top scroll indicator */}
      {needsScroll && canScrollUp && (
        <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none flex items-start justify-center">
          <svg className="w-4 h-4 text-muted-foreground animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </div>
      )}

      {/* Scrollable container */}
      <div
        ref={scrollRef}
        onScroll={updateScrollIndicators}
        className="space-y-1 border-l-2 border-muted pl-1 overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
        style={needsScroll ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        {subThreads.map((sub) => (
          <SubThreadItem
            key={sub.id}
            sub={sub}
            isActive={sub.id === activeThreadId}
            onSelect={() => onSelectSub(sub.id)}
            onStop={onStop}
            onArchive={onArchive}
            onRename={onRename}
          />
        ))}
      </div>

      {/* Bottom scroll indicator */}
      {needsScroll && canScrollDown && (
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none flex items-end justify-center">
          <svg className="w-4 h-4 text-muted-foreground animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      )}

      {/* Thread count indicator when scrollable */}
      {needsScroll && (
        <div className="text-[10px] text-muted-foreground text-center mt-1">
          {subThreads.length} sub-threads
        </div>
      )}
    </div>
  );
}

interface SubThreadItemProps {
  sub: Thread;
  isActive: boolean;
  onSelect: () => void;
  onStop: (threadId: string) => void;
  onArchive: (threadId: string) => void;
  onRename: (threadId: string, newTitle: string) => Promise<void>;
}

function SubThreadItem({ sub, isActive, onSelect, onStop, onArchive, onRename }: SubThreadItemProps) {
  const subStatusConfig = STATUS_COLORS[sub.status];
  const subModelBadge = MODEL_BADGES[sub.model] || DEFAULT_BADGE;

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(sub.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(sub.title);
    setIsEditing(true);
  };

  const handleSaveTitle = async () => {
    const trimmedTitle = editTitle.trim();
    if (trimmedTitle && trimmedTitle !== sub.title) {
      try {
        await onRename(sub.id, trimmedTitle);
      } catch {
        // Revert on error
        setEditTitle(sub.title);
      }
    } else {
      setEditTitle(sub.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditTitle(sub.title);
      setIsEditing(false);
    }
  };

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <div className="flex items-center group">
      <button
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
        className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded flex items-center gap-1.5
                    ${isActive ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted'}`}
        aria-label={`Select sub-thread: ${sub.title}, status: ${subStatusConfig.label}`}
      >
        <StatusDot status={sub.status} />
        <div className="flex-1 min-w-0 overflow-hidden">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-xs bg-background border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
              maxLength={255}
            />
          ) : (
            <span className="block truncate text-xs">{sub.title}</span>
          )}
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {/* Model + thinking combined badge */}
            <span className={`text-[10px] px-1 rounded ${subModelBadge.color}`} title={sub.model}>
              {subModelBadge.short}{sub.extendedThinking ? ' · Thinking' : ''}
            </span>
            {sub.gitBranch && (
              <span className="text-[10px] px-1 rounded bg-blue-500/20 text-blue-600 truncate max-w-[60px]" title={sub.gitBranch}>
                {sub.gitBranch}
              </span>
            )}
            {sub.isWorktree && (
              <span
                className="text-[10px] px-1 rounded bg-cyan-500/20 text-cyan-600"
                title={sub.worktreeBranch ? `Worktree on ${sub.worktreeBranch}` : 'Worktree'}
              >
                Worktree
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0 w-5 text-right">
          {sub.messages.length}
        </span>
      </button>

      {/* Stop button */}
      {sub.status === 'pending' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStop(sub.id);
          }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-600 transition-opacity"
          title="Stop sub-thread"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
      )}

      {/* Archive button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onArchive(sub.id);
        }}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
        title="Archive sub-thread"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      </button>
    </div>
  );
}

interface ArchivedThreadItemProps {
  thread: Thread;
  onUnarchive: (threadId: string) => void;
  onSelect: () => void;
  isActive: boolean;
  isSubThread?: boolean;
}

function ArchivedThreadItem({ thread, onUnarchive, onSelect, isActive, isSubThread }: ArchivedThreadItemProps) {
  const modelBadge = MODEL_BADGES[thread.model] || DEFAULT_BADGE;

  return (
    <div className={`mb-1 group flex items-center ${isSubThread ? 'ml-4' : ''}`}>
      <div className="w-5 flex-shrink-0" />
      <button
        onClick={onSelect}
        className={`flex-1 text-left px-2 py-2 rounded-lg flex items-center gap-2 opacity-60 hover:opacity-100
                    ${isActive ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted'}`}
        aria-label={`Select archived ${isSubThread ? 'sub-' : ''}thread: ${thread.title}`}
      >
        {isSubThread ? (
          <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        )}
        <div className="flex-1 min-w-0 overflow-hidden">
          <span className="block truncate text-sm max-w-[160px]">{thread.title}</span>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {/* Model + thinking combined badge */}
            <span className={`text-[10px] px-1 rounded ${modelBadge.color}`} title={thread.model}>
              {modelBadge.short}{thread.extendedThinking ? ' · Thinking' : ''}
            </span>
            {/* Git branch badge for archived threads */}
            {thread.gitBranch && (
              <span className="text-[10px] px-1 rounded bg-blue-500/20 text-blue-600 truncate max-w-[60px]" title={thread.gitBranch}>
                {thread.gitBranch}
              </span>
            )}
            {isSubThread && (
              <span className="text-[10px] px-1 rounded bg-purple-500/20 text-purple-600">
                Sub-thread
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0 w-5 text-right">
          {thread.messages.length}
        </span>
      </button>

      {/* Restore button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUnarchive(thread.id);
        }}
        className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
        title="Restore thread"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
      </button>
    </div>
  );
}
