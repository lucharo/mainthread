import { useCallback, useEffect, useId, useRef, useState } from 'react';

interface InputModalProps {
  isOpen: boolean;
  title: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InputModal({
  isOpen,
  title,
  placeholder = '',
  onSubmit,
  onCancel,
}: InputModalProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Handle Escape key globally when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      // Store the currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;
      setValue('');

      // Focus the input after a frame to ensure it's rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } else {
      // Restore focus when closing
      previousActiveElement.current?.focus();
    }
  }, [isOpen]);

  // Focus trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Simple focus trap - keep focus on input and buttons
        const focusableElements = e.currentTarget.querySelectorAll<HTMLElement>(
          'input, button:not([disabled])',
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    },
    [],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="text-lg font-semibold mb-4">
          {title}
        </h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor={`${titleId}-input`} className="sr-only">
            {placeholder || title}
          </label>
          <input
            id={`${titleId}-input`}
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full px-4 py-2 rounded-lg border border-border bg-background
                       focus:outline-none focus:ring-2 focus:ring-primary mb-4"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-border rounded-lg hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg
                         hover:opacity-90 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
