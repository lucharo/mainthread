import type { ReactNode } from 'react';

interface AssistantBlockProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wrapper for assistant-side content (messages, tool blocks, thinking).
 * Ensures consistent max-width and alignment across all assistant content.
 */
export function AssistantBlock({
  children,
  className = '',
}: AssistantBlockProps) {
  return (
    <div className="flex justify-start">
      <div className={`max-w-[60%] w-full ${className}`}>{children}</div>
    </div>
  );
}
