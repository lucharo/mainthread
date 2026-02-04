import { useMemo, useState, useEffect, useRef, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { COLLAPSE_ANIMATION_DURATION_MS } from '../constants/animations';
import type { Message, StreamingBlock } from '../store/threadStore';
import { useThreadStore } from '../store/threadStore';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolHistoryBlock } from './ToolHistoryBlock';
import { StreamingCursor } from './StreamingCursor';
import { AssistantBlock } from './AssistantBlock';
import { formatToolName, truncateContent } from '../utils/format';

// Format tool input for human-readable display
function formatToolSummary(
  name: string | undefined,
  input: Record<string, unknown> | undefined
): string {
  if (!name || !input) return '';

  let summary = '';
  switch (name) {
    case 'Bash':
      summary = input.command ? String(input.command) : '';
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
      summary = input.file_path ? String(input.file_path) : '';
      break;
    case 'Glob':
    case 'Grep':
      summary = input.pattern ? String(input.pattern) : '';
      break;
    case 'Task':
      summary = input.description ? String(input.description) : '';
      break;
    case 'WebFetch':
      summary = input.url ? String(input.url) : '';
      break;
    case 'SpawnThread':
      summary = input.title ? String(input.title) : '';
      break;
    // Tools with no meaningful input to display
    case 'EnterPlanMode':
    case 'ExitPlanMode':
    case 'TaskList':
      summary = '';
      break;
    default:
      summary = '';
  }
  // Truncate long summaries for collapsed display
  return truncateContent(summary, 100);
}

// Check if input has meaningful content to display (beyond what's shown in summary)
// NOTE: Tool names are hardcoded here. Update this list if new file-operation tools are added
// or if existing tools are renamed. Consider pattern-based detection if the tool set grows.
function hasExpandableContent(name: string | undefined, input: Record<string, unknown> | undefined): boolean {
  if (!input) return false;
  const keys = Object.keys(input);
  if (keys.length === 0) return false;

  // For file operations, the summary already shows the path - only expand if there's more to show
  switch (name) {
    case 'Write':
      // Write shows file_path in summary - content is usually too large to be useful
      return false;
    case 'Read':
      // Read shows file_path in summary - expanded content isn't useful
      return false;
    case 'EnterPlanMode':
    case 'ExitPlanMode':
    case 'TaskList':
      // These tools have no meaningful content to expand
      return false;
    default:
      break;
  }

  // Check if all values are empty/null/undefined
  return keys.some(k => {
    const val = input[k];
    return val !== null && val !== undefined && val !== '' &&
           !(typeof val === 'object' && Object.keys(val as object).length === 0);
  });
}

// Reusable tool block component with expand/collapse
function ToolBlock({
  name,
  input,
  isComplete,
  isCollapsed,
  isError,
}: {
  name?: string;
  input?: Record<string, unknown>;
  isComplete?: boolean;
  isCollapsed?: boolean;
  isError?: boolean;
}) {
  // Check if there's content worth expanding (beyond the summary)
  const canExpand = hasExpandableContent(name, input);
  // Local state for manual toggle, but starts from FIFO state
  const [isExpanded, setIsExpanded] = useState(!isCollapsed && canExpand);
  const summary = formatToolSummary(name, input);
  const wasIncomplete = useRef(!isComplete);

  // Sync with FIFO collapse state (external trigger from queue management)
  useEffect(() => {
    if (isCollapsed) {
      setIsExpanded(false);
    }
  }, [isCollapsed]);

  // Auto-collapse on completion (timing-based, secondary to FIFO).
  // Note: wasIncomplete is a ref and doesn't need to be in deps.
  // The ref tracks whether this specific instance saw the tool as incomplete,
  // preventing re-collapse if user manually expands a completed tool.
  useEffect(() => {
    if (isComplete && wasIncomplete.current && isExpanded) {
      const timer = setTimeout(() => setIsExpanded(false), COLLAPSE_ANIMATION_DURATION_MS);
      wasIncomplete.current = false;
      return () => clearTimeout(timer);
    }
    if (isComplete) {
      wasIncomplete.current = false;
    }
  }, [isComplete, isExpanded]);

  return (
    <AssistantBlock>
      <div className="my-2">
        <button
          onClick={() => canExpand && setIsExpanded(!isExpanded)}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground rounded-lg transition-colors w-full text-left ${
            isError
              ? 'bg-red-500/10 hover:bg-red-500/20 border border-red-500/50'
              : 'bg-muted/30 hover:bg-muted/50'
          } ${!canExpand ? 'cursor-default' : ''}`}
        >
          {isError ? (
            <svg
              className="w-4 h-4 text-red-500 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : isComplete ? (
            <svg
              className="w-4 h-4 text-green-500 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg
              className="w-4 h-4 animate-spin flex-shrink-0"
              fill="none"
              stroke="currentColor"
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
          <span className={`font-medium ${isError ? 'text-red-600' : ''}`}>{formatToolName(name)}</span>
          {summary && <span className="text-xs opacity-70 truncate flex-1 font-mono">{summary}</span>}
          {canExpand && (
            <svg
              className={`w-4 h-4 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>
        {isExpanded && input && hasExpandableContent(name, input) && (
          <div className="mt-1 ml-6 p-2 bg-muted/20 rounded text-xs font-mono overflow-hidden max-w-full">
            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(input, null, 2)}</pre>
          </div>
        )}
      </div>
    </AssistantBlock>
  );
}

// Type for grouped blocks
type BlockGroup = { type: 'single'; block: StreamingBlock } | { type: 'tools'; blocks: StreamingBlock[] };

