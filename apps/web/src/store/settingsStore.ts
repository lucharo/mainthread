import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelType, PermissionMode } from './types';

type Theme = 'light' | 'dark' | 'system';

interface AppSettings {
  defaultModel: ModelType;
  defaultPermissionMode: PermissionMode;
  defaultExtendedThinking: boolean;
  defaultAutoReact: boolean;
  showArchivedByDefault: boolean;
  theme: Theme;
  // Experimental settings
  experimentalAllowNestedSubthreads: boolean;
  experimentalMaxThreadDepth: number;
}

interface SettingsState extends AppSettings {
  // Settings panel state
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  // Create thread modal state (for global Cmd+N shortcut)
  isCreateThreadModalOpen: boolean;
  openCreateThreadModal: () => void;
  closeCreateThreadModal: () => void;
  // Command palette state (Cmd+K)
  isCommandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  // Settings actions
  updateSettings: (partial: Partial<AppSettings>) => void;
  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: 'claude-sonnet-4-5',
  defaultPermissionMode: 'acceptEdits',
  defaultExtendedThinking: true,
  defaultAutoReact: true,
  showArchivedByDefault: false,
  theme: 'system',
  // Experimental settings
  experimentalAllowNestedSubthreads: false,
  experimentalMaxThreadDepth: 3,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      isSettingsOpen: false,
      openSettings: () => set({ isSettingsOpen: true }),
      closeSettings: () => set({ isSettingsOpen: false }),
      toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
      isCreateThreadModalOpen: false,
      openCreateThreadModal: () => set({ isCreateThreadModalOpen: true }),
      closeCreateThreadModal: () => set({ isCreateThreadModalOpen: false }),
      isCommandPaletteOpen: false,
      openCommandPalette: () => set({ isCommandPaletteOpen: true }),
      closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
      toggleCommandPalette: () =>
        set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),
      updateSettings: (partial) => set((s) => ({ ...s, ...partial })),
      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'mainthread-settings',
      partialize: (state) => ({
        defaultModel: state.defaultModel,
        defaultPermissionMode: state.defaultPermissionMode,
        defaultExtendedThinking: state.defaultExtendedThinking,
        defaultAutoReact: state.defaultAutoReact,
        showArchivedByDefault: state.showArchivedByDefault,
        theme: state.theme,
        experimentalAllowNestedSubthreads: state.experimentalAllowNestedSubthreads,
        experimentalMaxThreadDepth: state.experimentalMaxThreadDepth,
      }),
    },
  ),
);
