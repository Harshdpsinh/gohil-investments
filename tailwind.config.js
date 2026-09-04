/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',          // ← enables .dark class dark mode
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          500: '#14b8a6',
          600: '#0f766e',
          700: '#115e59',
          800: '#134e4a',
          900: '#042f2e',
        }
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] }
    }
  },
  plugins: []
}
