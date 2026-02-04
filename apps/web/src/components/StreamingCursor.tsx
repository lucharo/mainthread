interface StreamingCursorProps {
  variant?: 'primary' | 'thinking';
}

export function StreamingCursor({ variant = 'primary' }: StreamingCursorProps) {
  const colorClass = variant === 'thinking' ? 'bg-amber-500/70' : 'bg-primary/70';

  return (
    <span
      className={`inline-block w-0.5 h-4 ${colorClass} animate-cursor-blink ml-1`}
      aria-hidden="true"
    />
  );
}
