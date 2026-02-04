import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ModelType, PermissionMode } from '../store/threadStore';

const MODEL_OPTIONS: { value: ModelType; label: string; desc: string; color: string }[] = [
  { value: 'claude-sonnet-4-5', label: 'Sonnet', desc: 'Fast & capable', color: 'bg-violet-500' },
  { value: 'claude-opus-4-5', label: 'Opus', desc: 'Most powerful', color: 'bg-amber-500' },
  { value: 'claude-haiku-4-5', label: 'Haiku', desc: 'Quick responses', color: 'bg-emerald-500' },
];

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string; icon: JSX.Element; color: string }[] = [
  {
    value: 'plan',
    label: 'Plan',
    desc: 'Review before executing',
    color: 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    value: 'acceptEdits',
    label: 'Accept Edits',
    desc: 'Auto-approve file changes',
    color: 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-300',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    value: 'default',
    label: 'Normal',
    desc: 'Prompt for each action',
    color: 'border-gray-400 bg-gray-500/10 text-gray-700 dark:text-gray-300',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    value: 'bypassPermissions',
    label: 'Bypass',
    desc: 'Skip all prompts',
    color: 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-300',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
];

interface CreateSubThreadModalProps {
  isOpen: boolean;
  parentModel: ModelType;
  parentPermissionMode: PermissionMode;
  onSubmit: (options: { title: string; model: ModelType; permissionMode: PermissionMode }) => void;
  onCancel: () => void;
}

export function CreateSubThreadModal({
  isOpen,
  parentModel,
  parentPermissionMode,
  onSubmit,
  onCancel,
}: CreateSubThreadModalProps) {
  const [title, setTitle] = useState('');
  const [model, setModel] = useState<ModelType>(parentModel);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(parentPermissionMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTitle('');
      setModel(parentModel);
      setPermissionMode(parentPermissionMode);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen, parentModel, parentPermissionMode]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const focusable = e.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onSubmit({ title: title.trim(), model, permissionMode });
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  if (!isOpen) return null;

  const selectedModel = MODEL_OPTIONS.find(m => m.value === model) || MODEL_OPTIONS[0];
  const selectedPermission = PERMISSION_OPTIONS.find(p => p.value === permissionMode) || PERMISSION_OPTIONS[2];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <h2 id={titleId} className="text-lg font-semibold flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Create Sub-Thread
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Spawn a parallel task with its own settings
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Title input */}
          <div>
            <label htmlFor={`${titleId}-title`} className="block text-sm font-medium mb-2">
              Thread Title
            </label>
            <input
              id={`${titleId}-title`}
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Refactor auth module"
              className="w-full px-4 py-2.5 rounded-lg border border-border bg-background
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                         placeholder:text-muted-foreground/50"
            />
          </div>

          {/* Model selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Model</label>
            <div className="grid grid-cols-3 gap-2">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setModel(opt.value)}
                  className={`relative px-3 py-2.5 rounded-lg border-2 transition-all text-left
                    ${model === opt.value
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${opt.color}`} />
                    <span className="font-medium text-sm">{opt.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  {model === opt.value && (
                    <div className="absolute top-1.5 right-1.5">
                      <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Permission mode selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Permission Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {PERMISSION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPermissionMode(opt.value)}
                  className={`relative px-3 py-2.5 rounded-lg border-2 transition-all text-left
                    ${permissionMode === opt.value
                      ? `${opt.color} border-current`
                      : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    {opt.icon}
                    <span className="font-medium text-sm">{opt.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  {permissionMode === opt.value && (
                    <div className="absolute top-1.5 right-1.5">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
            {permissionMode === 'bypassPermissions' && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Caution: All actions will be auto-approved
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg
                         hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors font-medium flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Thread
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
