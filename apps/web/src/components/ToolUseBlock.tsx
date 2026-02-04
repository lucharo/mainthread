import { useState } from 'react';
import { formatToolName } from '../utils/format';
import { getToolPreview } from '../utils/toolPreviews';

export interface ToolUse {
  name: string;
  input?: Record<string, unknown>;
  id?: string;
  isComplete?: boolean;
}

interface ToolUseBlockProps {
  toolUse: ToolUse;
  isStreaming?: boolean;
}

export function ToolUseBlock({ toolUse, isStreaming = false }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const hasInput = toolUse.input && Object.keys(toolUse.input).length > 0;
  const preview = getToolPreview(toolUse.name, toolUse.input, { maxLength: 50 });

  return (
    <div className="tool-use-block bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg my-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="tool-use-header w-full flex items-center gap-2 px-3 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
        aria-expanded={expanded}
        aria-controls={`tool-content-${toolUse.id}`}
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
          <span className="font-mono bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs flex-shrink-0">
            {formatToolName(toolUse.name)}
          </span>
          {preview && (
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {preview}
            </span>
          )}
          {isStreaming ? (
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 ml-auto flex-shrink-0">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              running
            </span>
          ) : (
            <span className="text-xs text-green-600 dark:text-green-400 ml-auto flex-shrink-0">
              ✓
            </span>
          )}
        </span>
        {hasInput && (
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
        )}
      </button>
      {expanded && hasInput && (
        <div
          id={`tool-content-${toolUse.id}`}
          className="tool-use-content px-4 py-3 text-sm text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 animate-slide-down overflow-hidden max-w-full"
        >
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
            {JSON.stringify(toolUse.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
