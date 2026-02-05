import { useCallback, useState } from 'react';
import type { Thread, TokenInfo } from '../store/threadStore';
import { formatPath } from '../utils/paths';

function getDisplayPath(workDir: string): string {
  // Hide worktree implementation detail - show parent repo path instead
  const worktreeIdx = workDir.indexOf('.mainthread/worktrees/');
  if (worktreeIdx > 0) {
    return workDir.substring(0, worktreeIdx - 1); // Remove trailing /
  }
  return workDir;
}

interface ThreadHeaderProps {
  thread: Thread;
  parentThread?: Thread;
  tokenInfo: TokenInfo | null;
  onNavigateToParent: () => void;
  onClearThread: () => void;
  onArchiveThread: () => void;
  showMinimap?: boolean;
  onToggleMinimap?: () => void;
}

export function ThreadHeader({
  thread,
  parentThread,
  tokenInfo,
  onNavigateToParent,
  onClearThread,
  onArchiveThread,
  showMinimap,
  onToggleMinimap,
}: ThreadHeaderProps) {
  const [copiedResume, setCopiedResume] = useState(false);

  const handleCopyResumeCommand = useCallback(async () => {
    if (!thread.sessionId || !thread.workDir) return;

    const command = `cd "${thread.workDir}" && claude --resume ${thread.sessionId}`;
    try {
      await navigator.clipboard.writeText(command);
      setCopiedResume(true);
      setTimeout(() => setCopiedResume(false), 2000);
    } catch {
      // Silently fail
    }
  }, [thread.sessionId, thread.workDir]);

  // Calculate token display
  const usage = thread.lastUsage;
  const inputTokens = usage?.input_tokens as number | undefined;
  const outputTokens = usage?.output_tokens as number | undefined;
  const totalTokens =
    inputTokens != null && outputTokens != null
      ? inputTokens + outputTokens
      : tokenInfo?.totalTokens || 0;
  const isActual = !!usage;
  const cost = thread.lastCostUsd;

  return (
    <div className="border-b border-border px-4 py-2 flex items-center justify-between bg-muted/30 flex-shrink-0">
      <div className="flex items-center gap-3">
        <div>
          {/* Breadcrumb for sub-threads */}
          {parentThread && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
              <button
                onClick={onNavigateToParent}
                className="hover:text-foreground hover:underline transition-colors"
              >
                {parentThread.title}
              </button>
              <span>/</span>
            </div>
          )}
          <h2 className="font-semibold text-sm">{thread.title}</h2>
          {thread.workDir && (
            <p className="text-xs text-muted-foreground" title={getDisplayPath(thread.workDir)}>
              {formatPath(getDisplayPath(thread.workDir))}
            </p>
          )}
        </div>

        {/* Git branch badge */}
        {thread.gitBranch && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-xs">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="6" cy="6" r="2" strokeWidth={2} />
              <circle cx="18" cy="6" r="2" strokeWidth={2} />
              <circle cx="6" cy="18" r="2" strokeWidth={2} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 8v8M18 8v4a4 4 0 01-4 4H6" />
            </svg>
            {thread.gitBranch}
            {thread.isWorktree && (
              <span
                className="text-[10px] px-1 bg-blue-500/20 rounded"
                title={thread.worktreeBranch ? `Worktree on ${thread.worktreeBranch}` : 'Worktree'}
              >
                worktree
              </span>
            )}
          </span>
        )}

        {/* Token usage - hidden on narrow screens */}
        {(usage || tokenInfo) && totalTokens > 0 && (
          <div className="hidden sm:flex items-center gap-1 text-xs">
            {isActual && inputTokens != null && (
              <span
                className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                title={`Input: ${inputTokens.toLocaleString()} tokens`}
              >
                i: {inputTokens >= 1000 ? `${(inputTokens / 1000).toFixed(1)}K` : inputTokens}
              </span>
            )}
            {isActual && outputTokens != null && (
              <span
                className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                title={`Output: ${outputTokens.toLocaleString()} tokens`}
              >
                o: {outputTokens >= 1000 ? `${(outputTokens / 1000).toFixed(1)}K` : outputTokens}
              </span>
            )}
            {!isActual && (
              <span
                className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                title={`~${totalTokens.toLocaleString()} estimated tokens`}
              >
                ~{totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : totalTokens}
              </span>
            )}
            {cost != null && cost > 0 && (
              <span
                className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                title={`Cost: $${cost.toFixed(6)}`}
              >
                ${cost.toFixed(4)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {/* Minimap toggle */}
        {onToggleMinimap && (
          <button
            onClick={onToggleMinimap}
            className={`p-1.5 rounded border text-xs transition-colors ${
              showMinimap
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
            title={showMinimap ? 'Hide thread map' : 'Show thread map'}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="6" cy="6" r="2" strokeWidth={2} />
              <circle cx="18" cy="6" r="2" strokeWidth={2} />
              <circle cx="12" cy="18" r="2" strokeWidth={2} />
              <path strokeLinecap="round" strokeWidth={2} d="M6 8v6l6 4M18 8v6l-6 4" />
            </svg>
          </button>
        )}

        {/* Resume command button */}
        {thread.sessionId && thread.workDir && (
          <button
            onClick={handleCopyResumeCommand}
            className="p-1.5 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
            title={copiedResume ? 'Copied!' : `Resume in CLI: cd "${getDisplayPath(thread.workDir!)}" && claude --resume ${thread.sessionId}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
          </button>
        )}

        {/* Clear thread button */}
        <button
          onClick={onClearThread}
          className="p-1.5 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
          title="Clear all messages"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>

        {/* Archive thread button */}
        <button
          onClick={onArchiveThread}
          className="p-1.5 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
          title="Archive thread"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
