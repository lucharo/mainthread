/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        thinking: {
          DEFAULT: 'hsl(var(--thinking))',
          foreground: 'hsl(var(--thinking-foreground))',
          border: 'hsl(var(--thinking-border))',
        },
        'tool-use': {
          DEFAULT: 'hsl(var(--tool-use))',
          foreground: 'hsl(var(--tool-use-foreground))',
        },
        'tool-result': 'hsl(var(--tool-result))',
        system: 'hsl(var(--system))',
        error: 'hsl(var(--error))',
        success: 'hsl(var(--success))',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'fade-out': 'fadeOut 0.3s ease-out forwards',
        'slide-up': 'slideUp 0.2s ease-out',
        'slide-down': 'slideDown 0.2s ease-out',
        'thinking-pulse': 'thinkingPulse 2s ease-in-out infinite',
        'cursor-blink': 'cursorBlink 1s step-end infinite',
        'cursor-fade-out': 'cursorFadeOut 0.3s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        thinkingPulse: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        cursorBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        cursorFadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
      },
      boxShadow: {
        message: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        'message-hover': '0 4px 6px -1px rgb(0 0 0 / 0.1)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
