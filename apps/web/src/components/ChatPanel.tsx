import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useInView } from 'react-intersection-observer';
import {
  type Message,
  type ModelType,
  type PermissionMode,
  type StreamingBlock,
  type ThreadCreatedNotification as ThreadNotification,
  type TokenInfo,
  type PendingPlanApproval,
  useThreadStore,
} from '../store/threadStore';
import type { ChildPendingQuestion, CreateThreadOptions } from '../store/types';
import { CreateSubThreadModal } from './CreateSubThreadModal';
import { CreateThreadModal } from './CreateThreadModal';
import { ThinkingBlock } from './ThinkingBlock';
import { InlineQuestionBlock } from './InlineQuestionBlock';
import { ThreadCreatedNotification } from './ThreadCreatedNotification';
import { SubthreadCompletionNotification } from './SubthreadCompletionNotification';
import { ThreadHeader } from './ThreadHeader';
import { MessageInput } from './MessageInput';
import { MessageBubble, StreamingMessage, StreamingToolBlock } from './MessageBubble';
import { PlanApprovalBlock } from './PlanApprovalBlock';
import { ProcessingBlock } from './ProcessingBlock';
import { ToolHistoryBlock } from './ToolHistoryBlock';
import { ThreadMinimap } from './ThreadMinimap';

// Type for grouped streaming blocks
type StreamingBlockGroup =
  | { type: 'single'; block: StreamingBlock }
  | { type: 'tool_group'; blocks: StreamingBlock[] };

// Group consecutive tool_use blocks together for accumulating display
function groupStreamingBlocks(blocks: StreamingBlock[]): StreamingBlockGroup[] {
  const groups: StreamingBlockGroup[] = [];
  let currentToolGroup: StreamingBlock[] = [];

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      currentToolGroup.push(block);
    } else {
      // Flush any pending tool group
      if (currentToolGroup.length > 0) {
        groups.push(
          currentToolGroup.length === 1
            ? { type: 'single', block: currentToolGroup[0] }
            : { type: 'tool_group', blocks: currentToolGroup }
        );
        currentToolGroup = [];
      }
      groups.push({ type: 'single', block });
    }
  }

  // Flush remaining tool group
  if (currentToolGroup.length > 0) {
    groups.push(
      currentToolGroup.length === 1
        ? { type: 'single', block: currentToolGroup[0] }
        : { type: 'tool_group', blocks: currentToolGroup }
    );
  }

  return groups;
}

