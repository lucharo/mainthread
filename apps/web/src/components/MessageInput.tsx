import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelType, PermissionMode, Thread } from '../store/threadStore';
import { Toggle } from './Toggle';

const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-opus-4-5', label: 'Opus 4.5' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'acceptEdits', label: 'Accept' },
  { value: 'default', label: 'Normal' },
  { value: 'bypassPermissions', label: 'Bypass' },
];

interface ImageAttachment {
  id: string;
  data: string;  // base64
  media_type: string;
  preview: string;  // data URL for preview
  name: string;
}

interface FileReference {
  path: string;
  name: string;
}

interface MessageInputProps {
  thread: Thread;
  disabled: boolean;
  onSendMessage: (content: string, images?: ImageAttachment[], fileRefs?: string[]) => Promise<void>;
  onCreateThread: () => void;
  onModelChange: (model: ModelType) => Promise<void>;
  onPermissionModeChange: (mode: PermissionMode) => Promise<void>;
  onThinkingToggle: (enabled: boolean) => Promise<void>;
  onStopThread: () => void;
  onError: (message: string) => void;
}

export function MessageInput({
  thread,
  disabled,
  onSendMessage,
  onCreateThread,
  onModelChange,
  onPermissionModeChange,
  onThinkingToggle,
  onStopThread,
  onError,
}: MessageInputProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image attachment state
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // File reference state
  const [fileRefs, setFileRefs] = useState<FileReference[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [fileQuery, setFileQuery] = useState('');
  const [fileResults, setFileResults] = useState<FileReference[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const filePickerRef = useRef<HTMLDivElement>(null);

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix to get raw base64
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Add image from file
  const addImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      onError('Only image files are supported');
      return;
    }
    if (images.length >= 10) {
      onError('Maximum 10 images allowed');
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      const preview = `data:${file.type};base64,${base64}`;
      const attachment: ImageAttachment = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        data: base64,
        media_type: file.type,
        preview,
        name: file.name,
      };
      setImages(prev => [...prev, attachment]);
    } catch (err) {
      onError('Failed to process image');
    }
  };

  // Handle drag events
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        await addImage(file);
      }
    }
  };

  // Handle paste
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await addImage(file);
        }
      }
    }
  };

  // Handle file input change (from attachment button)
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        await addImage(file);
      }
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Remove image
  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  // Fetch file suggestions
  useEffect(() => {
    if (!showFilePicker || !thread.workDir) {
      setFileResults([]);
      return;
    }

    const fetchFiles = async () => {
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (fileQuery) params.set('query', fileQuery);

        const res = await fetch(`/api/threads/${thread.id}/files?${params}`);
        if (res.ok) {
          const data = await res.json();
          setFileResults(data);
          setSelectedFileIndex(0);
        }
      } catch {
        setFileResults([]);
      }
    };

    const debounce = setTimeout(fetchFiles, 150);
    return () => clearTimeout(debounce);
  }, [showFilePicker, fileQuery, thread.id, thread.workDir]);

  // Auto-resize textarea
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  // Handle @ trigger in input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // Auto-resize
    autoResize(e.target);

    // Check for @ trigger
    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s]*)$/);

    if (atMatch) {
      setShowFilePicker(true);
      setFileQuery(atMatch[1]);
    } else {
      setShowFilePicker(false);
      setFileQuery('');
    }
  };

  // Add file reference
  const addFileRef = (file: FileReference) => {
    if (!fileRefs.find(f => f.path === file.path)) {
      setFileRefs(prev => [...prev, file]);
    }
    // Remove @ trigger from input
    const cursorPos = inputRef.current?.selectionStart || 0;
    const textBeforeCursor = input.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s]*)$/);
    if (atMatch) {
      const newInput = input.slice(0, cursorPos - atMatch[0].length) + input.slice(cursorPos);
      setInput(newInput);
    }
    setShowFilePicker(false);
    setFileQuery('');
    inputRef.current?.focus();
  };

  // Remove file reference
  const removeFileRef = (path: string) => {
    setFileRefs(prev => prev.filter(f => f.path !== path));
  };

  // Handle file picker keyboard navigation
  const handleFilePickerKeyDown = (e: React.KeyboardEvent) => {
    if (!showFilePicker || fileResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedFileIndex(i => Math.min(i + 1, fileResults.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedFileIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (fileResults[selectedFileIndex]) {
          e.preventDefault();
          addFileRef(fileResults[selectedFileIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowFilePicker(false);
        break;
      case 'Tab':
        if (fileResults[selectedFileIndex]) {
          e.preventDefault();
          addFileRef(fileResults[selectedFileIndex]);
        }
        break;
    }
  };

  const cyclePermissionMode = useCallback(async () => {
    const modes: PermissionMode[] = ['plan', 'acceptEdits', 'default', 'bypassPermissions'];
    const currentIndex = modes.indexOf(thread.permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    try {
      await onPermissionModeChange(modes[nextIndex]);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update permission mode');
    }
  }, [thread.permissionMode, onPermissionModeChange, onError]);

  // Global keyboard shortcut for Ctrl+Shift+Enter to cycle permission mode
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.shiftKey && e.ctrlKey && document.activeElement === inputRef.current) {
        e.preventDefault();
        e.stopPropagation();
        cyclePermissionMode();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
    };
  }, [cyclePermissionMode]);

  // Global keyboard shortcut for Escape to stop running thread
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && thread.status === 'pending') {
        e.preventDefault();
        onStopThread();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [thread.status, onStopThread]);

  const doSend = useCallback(async () => {
    if (!input.trim() && images.length === 0) return;

    const messageContent = input;
    const messageImages = images.length > 0 ? [...images] : undefined;
    const messageFileRefs = fileRefs.length > 0 ? fileRefs.map(f => f.path) : undefined;

    // Clear state before sending
    setInput('');
    setImages([]);
    setFileRefs([]);
    setShowFilePicker(false);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      await onSendMessage(messageContent, messageImages, messageFileRefs);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to send message');
    }
  }, [input, images, fileRefs, onSendMessage, onError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    doSend();
  };

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Shift+Enter: cycle permission mode
      if (e.key === 'Enter' && e.shiftKey && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        cyclePermissionMode();
        return;
      }
      // Shift+Enter: insert newline (default textarea behavior, no action needed)
      if (e.key === 'Enter' && e.shiftKey) {
        return;
      }
      // Enter without Shift: send message
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    },
    [cyclePermissionMode, doSend]
  );

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    try {
      await onModelChange(e.target.value as ModelType);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update model');
    }
  };

  const handlePermissionChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    try {
      await onPermissionModeChange(e.target.value as PermissionMode);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update permission mode');
    }
  };

  const handleThinkingChange = async (enabled: boolean) => {
    try {
      await onThinkingToggle(enabled);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update thinking mode');
    }
  };

  return (
    <div
      className={`border-t border-border p-4 flex-shrink-0 space-y-3 transition-colors ${
        isDragging ? 'bg-primary/10 border-primary' : ''
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-lg pointer-events-none z-10">
          <p className="text-primary font-medium">Drop images here</p>
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          {/* Model selector */}
          <select
            value={thread.model}
            onChange={handleModelChange}
            className="text-xs px-2 py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Select model"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Permission mode selector */}
          <select
            value={thread.permissionMode}
            onChange={handlePermissionChange}
            className={`text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 ${
              thread.permissionMode === 'bypassPermissions'
                ? 'border-red-500 text-red-600 bg-red-50 focus:ring-red-500'
                : 'border-border bg-background focus:ring-primary'
            }`}
            aria-label="Permission mode"
          >
            {PERMISSION_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.value === 'bypassPermissions' ? '⚠ ' + opt.label : opt.label}
              </option>
            ))}
          </select>

          {/* Extended thinking toggle */}
          <Toggle
            enabled={thread.extendedThinking}
            onChange={handleThinkingChange}
            label="Thinking"
          />

        </div>
      </div>

      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {images.map(img => (
            <div key={img.id} className="relative group">
              <img
                src={img.preview}
                alt={img.name}
                className="w-16 h-16 object-cover rounded-lg border border-border"
              />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full
                           flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* File reference chips */}
      {fileRefs.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {fileRefs.map(file => (
            <span
              key={file.path}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded-md border border-border"
            >
              <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-muted-foreground">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFileRef(file.path)}
                className="ml-1 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <form onSubmit={handleSubmit} className="flex gap-2 relative">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          aria-label="Upload images"
        />

        {/* Attachment button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Attach images"
          aria-label="Attach images"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              handleFilePickerKeyDown(e as unknown as React.KeyboardEvent);
              if (!showFilePicker) handleInputKeyDown(e);
            }}
            onPaste={handlePaste}
            placeholder="Type a message... (@ for files)"
            disabled={disabled}
            aria-label="Message input"
            rows={1}
            className="w-full px-4 py-2 rounded-lg border border-border bg-background
                       focus:outline-none focus:ring-2 focus:ring-primary resize-none overflow-y-auto"
            style={{ maxHeight: '200px' }}
          />

          {/* File picker dropdown */}
          {showFilePicker && fileResults.length > 0 && (
            <div
              ref={filePickerRef}
              className="absolute bottom-full left-0 mb-1 w-80 max-h-60 overflow-y-auto
                         bg-background border border-border rounded-lg shadow-lg z-20"
            >
              {fileResults.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => addFileRef(file)}
                  onMouseEnter={() => setSelectedFileIndex(index)}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                    index === selectedFileIndex ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                >
                  <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="truncate">{file.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {thread.status === 'pending' ? (
          <button
            type="button"
            onClick={onStopThread}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
            title="Stop running agent (Esc)"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={(!input.trim() && images.length === 0) || disabled}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            Send
          </button>
        )}
        <button
          type="button"
          onClick={onCreateThread}
          className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
          aria-label="Create new sub-thread"
        >
          + Thread
        </button>
      </form>
    </div>
  );
}