// Helper to group consecutive tool_use blocks together
function groupConsecutiveBlocks(blocks: StreamingBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  let currentToolGroup: StreamingBlock[] = [];

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      currentToolGroup.push(block);
    } else {
      if (currentToolGroup.length > 0) {
        if (currentToolGroup.length === 1) {
          groups.push({ type: 'single', block: currentToolGroup[0] });
        } else {
          groups.push({ type: 'tools', blocks: currentToolGroup });
        }
        currentToolGroup = [];
      }
      groups.push({ type: 'single', block });
    }
  }

  if (currentToolGroup.length > 0) {
    if (currentToolGroup.length === 1) {
      groups.push({ type: 'single', block: currentToolGroup[0] });
    } else {
      groups.push({ type: 'tools', blocks: currentToolGroup });
    }
  }

  return groups;
}

// Render a single persisted block
function PersistedBlockRenderer({ block }: { block: StreamingBlock }) {
  switch (block.type) {
    case 'text':
      return block.content ? (
        <AssistantBlock>
          <div className="message-bubble message-bubble-assistant px-4 py-2 rounded-lg text-foreground">
            <div className="prose prose-sm max-w-none font-sans text-foreground prose-p:my-1 prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{block.content}</ReactMarkdown>
            </div>
          </div>
        </AssistantBlock>
      ) : null;
    case 'thinking':
      return block.content ? <ThinkingBlock content={block.content} isStreaming={false} /> : null;
    case 'tool_use':
      return (
        <ToolBlock
          name={block.name}
          input={block.input as Record<string, unknown>}
          isComplete={block.isComplete ?? true}
        />
      );
    default:
      return null;
  }
}

// Render grouped blocks
function GroupedBlockRenderer({ group }: { group: BlockGroup }) {
  if (group.type === 'single') {
    return <PersistedBlockRenderer block={group.block} />;
  }

  const tools = group.blocks.map((block) => ({
    name: block.name || 'unknown',
    input: block.input,
    id: block.id,
    isComplete: block.isComplete ?? true,
  }));

  return <ToolHistoryBlock tools={tools} />;
}

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // Parse content_blocks for assistant messages
  // IMPORTANT: This hook must be called before any early returns to comply with Rules of Hooks
  const contentBlocks: StreamingBlock[] | null = useMemo(() => {
    if (isUser || !message.content_blocks) return null;
    try {
      return JSON.parse(message.content_blocks);
    } catch {
      return null;
    }
  }, [isUser, message.content_blocks]);

  // System messages - subtle styling
  if (isSystem) {
    return (
      <div className="flex justify-center animate-fade-in my-1">
        <div className="max-w-[60%] px-3 py-1.5 text-xs text-muted-foreground italic text-center">
          {message.content}
        </div>
      </div>
    );
  }

  // Hide notification messages (shown as card-style notifications instead)
  const isNotification = isUser && message.content.startsWith('[notification]');
  if (isNotification) {
    return null;
  }

  // Render content blocks if available
  if (!isUser && contentBlocks && contentBlocks.length > 0) {
    const groupedBlocks = groupConsecutiveBlocks(contentBlocks);
    return (
      <div className="animate-fade-in space-y-2">
        {groupedBlocks.map((group, index) => (
          <GroupedBlockRenderer key={`${message.id}-group-${index}`} group={group} />
        ))}
        <p className="text-xs opacity-70 px-4">
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
      <div
        className={`message-bubble max-w-[60%] px-4 py-2 rounded-lg ${
          isUser
            ? 'message-bubble-user text-primary-foreground'
            : 'message-bubble-assistant text-foreground'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none font-sans text-foreground prose-p:my-1 prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{message.content}</ReactMarkdown>
          </div>
        )}
        <p className="text-xs opacity-70 mt-1">{new Date(message.timestamp).toLocaleTimeString()}</p>
      </div>
    </div>
  );
});

// Streaming message component (live content)
export function StreamingMessage({ content, isStreaming = true }: { content: string; isStreaming?: boolean }) {
  return (
    <AssistantBlock className="animate-fade-in" aria-live="polite">
      <div className="message-bubble message-bubble-assistant px-4 py-2 rounded-lg text-foreground">
        <div className="prose prose-sm max-w-none font-sans text-foreground prose-p:my-1 prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</ReactMarkdown>
        </div>
        {isStreaming && <StreamingCursor />}
      </div>
    </AssistantBlock>
  );
}

// Streaming tool block (live tool use)
export function StreamingToolBlock({
  name,
  input,
  isComplete,
  isCollapsed,
  isError,
  submittedAnswers,
}: {
  name?: string;
  input?: Record<string, unknown>;
  isComplete?: boolean;
  toolUseId?: string;
  isCollapsed?: boolean;
  isError?: boolean;
  submittedAnswers?: Record<string, string>;
}) {
  // AskUserQuestion: Show submitted answers or collapse while waiting
  if (name === 'AskUserQuestion') {
    // Format answers for display after submission
    const answerDisplay = submittedAnswers
      ? Object.entries(submittedAnswers).map(([, a]) => a).join(', ')
      : null;
    return (
      <ToolBlock
        name={name}
        input={answerDisplay ? { 'Your answers': answerDisplay } : undefined}
        isComplete={isComplete || !!submittedAnswers}
        // Start collapsed while waiting for input (InlineQuestionBlock is the main UI)
        isCollapsed={!submittedAnswers ? true : isCollapsed}
        isError={isError}
      />
    );
  }

  return <ToolBlock name={name} input={input} isComplete={isComplete} isCollapsed={isCollapsed} isError={isError} />;
}
