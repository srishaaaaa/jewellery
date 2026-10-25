/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bgMain:    '#FFFFFF', // Plain white surface (IGMOLS look)
        cardBg:    '#FFFFFF',
        brand: {
          black:      '#0A0A0A',
          dark:       '#141414',
          gold:       '#CA8A04',
          goldHover:  '#A16207',
          goldLight:  '#FEF9E7',
          goldBorder: '#EAD9A5',
        },
        gold: {
          DEFAULT: '#CA8A04',
          dark:    '#9E6C03',
          light:   '#FEF9E7',
          border:  '#EAD9A5',
        },
        maroon: {
          DEFAULT: '#CA8A04', // Shop theme (yellow)
          dark:    '#0A0A0A', // Remapped to Black
          light:   '#FEF9E7',
        },
        forestDark: '#3D2E05',
        sage:       '#E3B341',
        sageDark:   '#9E6C03',
        textMain:  '#111111',
        textMuted: '#6B7280',
        borderLight: '#E5E7EB', // Neutral clean border
      },
      fontFamily: {
        sans:      ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', '"Noto Sans"', 'Arial', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
        dmsans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', '"Noto Sans"', 'Arial', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
        'dm-sans': ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', '"Noto Sans"', 'Arial', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
        outfit: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', '"Noto Sans"', 'Arial', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
        brand: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', '"Noto Sans"', 'Arial', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
        headline: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', '"Noto Sans"', 'Arial', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
      },
      boxShadow: {
        soft:   '0 1px 3px rgba(0,0,0,0.05)',
        gold:   '0 4px 20px -2px rgba(202, 138, 4, 0.25)',
      },
      borderRadius: {
        'card': '12px',
        'btn': '10px',
        'input': '10px',
        'table': '12px',
      },
      animation: {
        'float': 'float 4s ease-in-out infinite',
        'floatDelay': 'float 4s ease-in-out 1.5s infinite',
        'slideUp': 'slideUp 0.6s ease forwards',
        'fadeIn': 'fadeIn 0.5s ease forwards',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(30px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
