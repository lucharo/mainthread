import { useMemo, useEffect, useRef, useState } from 'react';
import { COLLAPSE_ANIMATION_DURATION_MS } from '../constants/animations';
import { useThreadStore } from '../store/threadStore';
import { formatToolName } from '../utils/format';
import { formatExpandedToolInput } from '../utils/formatToolInput';
import { getToolPreview } from '../utils/toolPreviews';
import { AssistantBlock } from './AssistantBlock';
import type { ToolUse } from './ToolUseBlock';

interface ToolHistoryBlockProps {
  tools: ToolUse[];
  onNavigateToThread?: (threadId: string) => void;
}

export function ToolHistoryBlock({ tools, onNavigateToThread }: ToolHistoryBlockProps) {
  const isSpawnOnly = tools.every(t => t.name === 'SpawnThread');
  const [expanded, setExpanded] = useState(isSpawnOnly);
  const threads = useThreadStore((state) => state.threads);

  // Helper to find thread by title (for SpawnThread navigation)
  const findThreadByTitle = (title: string): string | null => {
    const thread = threads.find((t) => t.title === title);
    return thread?.id || null;
  };

  // Helper to get thread title by ID
  const getThreadTitle = (threadId: string): string | null => {
    const thread = threads.find((t) => t.id === threadId);
    return thread?.title || null;
  };

  // Auto-collapse only when tools transition from incomplete to all complete
  const allComplete = tools.every((t) => t.isComplete);
  const wasIncomplete = useRef(!allComplete);
  useEffect(() => {
    if (allComplete && wasIncomplete.current && expanded) {
      const timer = setTimeout(() => setExpanded(false), COLLAPSE_ANIMATION_DURATION_MS);
      wasIncomplete.current = false;
      return () => clearTimeout(timer);
    }
    if (allComplete) {
      wasIncomplete.current = false;
    }
  }, [allComplete, expanded]);

  if (tools.length === 0) return null;

  const latestTool = tools[tools.length - 1];
  const totalCount = tools.length;

  // For SpawnThread-only groups, count completed sub-threads instead of tool calls
  const spawnedThreadsDone = isSpawnOnly
    ? tools.filter((t) => {
        const title = t.input?.title ? String(t.input.title) : null;
        if (!title) return false;
        const thread = threads.find((th) => th.title === title);
        return thread?.status === 'done';
      }).length
    : 0;
  const completedCount = isSpawnOnly ? spawnedThreadsDone : tools.filter((t) => t.isComplete).length;
  const hasRunning = isSpawnOnly
    ? completedCount < totalCount
    : tools.some((t) => !t.isComplete);

  // Get preview for the latest tool
  const latestPreview = getToolPreview(latestTool.name, latestTool.input, {
    maxLength: 35,
    getThreadTitle,
  });

  // Count of other tools
  const otherCount = totalCount - 1;

  return (
    <AssistantBlock>
      <div className="tool-history-block bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg my-2 overflow-hidden">
        {/* Collapsed header - shows current tool + count */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
          aria-expanded={expanded}
        >
          <span className="w-5 h-5 bg-gray-500 dark:bg-gray-400 rounded-full flex items-center justify-center text-white dark:text-gray-900 text-xs flex-shrink-0">
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </span>
          <span className="flex-1 text-left text-sm font-medium flex items-center gap-2">
            <span className="font-mono bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">
              {formatToolName(latestTool.name)}
            </span>
            {latestPreview && (
              <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                {latestPreview}
              </span>
            )}
            {otherCount > 0 && (
              <span className="text-xs text-muted-foreground">
                · +{otherCount} more
              </span>
            )}
            {hasRunning ? (
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 ml-auto">
                <svg
                  className="w-3 h-3 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                {completedCount}/{totalCount}
              </span>
            ) : (
              <span className="text-xs text-green-600 dark:text-green-400 ml-auto">
                ✓ {completedCount}/{totalCount}
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {/* Expanded list of all tools */}
        {expanded && (
          <div className="border-t border-gray-200 dark:border-gray-700 animate-slide-down">
            {tools.map((tool, index) => (
              <ToolHistoryItem
                key={tool.id || index}
                tool={tool}
                getThreadTitle={getThreadTitle}
                findThreadByTitle={findThreadByTitle}
                onNavigateToThread={onNavigateToThread}
              />
            ))}
          </div>
        )}
      </div>
    </AssistantBlock>
  );
}

function ToolHistoryItem({
  tool,
  getThreadTitle,
  findThreadByTitle,
  onNavigateToThread,
}: {
  tool: ToolUse;
  getThreadTitle: (id: string) => string | null;
  findThreadByTitle: (title: string) => string | null;
  onNavigateToThread?: (threadId: string) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  // Check if input is non-empty and not just an empty object {}
  const hasInput = tool.input && Object.keys(tool.input).length > 0;
  const hasMeaningfulInput = hasInput && JSON.stringify(tool.input) !== '{}';
  const preview = getToolPreview(tool.name, tool.input, { maxLength: 45, getThreadTitle });

  // Formatted expanded content
  const formatted = useMemo(() => {
    if (!tool.name || !tool.input) return null;
    return formatExpandedToolInput(tool.name, tool.input);
  }, [tool.name, tool.input]);

  // For SpawnThread, find the thread ID by title and check if it's live
  const isSpawnThread = tool.name === 'SpawnThread';
  const spawnedThreadTitle = isSpawnThread && tool.input?.title ? String(tool.input.title) : null;
  const spawnedThreadId = spawnedThreadTitle ? findThreadByTitle(spawnedThreadTitle) : null;
  const threads = useThreadStore((state) => state.threads);
  const spawnedThread = spawnedThreadId ? threads.find(t => t.id === spawnedThreadId) : null;
  const isLive = spawnedThread && spawnedThread.status !== 'pending';

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (spawnedThreadId && onNavigateToThread) {
      onNavigateToThread(spawnedThreadId);
    }
  };

  return (
    <div className="border-b border-gray-200/50 dark:border-gray-700/50 last:border-b-0">
      <div className="flex items-center">
        <button
          onClick={() => hasMeaningfulInput && setShowInput(!showInput)}
          className={`flex-1 flex items-center gap-2 px-4 py-1.5 text-sm ${hasMeaningfulInput ? 'cursor-pointer hover:bg-gray-200/30 dark:hover:bg-gray-700/30' : 'cursor-default'}`}
          disabled={!hasMeaningfulInput}
        >
          {tool.isComplete ? (
            <span className="text-green-600 dark:text-green-400 text-xs w-4 flex-shrink-0">✓</span>
          ) : (
            <svg
              className="w-3 h-3 text-gray-500 animate-spin flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}
          <span className="font-mono text-xs text-gray-600 dark:text-gray-400 flex-shrink-0">
            {formatToolName(tool.name)}
          </span>
          {preview && (
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1 text-left font-mono">
              {preview}
            </span>
          )}
          {hasMeaningfulInput && !isSpawnThread && (
            <svg
              className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform duration-200 ${showInput ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          )}
        </button>
        {/* Jump to thread button for SpawnThread - only clickable when thread is live (not pending) */}
        {isSpawnThread && spawnedThreadId && isLive && onNavigateToThread && (
          <button
            onClick={handleNavigate}
            className="px-2 py-1 mr-2 text-xs text-primary hover:bg-primary/10 rounded transition-colors flex items-center gap-1"
            title="Jump to thread"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
      {showInput && hasMeaningfulInput && formatted && (
        <div className="px-4 pb-2 text-xs text-gray-500 dark:text-gray-500 overflow-hidden max-w-full">
          {formatted.summary && (
            <div className="font-mono text-gray-600 dark:text-gray-400 mb-1">{formatted.summary}</div>
          )}
          {formatted.details && (
            <pre className="whitespace-pre-wrap break-words font-mono leading-relaxed bg-gray-200/50 dark:bg-gray-900/50 p-2 rounded">
              {formatted.details}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
