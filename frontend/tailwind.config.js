/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#05070d', 900: '#080c16', 850: '#0b1120', 800: '#0f172a', 700: '#1a2336', 600: '#263149' },
        tele: '#22d3ee',
        safe: '#10b981',
        warn: '#f59e0b',
        crit: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,211,238,.15), 0 8px 40px -12px rgba(34,211,238,.25)',
        crit: '0 0 0 1px rgba(239,68,68,.45), 0 0 60px -10px rgba(239,68,68,.55)',
      },
      keyframes: {
        pulseRed: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.35' } },
        sweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
      },
      animation: { pulseRed: 'pulseRed 1s ease-in-out infinite', sweep: 'sweep 2.4s linear infinite' },
    },
  },
  plugins: [],
}
