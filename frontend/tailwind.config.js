/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        'attack-red': '#f43f5e',
        'crown-gold': '#fbbf24',
        'safe-green': '#10b981',
        'role-purple': '#a855f7',
        'node-blue': '#3b82f6',
        'node-cyan': '#06b6d4',
      },
      animation: {
        'ping-slow': 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
      },
    },
  },
  plugins: [],
}
