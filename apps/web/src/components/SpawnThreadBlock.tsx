import { memo, useState } from 'react';
import { type ThreadStatus, useThreadStore } from '../store/threadStore';
import { AssistantBlock } from './AssistantBlock';

interface SpawnThreadBlockProps {
  title: string;
  threadId?: string;
  threadStatus?: ThreadStatus;
  isStreaming?: boolean;
}

export const SpawnThreadBlock = memo(function SpawnThreadBlock({
  title,
  threadId,
  threadStatus,
  isStreaming = false,
}: SpawnThreadBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);
  const thread = useThreadStore((state) =>
    threadId ? state.threads.find((t) => t.id === threadId) : undefined,
  );

  const handleNavigate = () => {
    if (threadId) {
      setActiveThread(threadId);
    }
  };

  return (
    <AssistantBlock>
      <div className="spawn-thread-block bg-purple-50/60 dark:bg-purple-900/15 border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden my-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-2 px-3 py-2 text-purple-700 dark:text-purple-300 hover:bg-purple-100/50 dark:hover:bg-purple-800/30 transition-colors"
          aria-expanded={isExpanded}
        >
          <span className="w-5 h-5 bg-purple-400 dark:bg-purple-500 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0">
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
                d="M12 4v16m8-8H4"
              />
            </svg>
          </span>
          <span className="flex-1 text-left text-sm font-medium flex items-center gap-2">
            <span>Created thread</span>
            {isStreaming ? (
              <span className="flex items-center gap-1">
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
              </span>
            ) : (
              <span className="text-xs text-green-600 dark:text-green-400">
                ✓
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
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

        {isExpanded && (
          <div className="px-4 py-3 border-t border-purple-200/50 dark:border-purple-700/50 animate-slide-down">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-purple-600 dark:text-purple-400 font-medium truncate">
                  "{title}"
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {threadStatus && (
                    <span className="text-xs text-purple-500/70 dark:text-purple-400/70">
                      Status: {threadStatus}
                    </span>
                  )}
                  {thread?.isWorktree && (
                    <span
                      className="text-xs px-1 rounded bg-cyan-500/20 text-cyan-600 dark:text-cyan-400"
                      title={
                        thread.worktreeBranch
                          ? `Worktree on ${thread.worktreeBranch}`
                          : 'Worktree'
                      }
                    >
                      worktree
                    </span>
                  )}
                </div>
              </div>
              {threadId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNavigate();
                  }}
                  className="ml-3 text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-600 dark:text-purple-400 hover:bg-purple-500/30 transition-colors flex items-center gap-1"
                >
                  Open Thread
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
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </AssistantBlock>
  );
});