// Hook to fetch token info for a thread
function useTokenInfo(threadId: string | null): { tokenInfo: TokenInfo | null; isLoading: boolean } {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!threadId) {
      setTokenInfo(null);
      return;
    }

    let cancelled = false;

    const fetchTokenInfo = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/threads/${threadId}/tokens`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setTokenInfo(data);
        }
      } catch {
        // Silently fail - token info is supplementary
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchTokenInfo();
    const interval = setInterval(fetchTokenInfo, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [threadId]);

  return { tokenInfo, isLoading };
}

// Component to render a single streaming block based on its type
function StreamingBlockRenderer({
  block,
  threadId,
  expandedBlockId,
  onToggleExpanded,
}: {
  block: StreamingBlock;
  threadId: string;
  expandedBlockId: string | null;
  onToggleExpanded: (blockId: string) => void;
}) {
  // Generate a unique block ID for thinking blocks
  const blockId = block.type === 'thinking' ? `thinking-${block.timestamp}` : block.id;
  // Block is actively streaming if not finalized
  const isActivelyStreaming = !block.isFinalized;

  switch (block.type) {
    case 'text':
      return block.content ? <StreamingMessage content={block.content} isStreaming={isActivelyStreaming} /> : null;
    case 'thinking':
      return block.content ? (
        <ThinkingBlock
          content={block.content}
          isStreaming={isActivelyStreaming}
          blockId={blockId}
          isExpanded={expandedBlockId === blockId}
          onToggle={() => onToggleExpanded(blockId!)}
        />
      ) : null;
    case 'tool_use':
      return (
        <StreamingToolBlock
          name={block.name}
          input={block.input as Record<string, unknown>}
          isComplete={block.isComplete}
          toolUseId={block.id}
          isCollapsed={block.isCollapsed}
          isError={block.isError}
          submittedAnswers={block.submittedAnswers}
        />
      );
    default:
      return null;
  }
}

export function ChatPanel() {
  // Use individual selectors for state to avoid over-subscription
  const threads = useThreadStore((state) => state.threads);
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const streamingBlocks = useThreadStore((state) => state.streamingBlocks);
  const expandedStreamingBlockId = useThreadStore((state) => state.expandedStreamingBlockId);
  const pendingQuestion = useThreadStore((state) => state.pendingQuestion);
  const pendingPlanApproval = useThreadStore((state) => state.pendingPlanApproval);
  const handlePlanAction = useThreadStore((state) => state.handlePlanAction);
  const threadNotifications = useThreadStore((state) => state.threadNotifications);
  const spawnedThreadIds = useThreadStore((state) => state.spawnedThreadIds);
  const error = useThreadStore((state) => state.error);
  const queueWaiting = useThreadStore((state) => state.queueWaiting);

  // Actions don't cause re-renders, safe to group
  const sendMessage = useThreadStore((state) => state.sendMessage);
  const createThread = useThreadStore((state) => state.createThread);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);
  const setExpandedStreamingBlockId = useThreadStore((state) => state.setExpandedStreamingBlockId);
  const clearPendingQuestion = useThreadStore((state) => state.clearPendingQuestion);
  const answerQuestion = useThreadStore((state) => state.answerQuestion);
  const updateThreadConfig = useThreadStore((state) => state.updateThreadConfig);
  const clearThreadMessages = useThreadStore((state) => state.clearThreadMessages);
  const archiveThread = useThreadStore((state) => state.archiveThread);
  const stopThread = useThreadStore((state) => state.stopThread);

  const childPendingQuestions = useThreadStore((state) => state.childPendingQuestions);

  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showProcessingIndicator, setShowProcessingIndicator] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const minimapManuallyClosedRef = useRef(false);
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track if user is at bottom for smart auto-scroll
  const { ref: scrollAnchorRef, inView: isAtBottom } = useInView({
    threshold: 1,
  });

  // Fetch token info for context monitoring
  const { tokenInfo } = useTokenInfo(activeThreadId);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId),
    [threads, activeThreadId]
  );

  const parentThread = useMemo(
    () => (activeThread?.parentId ? threads.find((t) => t.id === activeThread.parentId) : null),
    [threads, activeThread]
  );

  const messages = activeThread?.messages || [];

  const currentStreamingBlocks = useMemo(
    () => (activeThreadId ? streamingBlocks[activeThreadId] || [] : []),
    [activeThreadId, streamingBlocks]
  );

  const currentPendingQuestion = useMemo(
    () => (activeThreadId ? pendingQuestion[activeThreadId] : undefined),
    [activeThreadId, pendingQuestion]
  );

  const currentPlanApproval = useMemo(
    () => (activeThreadId ? pendingPlanApproval[activeThreadId] : undefined),
    [activeThreadId, pendingPlanApproval]
  );

  const currentThreadNotifications = useMemo(
    () => (activeThreadId ? threadNotifications[activeThreadId] || [] : []),
    [activeThreadId, threadNotifications]
  );

  const currentExpandedBlockId = useMemo(
    () => (activeThreadId ? expandedStreamingBlockId[activeThreadId] || null : null),
    [activeThreadId, expandedStreamingBlockId]
  );

  // Child pending questions for the active thread
  const activeChildQuestions = useMemo(() => {
    if (!activeThreadId || !childPendingQuestions) return [];
    return childPendingQuestions[activeThreadId] || [];
  }, [activeThreadId, childPendingQuestions]);

  // Check if thread is read-only or ephemeral
  const isReadOnly = activeThread?.isReadOnly === true || activeThread?.isEphemeral === true;

  // Auto-show minimap when active sub-threads exist, auto-hide when all done
  const hasActiveSubThreads = useMemo(
    () => threads.some((t) => t.parentId && !t.archivedAt && t.status !== 'done'),
    [threads]
  );
  const hasAnySubThreads = useMemo(
    () => threads.some((t) => t.parentId && !t.archivedAt),
    [threads]
  );
  const minimapFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hasActiveSubThreads && !showMinimap && !minimapManuallyClosedRef.current) {
      if (minimapFadeTimerRef.current) clearTimeout(minimapFadeTimerRef.current);
      setShowMinimap(true);
    } else if (!hasActiveSubThreads && showMinimap && !minimapManuallyClosedRef.current) {
      // All sub-threads done - fade out after delay
      minimapFadeTimerRef.current = setTimeout(() => {
        if (!minimapManuallyClosedRef.current) {
          setShowMinimap(false);
        }
      }, 3000);
    }
    return () => {
      if (minimapFadeTimerRef.current) clearTimeout(minimapFadeTimerRef.current);
    };
  }, [hasActiveSubThreads]);

  // Minimum display time for ProcessingBlock (400ms) to ensure visibility
  const shouldShowProcessing = (activeThread?.status === 'pending' || activeThread?.status === 'running') && currentStreamingBlocks.length === 0;

  useEffect(() => {
    if (shouldShowProcessing) {
      // Show immediately when conditions are met
      setShowProcessingIndicator(true);
      // Clear any pending hide timer
      if (processingTimerRef.current) {
        clearTimeout(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    } else if (showProcessingIndicator) {
      // Delay hiding by minimum display time
      processingTimerRef.current = setTimeout(() => {
        setShowProcessingIndicator(false);
        processingTimerRef.current = null;
      }, 400);
    }

    return () => {
      if (processingTimerRef.current) {
        clearTimeout(processingTimerRef.current);
      }
    };
  }, [shouldShowProcessing, showProcessingIndicator]);

  const handleToggleStreamingBlock = useCallback(
    (blockId: string) => {
      if (!activeThreadId) return;
      // Toggle: if already expanded, collapse; otherwise expand this one
      const newId = currentExpandedBlockId === blockId ? null : blockId;
      setExpandedStreamingBlockId(activeThreadId, newId);
    },
    [activeThreadId, currentExpandedBlockId, setExpandedStreamingBlockId]
  );

  // Combine messages and notifications for chronological rendering
  type TimelineItem =
    | { type: 'message'; data: Message; timestamp: string }
    | { type: 'notification'; data: ThreadNotification; timestamp: string };

  // Get set of thread IDs spawned via SpawnThread tool (to avoid duplicate notifications)
  const spawnedThreadIdSet = useMemo(() => new Set(Object.values(spawnedThreadIds || {})), [spawnedThreadIds]);

  const timelineItems = useMemo<TimelineItem[]>(() => {
    // Filter out "thread created" notifications for threads spawned via SpawnThread tool
    // (those are already shown inline as tool calls)
    const filteredNotifications = currentThreadNotifications.filter(notif => {
      // Keep completion notifications (status: done/needs_attention)
      if (notif.status) return true;
      // Filter out creation notifications for SpawnThread-created threads
      return !spawnedThreadIdSet.has(notif.threadId);
    });

    const items: TimelineItem[] = [
      ...messages.map((msg) => ({
        type: 'message' as const,
        data: msg,
        timestamp: msg.timestamp,
      })),
      ...filteredNotifications.map((notif) => ({
        type: 'notification' as const,
        data: notif,
        timestamp: notif.timestamp,
      })),
    ];
    return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, currentThreadNotifications, spawnedThreadIdSet]);

  // Smart auto-scroll
  useEffect(() => {
    if (isAtBottom && currentStreamingBlocks.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentStreamingBlocks, isAtBottom]);

  // Auto-scroll when new messages arrive (only if user is at bottom)
  // Always scroll on thread switch to show latest content
  const prevThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    const threadChanged = prevThreadIdRef.current !== activeThreadId;
    prevThreadIdRef.current = activeThreadId;

    // Always scroll on thread switch, otherwise only if at bottom
    if (threadChanged || isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, activeThreadId, isAtBottom]);

  // Clear local error after delay
  useEffect(() => {
    if (localError) {
      const timer = setTimeout(() => setLocalError(null), 30000);
      return () => clearTimeout(timer);
    }
  }, [localError]);

  const handleSendMessage = useCallback(
    async (
      content: string,
      images?: Array<{ id: string; data: string; media_type: string; preview: string; name: string }>,
      fileRefs?: string[]
    ) => {
      if (!activeThreadId) return;
      setLocalError(null);

      // Convert images to the format expected by the API
      const apiImages = images?.map(img => ({ data: img.data, media_type: img.media_type }));

      await sendMessage(activeThreadId, content, {
        images: apiImages,
        fileRefs,
      });
    },
    [activeThreadId, sendMessage]
  );

  const handleCreateThread = async (options: CreateThreadOptions) => {
    setShowCreateModal(false);
    setLocalError(null);

    try {
      setIsCreatingThread(true);
      const thread = await createThread(options);
      setActiveThread(thread.id);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to create thread');
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleSpawnThread = async (options: { title: string; model: ModelType; permissionMode: PermissionMode }) => {
    setShowSpawnModal(false);
    setLocalError(null);

    try {
      const thread = await createThread({
        title: options.title,
        parentId: activeThreadId || undefined,
        model: options.model,
        permissionMode: options.permissionMode,
      });
      setActiveThread(thread.id);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to create thread');
    }
  };

  const handleModelChange = useCallback(
    async (model: ModelType) => {
      if (!activeThreadId) return;
      await updateThreadConfig(activeThreadId, { model });
    },
    [activeThreadId, updateThreadConfig]
  );

  const handleThinkingToggle = useCallback(
    async (enabled: boolean) => {
      if (!activeThread) return;
      await updateThreadConfig(activeThread.id, { extendedThinking: enabled });
    },
    [activeThread, updateThreadConfig]
  );

  const handlePermissionModeChange = useCallback(
    async (mode: PermissionMode) => {
      if (!activeThread) return;
      await updateThreadConfig(activeThread.id, { permissionMode: mode });
    },
    [activeThread, updateThreadConfig]
  );

  const handleClearThread = useCallback(async () => {
    if (!activeThreadId) return;
    if (!confirm('Clear all messages in this thread? This cannot be undone.')) return;

    try {
      await clearThreadMessages(activeThreadId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to clear thread');
    }
  }, [activeThreadId, clearThreadMessages]);

  const handleArchiveThread = useCallback(async () => {
    if (!activeThreadId) return;

    try {
      await archiveThread(activeThreadId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to archive thread');
    }
  }, [activeThreadId, archiveThread]);

  const handleStopThread = useCallback(async () => {
    if (!activeThreadId) return;

    try {
      await stopThread(activeThreadId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to stop thread');
    }
  }, [activeThreadId, stopThread]);


  const displayError = localError || error;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Error banner */}
      {displayError && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-3 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex-1">
            <p className="text-red-600 text-sm font-medium">Error</p>
            <p className="text-red-600/80 text-sm font-mono mt-0.5">{displayError}</p>
          </div>
          <button
            onClick={() => setLocalError(null)}
            className="text-red-500 hover:text-red-700 p-1"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Thread header */}
      {activeThread && (
        <div className="relative">
          <ThreadHeader
            thread={activeThread}
            parentThread={parentThread || undefined}
            tokenInfo={tokenInfo}
            onNavigateToParent={() => parentThread && setActiveThread(parentThread.id)}
            onClearThread={handleClearThread}
            onArchiveThread={handleArchiveThread}
            showMinimap={showMinimap}
            onToggleMinimap={() => {
              setShowMinimap((v) => {
                if (v) minimapManuallyClosedRef.current = true;
                else minimapManuallyClosedRef.current = false;
                return !v;
              });
            }}
          />
          {/* Read-only badge */}
          {isReadOnly && (
            <span className="absolute top-2 right-32 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-500 text-xs border border-gray-500/20">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Read-only
            </span>
          )}
        </div>
      )}

      {/* Minimap rendered as floating widget inside messages area */}

      {/* Child pending question banner */}
      {activeChildQuestions.length > 0 && (
        <div className="flex-shrink-0">
          {activeChildQuestions.map((cpq) => (
            <div
              key={cpq.childThreadId}
              className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-3"
            >
              <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-amber-700 dark:text-amber-400 flex-1">
                Sub-thread &lsquo;{cpq.childTitle}&rsquo; needs your input
              </span>
              <button
                onClick={() => setActiveThread(cpq.childThreadId)}
                className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-500/30 transition-colors border border-amber-500/30"
              >
                Go to thread
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 relative">
        {messages.length === 0 && currentThreadNotifications.length === 0 && currentStreamingBlocks.length === 0 && activeThread?.status !== 'pending' && activeThread?.status !== 'running' && (
          <div className="text-center text-muted-foreground py-12">
            <p className="text-lg">Start a conversation</p>
            <p className="text-sm">Type a message below to begin</p>
          </div>
        )}

        {/* Render messages and notifications chronologically */}
        {timelineItems.map((item, index) => {
          // Skip content_blocks for the placeholder streaming message.
          // The atomic complete handler clears streaming blocks and adds persisted
          // messages in a single set() call, so there's no overlap window.
          const shouldSkipContentBlocks = item.type === 'message' &&
            item.data.role === 'assistant' &&
            item.data.content === '[streaming...]';

          return item.type === 'message' ? (
            <MessageBubble key={item.data.id} message={item.data} skipContentBlocks={shouldSkipContentBlocks} />
          ) : item.data.status ? (
            <SubthreadCompletionNotification
              key={`completion-${item.data.threadId}-${item.timestamp}`}
              notification={item.data}
              onNavigate={(id) => setActiveThread(id)}
            />
          ) : (
            <ThreadCreatedNotification
              key={`created-${item.data.threadId}`}
              notification={item.data}
              onNavigate={(id) => setActiveThread(id)}
            />
          );
        })}

        {/* Streaming blocks - grouped for accumulating tool display */}
        {activeThreadId && groupStreamingBlocks(currentStreamingBlocks).map((group) => {
          if (group.type === 'single') {
            const block = group.block;
            // Use block id or timestamp as stable key
            const stableKey = block.id || `block-${block.timestamp}`;
            return (
              <StreamingBlockRenderer
                key={stableKey}
                block={block}
                threadId={activeThreadId}
                expandedBlockId={currentExpandedBlockId}
                onToggleExpanded={handleToggleStreamingBlock}
              />
            );
          } else {
            // Render tool group using ToolHistoryBlock
            // Use first block's id/timestamp as stable key for the group
            const firstBlock = group.blocks[0];
            const groupKey = `tool-group-${firstBlock.id || firstBlock.timestamp}`;
            const tools = group.blocks.map((b) => ({
              name: b.name || 'unknown',
              input: b.input,
              id: b.id,
              isComplete: b.isComplete ?? false,
            }));
            return <ToolHistoryBlock key={groupKey} tools={tools} onNavigateToThread={setActiveThread} />;
          }
        })}

        {/* Processing indicator - with minimum display time for visibility */}
        {showProcessingIndicator && (
          <ProcessingBlock message={queueWaiting?.[activeThread?.id || ''] ? 'Waiting for available slot...' : undefined} />
        )}

        {/* Inline question block */}
        {currentPendingQuestion && activeThreadId && (
          <InlineQuestionBlock
            questions={currentPendingQuestion}
            onAnswer={async (answers) => {
              try {
                await answerQuestion(activeThreadId, answers);
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : 'Failed to submit answer');
              }
            }}
            onCancel={() => {
              if (activeThreadId) {
                clearPendingQuestion(activeThreadId);
              }
            }}
          />
        )}

        {/* Plan approval block */}
        {currentPlanApproval && activeThreadId && (
          <PlanApprovalBlock
            planFilePath={currentPlanApproval.planFilePath}
            planContent={currentPlanApproval.planContent}
            threadId={activeThreadId}
            onProceed={async (mode) => {
              try {
                await handlePlanAction(activeThreadId, 'proceed', mode);
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : 'Failed to proceed with plan');
              }
            }}
            onModify={async () => {
              try {
                await handlePlanAction(activeThreadId, 'modify');
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : 'Failed to modify plan');
              }
            }}
            onCompact={async () => {
              try {
                await handlePlanAction(activeThreadId, 'compact');
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : 'Failed to compact context');
              }
            }}
          />
        )}

        {/* Scroll anchors */}
        <div ref={scrollAnchorRef} className="h-1" />
        <div ref={messagesEndRef} />

      </div>

      {/* Floating minimap - fixed to viewport bottom-right */}
      {showMinimap && (
        <ThreadMinimap
          threads={threads}
          activeThreadId={activeThreadId}
          onNavigate={setActiveThread}
        />
      )}

      {/* Experimental nesting indicator */}
      {activeThread && !activeThread.parentId && activeThread.allowNestedSubthreads && (
        <div className="mx-6 mb-2">
          <div className="border border-dashed border-muted-foreground/30 rounded-lg px-3 py-2 bg-muted/20 text-muted-foreground text-xs flex items-center gap-2">
            <span>&#x2697;&#xFE0F;</span>
            <span>
              <span className="font-medium">Experimental: Nesting</span>
              {' '}— Sub-threads can nest up to {activeThread.maxThreadDepth ?? 1} level{(activeThread.maxThreadDepth ?? 1) !== 1 ? 's' : ''} deep
            </span>
          </div>
        </div>
      )}

      {/* Input area */}
      {activeThread && !isReadOnly && (
        <MessageInput
          thread={activeThread}
          disabled={isCreatingThread}
          onSendMessage={handleSendMessage}
          onCreateThread={() => setShowSpawnModal(true)}
          onModelChange={handleModelChange}
          onPermissionModeChange={handlePermissionModeChange}
          onThinkingToggle={handleThinkingToggle}
          onStopThread={handleStopThread}
          onError={setLocalError}
        />
      )}

      {/* Modals */}
      <CreateSubThreadModal
        isOpen={showSpawnModal}
        parentModel={activeThread?.model || 'claude-opus-4-5'}
        parentPermissionMode={activeThread?.permissionMode || 'acceptEdits'}
        onSubmit={handleSpawnThread}
        onCancel={() => setShowSpawnModal(false)}
      />

      <CreateThreadModal
        isOpen={showCreateModal}
        onSubmit={handleCreateThread}
        onCancel={() => setShowCreateModal(false)}
      />
    </div>
  );
}
