import { AssistantBlock } from './AssistantBlock';

/**
 * Prominent visual indicator shown while waiting for Claude to connect.
 * Displayed when a message is pending but no streaming content has arrived yet.
 * Matches ThinkingBlock styling for visual consistency.
 */
export function ProcessingBlock() {
  return (
    <AssistantBlock>
      <div className="processing-block bg-blue-50/60 dark:bg-blue-900/15 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
          {/* Spinner icon badge */}
          <span className="w-5 h-5 bg-blue-400 dark:bg-blue-500 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0">
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
          {/* Message with animated dots */}
          <span className="text-sm font-medium flex items-center gap-2">
            Connecting to Claude
            <span className="flex gap-0.5">
              <span
                className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
                style={{ animationDelay: '300ms' }}
              />
            </span>
          </span>
        </div>
      </div>
    </AssistantBlock>
  );
}
