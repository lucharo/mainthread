import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { type ModelType, type PermissionMode, type DirectoryEntry, type GitInfo } from '../store/threadStore';
import { useSettingsStore } from '../store/settingsStore';
import { Toggle } from './Toggle';

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function GitBranchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M7 10V5a2 2 0 012-2h6a2 2 0 012 2v5M7 10v4a2 2 0 002 2h6a2 2 0 002-2v-4M7 10h10" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function GitRepoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="6" cy="6" r="2" strokeWidth={2} />
      <circle cx="18" cy="6" r="2" strokeWidth={2} />
      <circle cx="6" cy="18" r="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 8v8M18 8v4a4 4 0 01-4 4H6" />
    </svg>
  );
}

interface DirectorySuggestion {
  path: string;
  type: 'folder' | 'git' | 'recent';
  reason: string;
}

// Format path for display - use ~ for home, show last 2-3 segments for readability
function formatPathForDisplay(path: string, short = false): string {
  // Replace home directory with ~
  const home = '/Users/';
  let display = path;
  if (path.startsWith(home)) {
    const afterUsers = path.slice(home.length);
    const firstSlash = afterUsers.indexOf('/');
    if (firstSlash > 0) {
      display = '~' + afterUsers.slice(firstSlash);
    }
  }

  if (short) {
    // For chips: show ~/parent/name or just name if short
    const parts = display.split('/').filter(Boolean);
    if (parts.length <= 2) return display;
    return '~/' + parts.slice(-2).join('/');
  }

  return display;
}

const MODEL_OPTIONS: { value: ModelType; label: string; description: string }[] = [
  { value: 'claude-opus-4-6', label: 'Opus 4.6', description: 'Most powerful' },
  { value: 'claude-opus-4-5', label: 'Opus 4.5', description: 'Highly capable' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5', description: 'Fast and capable' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', description: 'Quick responses' },
];

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'plan', label: 'Plan', description: 'Review changes before applying' },
  { value: 'acceptEdits', label: 'Accept Edits', description: 'Auto-accept file changes' },
  { value: 'default', label: 'Normal', description: 'Prompt for each action' },
  { value: 'bypassPermissions', label: 'Bypass', description: 'Skip all permission prompts' },
];

interface CreateThreadOptions {
  title: string;
  workDir?: string;
  model?: ModelType;
  extendedThinking?: boolean;
  permissionMode?: PermissionMode;
  gitBranch?: string;
  useWorktree?: boolean;
  worktreePath?: string;
}

interface CreateThreadModalProps {
  isOpen: boolean;
  onSubmit: (options: CreateThreadOptions) => void;
  onCancel: () => void;
}

