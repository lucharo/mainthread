import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import type { ModelType, PermissionMode } from '../store/types';

const MODEL_OPTIONS: { value: ModelType; label: string; desc: string }[] = [
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5', desc: 'Fast & capable' },
  { value: 'claude-opus-4-5', label: 'Opus 4.5', desc: 'Most intelligent' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', desc: 'Quick & light' },
];

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string; warning?: boolean }[] = [
  { value: 'plan', label: 'Plan Mode', desc: 'Review changes before applying' },
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-accept file changes' },
  { value: 'default', label: 'Normal', desc: 'Prompt for each action' },
  { value: 'bypassPermissions', label: 'Bypass All', desc: 'Skip permission prompts', warning: true },
];

export function SettingsPanel() {
  const {
    isSettingsOpen, closeSettings,
    defaultModel, defaultPermissionMode, defaultExtendedThinking,
    defaultAutoReact, showArchivedByDefault,
    experimentalAllowNestedSubthreads, experimentalMaxThreadDepth,
    updateSettings, resetToDefaults,
  } = useSettingsStore();

  const panelRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // Animate in
  useEffect(() => {
    if (isSettingsOpen) {
      setIsAnimating(true);
      requestAnimationFrame(() => setIsAnimating(false));
    }
  }, [isSettingsOpen]);

  // Escape to close
  useEffect(() => {
    if (!isSettingsOpen) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && closeSettings();
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isSettingsOpen, closeSettings]);

  if (!isSettingsOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && closeSettings()}
    >
      {/* Frosted backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className={`
          relative bg-background/95 backdrop-blur-xl border border-border/50
          rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden
          transform transition-all duration-200 ease-out
          ${isAnimating ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5
                           text-[10px] font-medium text-muted-foreground
                           bg-muted/50 rounded-md border border-border/50">
              <span className="text-xs">&#8984;</span>,
            </kbd>
          </div>
          <button
            onClick={closeSettings}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground
                       hover:bg-muted/50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Thread Defaults Section */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Thread Defaults
            </h3>
            <div className="bg-muted/30 rounded-xl p-4 space-y-4 border border-border/30">
              {/* Model Select */}
              <SettingRow label="Default Model" description="For new threads">
                <CustomSelect
                  value={defaultModel}
                  options={MODEL_OPTIONS}
                  onChange={(v) => updateSettings({ defaultModel: v as ModelType })}
                />
              </SettingRow>

              {/* Permission Mode Select */}
              <SettingRow label="Permission Mode" description="How Claude asks for approval">
                <CustomSelect
                  value={defaultPermissionMode}
                  options={PERMISSION_OPTIONS}
                  onChange={(v) => updateSettings({ defaultPermissionMode: v as PermissionMode })}
                  warning={defaultPermissionMode === 'bypassPermissions'}
                />
              </SettingRow>

              <div className="border-t border-border/30 pt-4 space-y-3">
                {/* Extended Thinking Toggle */}
                <SettingToggle
                  label="Extended Thinking"
                  description="Enable deep reasoning"
                  enabled={defaultExtendedThinking}
                  onChange={(v) => updateSettings({ defaultExtendedThinking: v })}
                />

                {/* Auto-React Toggle */}
                <SettingToggle
                  label="Auto-React"
                  description="Respond to sub-thread completions"
                  enabled={defaultAutoReact}
                  onChange={(v) => updateSettings({ defaultAutoReact: v })}
                />
              </div>
            </div>
          </section>

          {/* Display Section */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Display
            </h3>
            <div className="bg-muted/30 rounded-xl p-4 border border-border/30 space-y-4">
              {/* Theme Selector */}
              <ThemeSelector />

              <div className="border-t border-border/30 pt-4">
                <SettingToggle
                  label="Show Archived"
                  description="Display archived threads by default"
                  enabled={showArchivedByDefault}
                  onChange={(v) => updateSettings({ showArchivedByDefault: v })}
                />
              </div>
            </div>
          </section>

          {/* Keyboard Shortcuts Section */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Keyboard Shortcuts
            </h3>
            <div className="bg-muted/30 rounded-xl p-3 border border-border/30 space-y-2">
              <ShortcutRow keys={['&#8984;', 'K']} description="Command palette" />
              <ShortcutRow keys={['&#8984;', ',']} description="Open settings" />
              <ShortcutRow keys={['Shift', 'Enter']} description="Cycle permission mode" />
              <ShortcutRow keys={['Esc']} description="Stop running thread" />
              <ShortcutRow keys={['Esc']} description="Close modals/settings" />
            </div>
          </section>

          {/* Experimental Section */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Experimental
            </h3>
            <div className="bg-muted/30 rounded-xl p-4 border border-border/30 space-y-4">
              <SettingToggle
                label="Nested Sub-threads"
                description="Allow sub-threads to spawn their own sub-threads"
                enabled={experimentalAllowNestedSubthreads}
                onChange={(v) => updateSettings({ experimentalAllowNestedSubthreads: v })}
              />
              {experimentalAllowNestedSubthreads && (
                <SettingRow label="Max Depth" description="Maximum nesting level (2-5)">
                  <input
                    type="number"
                    min={2}
                    max={5}
                    value={experimentalMaxThreadDepth}
                    onChange={(e) => updateSettings({
                      experimentalMaxThreadDepth: Math.min(5, Math.max(2, parseInt(e.target.value) || 3))
                    })}
                    className="w-16 px-2 py-1 rounded border border-border bg-background text-sm
                               focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </SettingRow>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-muted/20">
          <button
            onClick={resetToDefaults}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset to Defaults
          </button>
          <button
            onClick={closeSettings}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium
                       rounded-lg hover:bg-primary/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Sub-components for clean organization
function SettingRow({ label, description, children }: {
  label: string; description: string; children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {children}
    </div>
  );
}

function SettingToggle({ label, description, enabled, onChange }: {
  label: string; description: string; enabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`
          relative w-11 h-6 rounded-full transition-colors duration-200
          ${enabled ? 'bg-primary' : 'bg-muted-foreground/30'}
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
        `}
      >
        <span className={`
          absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm
          transition-transform duration-200 ${enabled ? 'translate-x-5' : ''}
        `} />
      </button>
    </div>
  );
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{description}</span>
      <div className="flex items-center gap-1">
        {keys.map((key, i) => (
          <span key={i}>
            <kbd className="px-1.5 py-0.5 text-[10px] font-medium bg-background border border-border/50 rounded"
                 dangerouslySetInnerHTML={{ __html: key }} />
            {i < keys.length - 1 && <span className="text-muted-foreground mx-0.5">+</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function ThemeSelector() {
  const theme = useSettingsStore((state) => state.theme);
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  const themes = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
    { value: 'system', label: 'System', icon: '💻' },
  ] as const;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">Theme</div>
        <div className="text-xs text-muted-foreground">Light, dark, or system</div>
      </div>
      <div className="flex gap-1 bg-background/50 rounded-lg p-1 border border-border/30">
        {themes.map((t) => (
          <button
            key={t.value}
            onClick={() => updateSettings({ theme: t.value })}
            className={`
              px-3 py-1.5 text-sm rounded-md transition-colors
              ${theme === t.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}
            `}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CustomSelect({ value, options, onChange, warning }: {
  value: string;
  options: { value: string; label: string; desc: string; warning?: boolean }[];
  onChange: (v: string) => void;
  warning?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`
          flex items-center justify-between gap-2 w-40 px-3 py-1.5 text-sm
          rounded-lg border transition-colors text-left
          ${warning
            ? 'border-red-500/50 bg-red-500/10 text-red-400'
            : 'border-border/50 bg-background/50 hover:bg-muted/50'}
        `}
      >
        <span className="truncate">{selected?.label}</span>
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
             fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-56 bg-background border border-border
                          rounded-lg shadow-lg z-20 py-1 overflow-hidden">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`
                  w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors
                  ${opt.value === value ? 'bg-muted/30' : ''}
                  ${opt.warning ? 'text-red-400' : ''}
                `}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
