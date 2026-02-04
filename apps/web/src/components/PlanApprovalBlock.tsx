import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface PlanApprovalBlockProps {
  planFilePath: string;
  planContent: string;
  threadId: string;
  onProceed: (mode: 'default' | 'acceptEdits' | 'bypassPermissions') => void;
  onModify: () => void;
  onCompact: () => void;
}

export function PlanApprovalBlock({
  planFilePath,
  planContent,
  threadId,
  onProceed,
  onModify,
  onCompact,
}: PlanApprovalBlockProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleProceed = async (mode: 'default' | 'acceptEdits' | 'bypassPermissions') => {
    setIsLoading(true);
    try {
      await onProceed(mode);
    } finally {
      setIsLoading(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case '1':
          e.preventDefault();
          handleProceed('default');
          break;
        case '2':
          e.preventDefault();
          handleProceed('acceptEdits');
          break;
        case '3':
          e.preventDefault();
          handleProceed('bypassPermissions');
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          onModify();
          break;
        case 'c':
        case 'C':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            onCompact();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, onModify, onCompact]);

  return (
    <div className={`flex justify-start my-4 ${isFullscreen ? 'fixed inset-4 z-50' : ''}`}>
      {/* Backdrop for fullscreen */}
      {isFullscreen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsFullscreen(false)}
        />
      )}
      <div className={`rounded-xl overflow-hidden shadow-lg border-2 border-blue-500/40 dark:border-blue-400/30 ${
        isFullscreen
          ? 'fixed inset-8 z-50 flex flex-col bg-background'
          : 'max-w-[85%] w-full'
      }`}>
        {/* Header - distinctive blue gradient */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-700 dark:to-blue-600">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                Plan Ready for Review
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/20 text-white">
                  Waiting
                </span>
              </h3>
              <p className="text-xs text-blue-100 truncate max-w-md mt-0.5">
                Review and approve before execution
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Fullscreen toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Expand for easier reading'}
            >
              {isFullscreen ? (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
            {/* Collapse toggle */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              aria-label={isExpanded ? 'Collapse plan' : 'Expand plan'}
            >
              <svg
                className={`w-5 h-5 text-white transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Plan content (collapsible) - rendered as markdown */}
        {isExpanded && (
          <div className={`px-5 py-4 bg-slate-50 dark:bg-slate-900/50 overflow-y-auto ${
            isFullscreen ? 'max-h-[70vh]' : 'max-h-96'
          }`}>
            <div className="prose prose-sm max-w-none text-foreground prose-p:my-2 prose-p:text-foreground prose-headings:text-foreground prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-strong:text-foreground prose-code:text-foreground prose-code:bg-slate-200 dark:prose-code:bg-slate-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-table:text-sm prose-th:bg-slate-100 dark:prose-th:bg-slate-800 prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-td:border-slate-200 dark:prose-td:border-slate-700">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {planContent || 'Plan content not available'}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Action buttons - clean white background */}
        <div className="px-5 py-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            {/* Primary actions */}
            <button
              onClick={() => handleProceed('default')}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg
                         hover:bg-blue-700 active:bg-blue-800 transition-all disabled:opacity-50
                         flex items-center gap-2 shadow-sm hover:shadow"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Proceed
              <kbd className="px-1.5 py-0.5 text-[10px] bg-blue-500 rounded font-mono">1</kbd>
            </button>

            <button
              onClick={() => handleProceed('acceptEdits')}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg
                         hover:bg-emerald-700 active:bg-emerald-800 transition-all disabled:opacity-50
                         flex items-center gap-2 shadow-sm hover:shadow"
              title="Auto-accept file changes"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Accept Edits
              <kbd className="px-1.5 py-0.5 text-[10px] bg-emerald-500 rounded font-mono">2</kbd>
            </button>

            <button
              onClick={() => handleProceed('bypassPermissions')}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg
                         hover:bg-red-700 active:bg-red-800 transition-all disabled:opacity-50
                         flex items-center gap-2 shadow-sm hover:shadow"
              title="Skip all permission prompts (use with caution)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Bypass
              <kbd className="px-1.5 py-0.5 text-[10px] bg-red-500 rounded font-mono">3</kbd>
            </button>

            <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />

            {/* Secondary actions */}
            <button
              onClick={onModify}
              disabled={isLoading}
              className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 rounded-lg
                         border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700
                         hover:bg-slate-50 dark:hover:bg-slate-600 transition-all disabled:opacity-50
                         flex items-center gap-2"
              title="Request changes to the plan"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Modify
              <kbd className="px-1.5 py-0.5 text-[10px] bg-slate-200 dark:bg-slate-600 rounded font-mono">m</kbd>
            </button>

            <button
              onClick={onCompact}
              disabled={isLoading}
              className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 rounded-lg
                         border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700
                         hover:bg-slate-50 dark:hover:bg-slate-600 transition-all disabled:opacity-50
                         flex items-center gap-2"
              title="Summarize conversation to free up context"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Compact
              <kbd className="px-1.5 py-0.5 text-[10px] bg-slate-200 dark:bg-slate-600 rounded font-mono">c</kbd>
            </button>
          </div>

          {/* Keyboard hint - subtle */}
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            Keyboard: <span className="font-medium">1-3</span> proceed · <span className="font-medium">m</span> modify · <span className="font-medium">c</span> compact
          </p>
        </div>
      </div>
    </div>
  );
}
