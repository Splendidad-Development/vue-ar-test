/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'path-flow': {
          to: { strokeDashoffset: '-48' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '0.9' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        burst: {
          '0%': { transform: 'scale(0.4)', opacity: '1' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
        spark: {
          '0%': { transform: 'rotate(var(--angle)) translateY(0) scale(1)', opacity: '1' },
          '100%': { transform: 'rotate(var(--angle)) translateY(calc(var(--dist) * -1)) scale(0.2)', opacity: '0' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.06)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '75%': { transform: 'translateX(4px)' },
        },
        'draw-in': {
          from: { strokeDashoffset: '1' },
          to: { strokeDashoffset: '0' },
        },
      },
      animation: {
        'path-flow': 'path-flow 1.2s linear infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
        burst: 'burst 0.9s cubic-bezier(0.2, 0.7, 0.3, 1) forwards',
        spark: 'spark 0.9s cubic-bezier(0.2, 0.7, 0.3, 1) forwards',
        'pop-in': 'pop-in 0.6s cubic-bezier(0.2, 0.8, 0.3, 1.2) both',
        float: 'float 3s ease-in-out infinite',
        shake: 'shake 0.3s ease-in-out',
        'draw-in': 'draw-in 2.4s ease-out both',
      },
    },
  },
  plugins: [],
}
