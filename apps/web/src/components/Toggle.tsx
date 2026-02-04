interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label?: string;
  size?: 'sm' | 'md';
}

export function Toggle({ enabled, onChange, label, size = 'sm' }: ToggleProps) {
  const dimensions = size === 'sm'
    ? { track: 'w-8 h-4', thumb: 'w-3 h-3', translate: 'translate-x-4' }
    : { track: 'w-10 h-5', thumb: 'w-4 h-4', translate: 'translate-x-5' };

  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`
          ${dimensions.track} rounded-full transition-colors duration-200 ease-in-out
          relative inline-flex items-center shrink-0
          ${enabled
            ? 'bg-primary'
            : 'bg-muted-foreground/30'
          }
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
        `}
      >
        <span
          className={`
            ${dimensions.thumb} rounded-full bg-white shadow-sm
            transform transition-transform duration-200 ease-in-out
            ${enabled ? dimensions.translate : 'translate-x-0.5'}
          `}
        />
      </button>
      {label && (
        <span className="text-xs text-foreground">{label}</span>
      )}
    </label>
  );
}
