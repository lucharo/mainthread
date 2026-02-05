/**
 * Shared types for the thread store.
 * Extracted to reduce threadStore.ts size and improve maintainability.
 */

export type ThreadStatus =
  | 'active'
  | 'pending'
  | 'running'
  | 'needs_attention'
  | 'done'
  | 'new_message';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_blocks?: string | null;  // JSON string of StreamingBlock[] from DB
  timestamp: string;
}

export type ModelType = 'claude-sonnet-4-5' | 'claude-opus-4-5' | 'claude-opus-4-6' | 'claude-haiku-4-5';
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface Thread {
  id: string;
  title: string;
  status: ThreadStatus;
  parentId: string | null;
  messages: Message[];
  workDir?: string;
  sessionId: string | null;
  model: ModelType;
  extendedThinking: boolean;
  permissionMode: PermissionMode;
  autoReact: boolean;
  gitBranch: string | null;
  gitRepo: string | null;
  isWorktree: boolean;
  worktreeBranch: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Actual token usage from SDK (updated after each agent run)
  lastUsage?: Record<string, number>;
  lastCostUsd?: number;
  // Ephemeral sub-agent threads (not persisted, shown inline)
  isEphemeral?: boolean;
  isReadOnly?: boolean;
}

export interface SSEConnection {
  eventSource: EventSource;
  threadId: string;
  reconnectAttempts: number;
  reconnectTimeoutId?: ReturnType<typeof setTimeout>;
  lastEventId?: string;  // Track last received event ID for reconnection recovery
}

export interface ToolUse {
  name: string;
  input?: Record<string, unknown>;
  id?: string;
  isComplete?: boolean;
}

// Unified streaming block for chronological rendering
export interface StreamingBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'plan_approval';
  timestamp: number;
  // Streaming state - true when block is no longer receiving content
  isFinalized?: boolean;
  // Text block fields
  content?: string;
  // Thinking block fields
  signature?: string;
  // Tool use block fields
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  isComplete?: boolean;
  // FIFO collapse state (separate from isComplete - a tool can be complete but still expanded)
  isCollapsed?: boolean;
  // Error state - tool execution failed
  isError?: boolean;
  errorMessage?: string;
  // AskUserQuestion: submitted answers (for display after user responds)
  submittedAnswers?: Record<string, string>;
  // Plan approval block fields
  planFilePath?: string;
  planContent?: string;
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
}

export interface PendingPlanApproval {
  planFilePath: string;  // Display name for the plan (may be "Plan" if no file path)
  planContent: string;
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
}

export interface AgentQuestionOption {
  label: string;
  description: string;
}

export interface AgentQuestion {
  question: string;
  header: string;
  options: AgentQuestionOption[];
  multiSelect: boolean;
}

export interface ThreadCreatedNotification {
  threadId: string;
  threadTitle: string;
  timestamp: string;
  status?: ThreadStatus;  // For completion notifications: 'done' | 'needs_attention'
}

export interface CreateThreadOptions {
  title: string;
  parentId?: string;
  workDir?: string;
  model?: ModelType;
  extendedThinking?: boolean;
  permissionMode?: PermissionMode;
  // Git branch selection options
  gitBranch?: string;  // Branch to use/create
  useWorktree?: boolean;
  worktreePath?: string;  // Custom worktree path (auto-generated if not provided)
}

export interface DirectoryEntry {
  path: string;
  name: string;
  isDir: boolean;
}

export interface GitInfo {
  isGitRepo: boolean;
  repoRoot: string | null;
  repoName: string | null;
  currentBranch: string | null;
  branches: string[];
  isWorktree: boolean;
  worktreeBranch: string | null;
}

export interface ChildPendingQuestion {
  childThreadId: string;
  childTitle: string;
  questions: AgentQuestion[];
}

export interface PaginationState {
  hasMore: boolean;
  total: number;
  loadedCount: number;
  isLoading: boolean;
}

export interface TokenInfo {
  totalTokens: number;
  userTokens: number;
  assistantTokens: number;
  systemTokens: number;
  messageCount: number;
  warnings: string[];
}

// Queue waiting state for threads waiting for an available slot
export type QueueWaiting = Record<string, boolean>;
