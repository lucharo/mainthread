/**
 * Tool preview utilities for generating meaningful one-line summaries.
 */

import { formatToolName } from './format';

interface ToolPreviewOptions {
  maxLength?: number;
  getThreadTitle?: (id: string) => string | null;
}

/**
 * Truncate a string to maxLength, adding ellipsis if needed.
 */
function truncate(str: string | undefined | null, maxLen: number): string | null {
  if (!str) return null;
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

/**
 * Extract the filename from a path (last segment).
 */
function getFilename(path: string | undefined | null): string | null {
  if (!path) return null;
  const segments = path.split('/');
  return segments[segments.length - 1] || null;
}

/**
 * Safely extract hostname from a URL.
 */
function getHostname(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return truncate(url, 30);
  }
}

/**
 * Generate a meaningful one-line preview for a tool call.
 * Returns null if no preview can be generated.
 */
export function getToolPreview(
  name: string,
  input: Record<string, unknown> | undefined,
  options?: ToolPreviewOptions
): string | null {
  if (!input) return null;

  const cleanName = formatToolName(name);
  const maxLen = options?.maxLength ?? 40;

  switch (cleanName) {
    // File system tools
    case 'Bash': {
      const command = input.command as string | undefined;
      return truncate(command, maxLen);
    }
    case 'Glob': {
      const pattern = input.pattern as string | undefined;
      return truncate(pattern, maxLen);
    }
    case 'Grep': {
      const pattern = input.pattern as string | undefined;
      const path = input.path as string | undefined;
      if (!pattern) return null;
      const location = path ? ` in ${getFilename(path) || path}` : '';
      return truncate(`"${pattern}"${location}`, maxLen);
    }
    case 'Read': {
      const filePath = (input.file_path || input.path) as string | undefined;
      return getFilename(filePath) || truncate(filePath, maxLen);
    }
    case 'Write': {
      const filePath = (input.file_path || input.path) as string | undefined;
      return getFilename(filePath) || truncate(filePath, maxLen);
    }
    case 'Edit': {
      const filePath = (input.file_path || input.path) as string | undefined;
      return getFilename(filePath) || truncate(filePath, maxLen);
    }
    case 'NotebookEdit': {
      const notebookPath = input.notebook_path as string | undefined;
      return getFilename(notebookPath) || truncate(notebookPath, maxLen);
    }

    // Web tools
    case 'WebFetch': {
      const url = input.url as string | undefined;
      return getHostname(url);
    }
    case 'WebSearch': {
      const query = input.query as string | undefined;
      return query ? truncate(`"${query}"`, maxLen) : null;
    }

    // Agent/Task tools
    case 'Task': {
      const description = (input.description || input.prompt) as string | undefined;
      return truncate(description, maxLen);
    }
    case 'SpawnThread': {
      const title = input.title as string | undefined;
      return truncate(title, maxLen);
    }
    case 'ReadThread':
    case 'ArchiveThread':
    case 'SendToThread': {
      const threadId = input.thread_id as string | undefined;
      if (!threadId) return null;
      const title = options?.getThreadTitle?.(threadId);
      return title || truncate(threadId, 8) + '...';
    }

    // User interaction tools
    case 'AskUserQuestion': {
      const questions = input.questions as Array<{ question: string }> | undefined;
      const firstQuestion = questions?.[0]?.question;
      return truncate(firstQuestion, maxLen);
    }
    case 'EnterPlanMode':
      return 'Planning...';
    case 'ExitPlanMode':
      return 'Plan ready';

    // MCP tools - try to extract meaningful info
    default: {
      // For unknown tools, try common input field names
      const possibleFields = ['command', 'query', 'path', 'file_path', 'url', 'message', 'content', 'title', 'name', 'description'];
      for (const field of possibleFields) {
        const value = input[field];
        if (typeof value === 'string' && value.length > 0) {
          return truncate(value, maxLen);
        }
      }
      return null;
    }
  }
}

/**
 * Get a short display name for a tool (without preview).
 */
export function getToolDisplayName(name: string): string {
  return formatToolName(name);
}
