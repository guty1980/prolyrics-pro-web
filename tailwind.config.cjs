/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },
        ink: {
          900: '#0b0b14',
          800: '#151526',
          700: '#1f1f36',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 20px 60px -20px rgba(109, 40, 217, 0.55)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
