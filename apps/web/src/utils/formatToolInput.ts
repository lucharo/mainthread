/**
 * Format tool inputs for human-readable expanded display.
 * Used in ToolBlock and ToolHistoryBlock expanded views.
 */

interface FormattedToolInput {
  /** One-line summary or prominent field */
  summary: string;
  /** Optional detailed content (code blocks, truncated content, etc.) */
  details?: string;
}

/**
 * Truncate a string to N lines, adding "..." if truncated.
 */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + '\n...';
}

/**
 * Truncate a string to maxChars, adding "..." if truncated.
 */
function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}

/**
 * Format tool input for expanded display in tool blocks.
 * Returns a summary line and optional details section.
 */
export function formatExpandedToolInput(
  toolName: string,
  input: Record<string, unknown> | undefined
): FormattedToolInput {
  if (!input) return { summary: '' };

  switch (toolName) {
    case 'Write': {
      const filePath = String(input.file_path || '');
      const content = input.content ? String(input.content) : undefined;
      let details: string | undefined;
      if (content) {
        details = truncateLines(content, 10);
      }
      return { summary: filePath, details };
    }

    case 'Edit': {
      const filePath = String(input.file_path || '');
      const parts: string[] = [];
      if (input.old_string) {
        parts.push('old: ' + truncateLines(String(input.old_string), 5));
      }
      if (input.new_string) {
        parts.push('new: ' + truncateLines(String(input.new_string), 5));
      }
      return { summary: filePath, details: parts.join('\n\n') || undefined };
    }

    case 'Bash': {
      const command = input.command ? String(input.command) : '';
      return { summary: '', details: command };
    }

    case 'Read': {
      const filePath = String(input.file_path || '');
      const parts: string[] = [];
      if (input.offset) parts.push(`offset: ${input.offset}`);
      if (input.limit) parts.push(`limit: ${input.limit}`);
      return { summary: filePath, details: parts.length > 0 ? parts.join(', ') : undefined };
    }

    case 'SpawnThread': {
      const title = input.title ? String(input.title) : '';
      const model = input.model ? String(input.model) : undefined;
      const permissionMode = input.permission_mode ? String(input.permission_mode) : undefined;
      const instructions = input.instructions ? String(input.instructions) : undefined;

      const meta: string[] = [];
      if (model) meta.push(`Model: ${model}`);
      if (permissionMode) meta.push(`Mode: ${permissionMode}`);

      let details: string | undefined;
      if (meta.length > 0 || instructions) {
        const sections: string[] = [];
        if (meta.length > 0) sections.push(meta.join('  |  '));
        if (instructions) sections.push(truncateLines(instructions, 8));
        details = sections.join('\n\n');
      }
      return { summary: title, details };
    }

    case 'Task': {
      const description = input.description ? String(input.description) : '';
      const prompt = input.prompt ? String(input.prompt) : '';
      const text = description || prompt;
      return { summary: '', details: truncateChars(text, 500) || undefined };
    }

    case 'Glob': {
      const pattern = input.pattern ? String(input.pattern) : '';
      const path = input.path ? String(input.path) : undefined;
      return { summary: pattern, details: path ? `in ${path}` : undefined };
    }

    case 'Grep': {
      const pattern = input.pattern ? String(input.pattern) : '';
      const path = input.path ? String(input.path) : undefined;
      const glob = input.glob ? String(input.glob) : undefined;
      const parts: string[] = [];
      if (path) parts.push(`path: ${path}`);
      if (glob) parts.push(`glob: ${glob}`);
      return { summary: pattern, details: parts.length > 0 ? parts.join('\n') : undefined };
    }

    default: {
      // Default: truncated JSON
      const json = JSON.stringify(input, null, 2);
      return { summary: '', details: truncateChars(json, 500) };
    }
  }
}
