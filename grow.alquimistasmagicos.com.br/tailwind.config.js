/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'sans-serif'] },
      colors: {
        dark: { 50: '#f8fafc', 100: '#1e293b', 200: '#162032', 300: '#0f172a', 400: '#0b1120' }
      }
    }
  },
  plugins: []
}
