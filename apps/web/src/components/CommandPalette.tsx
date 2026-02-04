import { useState, useEffect, useRef, useMemo } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useThreadStore } from '../store/threadStore';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
  icon: React.ReactNode;
  danger?: boolean;
}

export function CommandPalette() {
  const {
    isCommandPaletteOpen,
    closeCommandPalette,
    openSettings,
    openCreateThreadModal,
  } = useSettingsStore();

  const { activeThreadId, threads, stopThread, clearThreadMessages } = useThreadStore();

  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find(t => t.id === activeThreadId);
  const isRunning = activeThread?.status === 'pending';

  // Find all running sub-threads (threads with a parentId and status 'pending')
  const runningSubthreads = threads.filter(t => t.parentId && t.status === 'pending');
  const hasRunningSubthreads = runningSubthreads.length > 0;

  const commands: Command[] = useMemo(() => [
    {
      id: 'new-thread',
      label: 'New Thread',
      shortcut: 'N',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
        </svg>
      ),
      action: () => {
        closeCommandPalette();
        openCreateThreadModal();
      },
    },
    {
      id: 'settings',
      label: 'Settings',
      shortcut: ',',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      action: () => {
        closeCommandPalette();
        openSettings();
      },
    },
    {
      id: 'stop-thread',
      label: isRunning ? 'Stop Thread' : 'Stop Thread (not running)',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
      ),
      action: () => {
        if (activeThreadId && isRunning) {
          stopThread(activeThreadId);
        }
        closeCommandPalette();
      },
    },
    {
      id: 'clear-messages',
      label: 'Clear Messages',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      action: () => {
        if (activeThreadId) {
          clearThreadMessages(activeThreadId);
        }
        closeCommandPalette();
      },
    },
    {
      id: 'stop-all-subthreads',
      label: hasRunningSubthreads
        ? `Stop All Subthreads (${runningSubthreads.length} running)`
        : 'Stop All Subthreads (none running)',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      ),
      danger: true,
      action: async () => {
        if (hasRunningSubthreads) {
          // Stop all running subthreads in parallel
          await Promise.all(runningSubthreads.map(t => stopThread(t.id)));
        }
        closeCommandPalette();
      },
    },
  ], [activeThreadId, isRunning, hasRunningSubthreads, runningSubthreads, closeCommandPalette, openSettings, openCreateThreadModal, stopThread, clearThreadMessages]);

  // Filter commands based on search
  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands;
    const query = search.toLowerCase();
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(query) ||
      cmd.id.toLowerCase().includes(query)
    );
  }, [commands, search]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Focus input when palette opens
  useEffect(() => {
    if (isCommandPaletteOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isCommandPaletteOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isCommandPaletteOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
          }
          break;
        case 'Escape':
          e.preventDefault();
          closeCommandPalette();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, selectedIndex, filteredCommands, closeCommandPalette]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-command]');
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={(e) => e.target === e.currentTarget && closeCommandPalette()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Palette */}
      <div className="relative bg-background/95 backdrop-blur-xl border border-border/50
                      rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground
                          bg-muted/50 rounded border border-border/50">
            esc
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[300px] overflow-y-auto py-2">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No commands found
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <button
                key={cmd.id}
                data-command={cmd.id}
                onClick={cmd.action}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`
                  w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                  ${index === selectedIndex ? 'bg-muted/50' : 'hover:bg-muted/30'}
                  ${cmd.id === 'stop-thread' && !isRunning ? 'opacity-50' : ''}
                  ${cmd.id === 'stop-all-subthreads' && !hasRunningSubthreads ? 'opacity-50' : ''}
                  ${cmd.danger ? 'text-red-400' : ''}
                `}
              >
                <span className="text-muted-foreground">{cmd.icon}</span>
                <span className="flex-1 text-sm">{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground
                                  bg-muted/50 rounded border border-border/50">
                    <span className="text-xs">&#8984;</span>{cmd.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border/50 bg-muted/20">
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-muted/50 rounded border border-border/50">&#8593;</kbd>
              <kbd className="px-1 py-0.5 bg-muted/50 rounded border border-border/50">&#8595;</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-muted/50 rounded border border-border/50">&#8629;</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-muted/50 rounded border border-border/50">esc</kbd>
              close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
