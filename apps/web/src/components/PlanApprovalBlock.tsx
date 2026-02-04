import { useState, useEffect } from 'react';

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
    <div className="flex justify-start my-4">
      <div className="max-w-[85%] w-full rounded-xl overflow-hidden shadow-lg border-2 border-blue-500/40 dark:border-blue-400/30">
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

        {/* Plan content (collapsible) */}
        {isExpanded && (
          <div className="px-5 py-4 bg-slate-50 dark:bg-slate-900/50 max-h-96 overflow-y-auto">
            <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
              {planContent || 'Plan content not available'}
            </pre>
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
