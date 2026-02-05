import { useState } from 'react';
import { AssistantBlock } from './AssistantBlock';
import { StreamingCursor } from './StreamingCursor';

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  // Optional controlled mode props
  blockId?: string;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export function ThinkingBlock({
  content,
  isStreaming = false,
  blockId,
  isExpanded,
  onToggle,
}: ThinkingBlockProps) {
  // Use local state when not in controlled mode
  const [localExpanded, setLocalExpanded] = useState(isStreaming);

  // Use controlled props if provided, otherwise fall back to local state
  const isControlled = isExpanded !== undefined && onToggle !== undefined;
  const expanded = isControlled ? isExpanded : localExpanded;
  const handleToggle = isControlled
    ? onToggle
    : () => setLocalExpanded(!localExpanded);

  return (
    <AssistantBlock>
      <div className="thinking-block bg-amber-50/60 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
        <button
          onClick={handleToggle}
          className="thinking-header w-full flex items-center gap-2 px-3 py-2 text-amber-700 dark:text-amber-300 hover:bg-amber-100/50 dark:hover:bg-amber-800/30 transition-colors"
          aria-expanded={expanded}
          aria-controls={
            blockId ? `thinking-content-${blockId}` : 'thinking-content'
          }
        >
          <span className="w-5 h-5 bg-amber-400 dark:bg-amber-500 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0">
            <span role="img" aria-label="thinking">
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
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </span>
          </span>
          <span className="flex-1 text-left text-sm font-medium">
            {isStreaming ? (
              <span className="flex items-center gap-2">
                thinking
                <span className="flex gap-0.5">
                  <span
                    className="w-1 h-1 bg-amber-500 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1 h-1 bg-amber-500 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1 h-1 bg-amber-500 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </span>
              </span>
            ) : (
              "Claude's Reasoning"
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
        {expanded && (
          <div
            id={blockId ? `thinking-content-${blockId}` : 'thinking-content'}
            className="thinking-content px-4 py-3 text-sm text-amber-600 dark:text-amber-400 italic border-t border-amber-200/50 dark:border-amber-700/50 animate-slide-down"
          >
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {content}
            </pre>
            {isStreaming && <StreamingCursor variant="thinking" />}
          </div>
        )}
      </div>
    </AssistantBlock>
  );
}
