/**
 * Shared formatting utilities for content display.
 */

// Default max length for truncated collapsed content
export const MAX_COLLAPSED_LENGTH = 200;

/**
 * Truncate long content for collapsed display.
 * Adds ellipsis if content exceeds maxLength.
 */
export function truncateContent(content: string, maxLength = MAX_COLLAPSED_LENGTH): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
}

/**
 * Format MCP tool names to be more readable.
 * Extracts the tool name from MCP-prefixed names like "mcp__server__toolname".
 */
export function formatToolName(name: string | undefined): string {
  if (!name) return '';
  const mcpMatch = name.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) {
    return mcpMatch[1];
  }
  return name;
}