export function CreateThreadModal({
  isOpen,
  onSubmit,
  onCancel,
}: CreateThreadModalProps) {
  const { defaultModel, defaultExtendedThinking, defaultPermissionMode, openSettings, closeCreateThreadModal } = useSettingsStore();
  const [title, setTitle] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [model, setModel] = useState<ModelType>(defaultModel);
  const [extendedThinking, setExtendedThinking] = useState(defaultExtendedThinking);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(defaultPermissionMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const workDirRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Path autocomplete state
  const [dirSuggestions, setDirSuggestions] = useState<DirectoryEntry[]>([]);
  const [showDirSuggestions, setShowDirSuggestions] = useState(false);
  const [selectedDirIndex, setSelectedDirIndex] = useState(0);
  const [pathExists, setPathExists] = useState<boolean | null>(null);
  const [isCreatingDir, setIsCreatingDir] = useState(false);

  // Smart directory suggestions
  const [directorySuggestions, setDirectorySuggestions] = useState<DirectorySuggestion[]>([]);

  // Git state
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [isLoadingGit, setIsLoadingGit] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [worktreePath, setWorktreePath] = useState('');

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

  // Focus management and reset form
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTitle('');
      setModel(defaultModel);
      setExtendedThinking(defaultExtendedThinking);
      setPermissionMode(defaultPermissionMode);
      setDirSuggestions([]);
      setShowDirSuggestions(false);
      setPathExists(null);
      setDirectorySuggestions([]);
      setGitInfo(null);
      setSelectedBranch(null);
      setShowBranchDropdown(false);
      setIsCreatingBranch(false);
      setNewBranchName('');
      setUseWorktree(false);
      setWorktreePath('');

      // Fetch current working directory as default
      fetch('/api/cwd')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.path) {
            setWorkDir(data.path);
            setPathExists(true);
          } else {
            setWorkDir('');
          }
        })
        .catch(() => setWorkDir(''));

      // Fetch smart directory suggestions
      fetch('/api/directories/suggestions')
        .then(res => res.ok ? res.json() : [])
        .then((data: DirectorySuggestion[]) => setDirectorySuggestions(data))
        .catch(() => setDirectorySuggestions([]));

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen, defaultModel, defaultExtendedThinking, defaultPermissionMode]);

  // Extracted function to fetch directory suggestions
  const fetchDirSuggestions = useCallback(async (path: string) => {
    try {
      // API supports empty path (returns home directory contents)
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}&type=directory`);
      if (res.ok) {
        const data: DirectoryEntry[] = await res.json();
        setDirSuggestions(data);
        setSelectedDirIndex(0);

        // When path is empty, pathExists is null (no path to validate)
        if (!path) {
          setPathExists(null);
          return;
        }

        // Check if path exists exactly - match against suggestions or check for exact parent match
        const normalizedPath = path.replace(/\/$/, '');
        const exactMatch = data.some(d => d.path === normalizedPath || d.path === path);

        // Also consider it existing if we got suggestions from that directory
        // (meaning the path is a valid parent directory)
        const isValidParent = data.length > 0 && data.every(d => d.path.startsWith(normalizedPath + '/'));

        if (exactMatch || isValidParent) {
          setPathExists(true);
        } else {
          // Check if it's a partial match (typing in progress)
          const isPartialMatch = data.length > 0;
          setPathExists(isPartialMatch ? null : false);
        }
      }
    } catch {
      setDirSuggestions([]);
    }
  }, []);

  // Fetch directory suggestions when workDir changes
  useEffect(() => {
    const debounce = setTimeout(() => fetchDirSuggestions(workDir), 150);
    return () => clearTimeout(debounce);
  }, [workDir, fetchDirSuggestions]);

  // Fetch git info when path changes
  useEffect(() => {
    if (!workDir || pathExists === false) {
      setGitInfo(null);
      setSelectedBranch(null);
      return;
    }

    const fetchGitInfo = async () => {
      setIsLoadingGit(true);
      try {
        const res = await fetch(`/api/git/info?path=${encodeURIComponent(workDir)}`);
        if (res.ok) {
          const data: GitInfo = await res.json();
          setGitInfo(data);
          if (data.isGitRepo && data.currentBranch) {
            setSelectedBranch(data.currentBranch);
            // Git API validates path exists, so mark it as valid
            setPathExists(true);
          } else if (data.repoRoot === null && pathExists === null) {
            // API checked and path doesn't exist or isn't accessible
            // Only set if we haven't determined existence yet
          }
        }
      } catch {
        setGitInfo(null);
      } finally {
        setIsLoadingGit(false);
      }
    };

    const debounce = setTimeout(fetchGitInfo, 500);
    return () => clearTimeout(debounce);
  }, [workDir, pathExists]);

  // Generate worktree path when branch changes
  useEffect(() => {
    if (!gitInfo?.repoRoot || !selectedBranch || selectedBranch === gitInfo.currentBranch) {
      setWorktreePath('');
      return;
    }

    // Sanitize branch name for path: feature/new -> feature-new
    const sanitized = selectedBranch.replace(/[\/\\]/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
    const repoName = gitInfo.repoName || 'repo';
    const parentDir = gitInfo.repoRoot.split('/').slice(0, -1).join('/');
    setWorktreePath(`${parentDir}/${repoName}-${sanitized}`);
  }, [selectedBranch, gitInfo]);

  // Focus trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab') {
        const focusableElements = e.currentTarget.querySelectorAll<HTMLElement>(
          'input, select, button:not([disabled])',
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

  // Handle directory suggestion keyboard navigation
  const handleWorkDirKeyDown = (e: React.KeyboardEvent) => {
    if (!showDirSuggestions || dirSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedDirIndex(i => Math.min(i + 1, dirSuggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedDirIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (dirSuggestions[selectedDirIndex]) {
          e.preventDefault();
          setWorkDir(dirSuggestions[selectedDirIndex].path);
          setShowDirSuggestions(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowDirSuggestions(false);
        break;
      case 'Tab':
        if (dirSuggestions[selectedDirIndex]) {
          e.preventDefault();
          setWorkDir(dirSuggestions[selectedDirIndex].path);
          setShowDirSuggestions(false);
        }
        break;
    }
  };

  // Create directory
  const handleCreateDirectory = async () => {
    if (!workDir) return;

    setIsCreatingDir(true);
    try {
      const res = await fetch('/api/directories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workDir }),
      });

      if (res.ok) {
        const data = await res.json();
        setWorkDir(data.path);
        setPathExists(true);
      }
    } catch (err) {
      console.error('Failed to create directory:', err);
    } finally {
      setIsCreatingDir(false);
    }
  };

  // Select a directory suggestion
  const selectSuggestion = (suggestion: DirectoryEntry) => {
    setWorkDir(suggestion.path);
    setShowDirSuggestions(false);
    workDirRef.current?.focus();
  };

  // Select a branch
  const selectBranch = (branch: string) => {
    setSelectedBranch(branch);
    setShowBranchDropdown(false);
    setIsCreatingBranch(false);
    setNewBranchName('');
  };

  // Start creating a new branch
  const startCreatingBranch = () => {
    setIsCreatingBranch(true);
    setShowBranchDropdown(false);
  };

  // Confirm new branch creation
  const confirmNewBranch = () => {
    if (newBranchName.trim()) {
      setSelectedBranch(newBranchName.trim());
      setIsCreatingBranch(false);
      setNewBranchName('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      const options: CreateThreadOptions = {
        title: title.trim(),
        workDir: workDir.trim() || undefined,
        model,
        extendedThinking,
        permissionMode,
      };

      // Add git branch options if a different branch is selected
      if (gitInfo?.isGitRepo && selectedBranch && selectedBranch !== gitInfo.currentBranch) {
        options.gitBranch = selectedBranch;
        options.useWorktree = useWorktree;
        if (useWorktree && worktreePath) {
          options.worktreePath = worktreePath;
        }
      }

      onSubmit(options);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  // Check if branch is different from current
  const isBranchDifferent = gitInfo?.isGitRepo && selectedBranch && selectedBranch !== gitInfo.currentBranch;
  const isNewBranch = gitInfo?.isGitRepo && selectedBranch && !gitInfo.branches.includes(selectedBranch);

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
        className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-lg font-semibold">
            Create New Thread
          </h2>
          <button
            type="button"
            onClick={() => {
              closeCreateThreadModal();
              openSettings();
            }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Configure defaults"
          >
            <GearIcon className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title input */}
          <div>
            <label htmlFor={`${titleId}-title`} className="block text-sm font-medium mb-1">
              Title
            </label>
            <input
              id={`${titleId}-title`}
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter thread title..."
              className="w-full px-4 py-2 rounded-lg border border-border bg-background
                         focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Working directory input with autocomplete */}
          <div className="relative">
            <label htmlFor={`${titleId}-workdir`} className="block text-sm font-medium mb-1">
              Working Directory
            </label>

            {/* Smart directory suggestions - clickable chips */}
            {directorySuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {directorySuggestions.slice(0, 8).map((s) => (
                  <button
                    key={s.path}
                    type="button"
                    onClick={() => {
                      setWorkDir(s.path);
                      setPathExists(true);
                    }}
                    className="px-2 py-1 text-xs rounded-full bg-muted hover:bg-muted/80
                               flex items-center gap-1 text-muted-foreground hover:text-foreground
                               transition-colors border border-transparent hover:border-border/50"
                    title={formatPathForDisplay(s.path)}
                  >
                    {s.type === 'git' && <GitRepoIcon className="w-3 h-3" />}
                    {s.type === 'recent' && <ClockIcon className="w-3 h-3" />}
                    {s.type === 'folder' && <FolderIcon className="w-3 h-3" />}
                    <span className="truncate max-w-[140px] font-mono">{formatPathForDisplay(s.path, true)}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="relative">
              <input
                id={`${titleId}-workdir`}
                ref={workDirRef}
                type="text"
                value={workDir}
                onChange={(e) => {
                  setWorkDir(e.target.value);
                  setShowDirSuggestions(true);
                }}
                onFocus={() => {
                  setShowDirSuggestions(true);
                  // Fetch suggestions if empty (e.g., on initial focus with prefilled path)
                  // BUT don't re-validate if we already know the path exists (e.g., after creating it)
                  if (dirSuggestions.length === 0 && workDir && pathExists !== true) {
                    fetchDirSuggestions(workDir);
                  }
                }}
                onBlur={() => {
                  // Delay hiding to allow click on suggestions
                  setTimeout(() => setShowDirSuggestions(false), 200);
                }}
                onKeyDown={handleWorkDirKeyDown}
                placeholder="~ or /path/to/project"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                className="w-full px-4 py-2 pr-10 rounded-lg border border-border bg-background
                           focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
              />
              <FolderIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>

            {/* Directory suggestions dropdown */}
            {showDirSuggestions && dirSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {dirSuggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.path}
                    type="button"
                    onClick={() => selectSuggestion(suggestion)}
                    onMouseEnter={() => setSelectedDirIndex(index)}
                    className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                      index === selectedDirIndex ? 'bg-muted' : 'hover:bg-muted/50'
                    }`}
                  >
                    <FolderIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="truncate font-mono text-xs">{formatPathForDisplay(suggestion.path)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Path validation status */}
            {workDir && (
              <div className="mt-1.5 flex items-center gap-2">
                {pathExists === false ? (
                  <>
                    <WarningIcon className="w-4 h-4 text-amber-500" />
                    <span className="text-xs text-amber-600">Path does not exist</span>
                    <button
                      type="button"
                      onClick={handleCreateDirectory}
                      disabled={isCreatingDir}
                      className="text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      {isCreatingDir ? 'Creating...' : 'Create it?'}
                    </button>
                  </>
                ) : pathExists === true && gitInfo?.isGitRepo ? (
                  <>
                    <CheckIcon className="w-4 h-4 text-green-500" />
                    <span className="text-xs text-green-600">
                      Git repository: {gitInfo.repoName}
                    </span>
                  </>
                ) : pathExists === true ? (
                  <>
                    <CheckIcon className="w-4 h-4 text-green-500" />
                    <span className="text-xs text-muted-foreground">(not a git repository)</span>
                  </>
                ) : null}
              </div>
            )}
          </div>

          {/* Branch selector - only show when git repo is detected */}
          {gitInfo?.isGitRepo && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border">
              <div className="relative">
                <label htmlFor={`${titleId}-branch`} className="block text-sm font-medium mb-1 flex items-center gap-2">
                  <GitBranchIcon className="w-4 h-4" />
                  Branch
                  <span className="text-xs text-muted-foreground font-normal">
                    (use worktree for parallel work)
                  </span>
                </label>

                {isCreatingBranch ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="feature/new-branch"
                      className="flex-1 px-3 py-2 rounded-lg border border-border bg-background
                                 focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          confirmNewBranch();
                        } else if (e.key === 'Escape') {
                          setIsCreatingBranch(false);
                          setNewBranchName('');
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={confirmNewBranch}
                      disabled={!newBranchName.trim()}
                      className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingBranch(false);
                        setNewBranchName('');
                      }}
                      className="px-3 py-2 border border-border rounded-lg hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                      className="w-full px-4 py-2 rounded-lg border border-border bg-background text-left
                                 focus:outline-none focus:ring-2 focus:ring-primary flex items-center justify-between"
                    >
                      <span className="font-mono text-sm">
                        {selectedBranch || gitInfo.currentBranch}
                        {selectedBranch === gitInfo.currentBranch && (
                          <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                        )}
                        {isNewBranch && (
                          <span className="ml-2 text-xs text-amber-600">(new)</span>
                        )}
                      </span>
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {showBranchDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {gitInfo.branches.map((branch) => (
                          <button
                            key={branch}
                            type="button"
                            onClick={() => selectBranch(branch)}
                            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-muted/50 ${
                              branch === selectedBranch ? 'bg-muted' : ''
                            }`}
                          >
                            {branch === selectedBranch && (
                              <CheckIcon className="w-4 h-4 text-primary flex-shrink-0" />
                            )}
                            <span className={`font-mono ${branch !== selectedBranch ? 'ml-6' : ''}`}>
                              {branch}
                            </span>
                            {branch === gitInfo.currentBranch && (
                              <span className="ml-auto text-xs text-muted-foreground">(current)</span>
                            )}
                          </button>
                        ))}
                        <div className="border-t border-border">
                          <button
                            type="button"
                            onClick={startCreatingBranch}
                            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-muted/50 text-primary"
                          >
                            <span className="ml-6">+ Create new branch...</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Checkout warning */}
              {isBranchDifferent && !isNewBranch && !useWorktree && (
                <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                  <WarningIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-700">
                      This will checkout '{selectedBranch}' in the repository.
                    </p>
                    <p className="text-amber-600 text-xs mt-0.5">
                      Any uncommitted changes may be affected. Consider using a worktree instead.
                    </p>
                  </div>
                </div>
              )}

              {/* Worktree option - show when different branch selected */}
              {isBranchDifferent && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useWorktree}
                      onChange={(e) => setUseWorktree(e.target.checked)}
                      className="w-4 h-4 rounded border-border"
                    />
                    <span className="text-sm">
                      Use git worktree
                      <span className="text-muted-foreground ml-1">(recommended for parallel work)</span>
                    </span>
                  </label>

                  {useWorktree && (
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        Worktree path:
                      </label>
                      <input
                        type="text"
                        value={worktreePath}
                        onChange={(e) => setWorktreePath(e.target.value)}
                        placeholder="Auto-generated path..."
                        className="w-full px-3 py-1.5 rounded border border-border bg-background
                                   focus:outline-none focus:ring-1 focus:ring-primary font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Model selector */}
          <div>
            <label htmlFor={`${titleId}-model`} className="block text-sm font-medium mb-1">
              Model
            </label>
            <select
              id={`${titleId}-model`}
              value={model}
              onChange={(e) => setModel(e.target.value as ModelType)}
              className="w-full px-4 py-2 rounded-lg border border-border bg-background
                         focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} - {opt.description}
                </option>
              ))}
            </select>
          </div>

          {/* Permission Mode selector */}
          <div>
            <label htmlFor={`${titleId}-permission-mode`} className="block text-sm font-medium mb-1">
              Permission Mode
            </label>
            <select
              id={`${titleId}-permission-mode`}
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              className={`w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 ${
                permissionMode === 'bypassPermissions'
                  ? 'border-red-500 text-red-600 bg-red-50 focus:ring-red-500'
                  : 'border-border bg-background focus:ring-primary'
              }`}
            >
              {PERMISSION_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value === 'bypassPermissions' ? '⚠ ' : ''}{opt.label} - {opt.description}
                </option>
              ))}
            </select>
          </div>

          {/* Extended Thinking toggle */}
          <div className="flex flex-col gap-1">
            <Toggle
              enabled={extendedThinking}
              onChange={setExtendedThinking}
              label="Extended Thinking"
              size="md"
            />
            <p className="text-xs text-muted-foreground">
              Extended reasoning for complex tasks
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-border rounded-lg hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg
                         hover:opacity-90 disabled:opacity-50"
            >
              Create Thread
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
