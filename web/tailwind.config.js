const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), surface: c('surface'), sunken: c('sunken'), ink: c('ink'), muted: c('muted'), line: c('line'),
        primary: c('primary'), 'primary-ink': c('primary-ink'), 'primary-soft': c('primary-soft'),
        accent: c('accent'), danger: c('danger'), 'danger-soft': c('danger-soft'), success: c('success'), 'success-soft': c('success-soft'),
        warn: c('warn'), 'warn-soft': c('warn-soft'), sidebar: c('sidebar'), 'sidebar-ink': c('sidebar-ink'),
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'system-ui', 'sans-serif'],
        sans: ['"Figtree Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { control: '7px', panel: '12px' },
      boxShadow: { pop: '0 12px 32px -8px rgb(9 30 26 / 0.28), 0 2px 6px rgb(9 30 26 / 0.08)', drawer: '-16px 0 40px -12px rgb(9 30 26 / 0.3)' },
      keyframes: {
        drawerIn: { from: { transform: 'translateX(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        popIn: { from: { transform: 'translateY(6px) scale(0.98)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        grow: { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
      },
      animation: { drawerIn: 'drawerIn .22s ease-out', popIn: 'popIn .16s ease-out', fade: 'fade .18s ease-out', grow: 'grow .7s cubic-bezier(.2,.7,.2,1) both' },
    },
  },
  plugins: [],
};
