/**
 * Format a file path for display, replacing home directory with ~
 */
export function formatPath(path: string | undefined | null): string {
  if (!path) return '';

  // Common home directory patterns
  const homePatterns = [
    /^\/Users\/[^/]+/,  // macOS
    /^\/home\/[^/]+/,   // Linux
    /^C:\\Users\\[^\\]+/i,  // Windows
  ];

  for (const pattern of homePatterns) {
    if (pattern.test(path)) {
      return path.replace(pattern, '~');
    }
  }

  return path;
}

/**
 * Truncate path intelligently, keeping the beginning and end visible
 * e.g., "~/very/long/path/to/project" -> "~/very/.../project"
 */
export function smartTruncatePath(path: string, maxLength: number = 40): string {
  if (path.length <= maxLength) return path;

  const parts = path.split('/');
  if (parts.length <= 3) return path;

  // Keep first part (~ or root) and last part (directory name)
  const first = parts[0] || '/';
  const last = parts[parts.length - 1];

  // Calculate how much space we have for middle parts
  const ellipsis = '/...';
  const available = maxLength - first.length - last.length - ellipsis.length - 1;

  if (available <= 0) {
    return `${first}${ellipsis}/${last}`;
  }

  // Try to fit as many parts from the beginning as possible
  let middle = '';
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i];
    if (middle.length + part.length + 1 <= available) {
      middle += '/' + part;
    } else {
      break;
    }
  }

  return `${first}${middle}${ellipsis}/${last}`;
}
