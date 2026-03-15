import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1f2937',
        paper: '#fffaf2',
        coral: '#ff7a59',
        gold: '#f4b942'
      },
      boxShadow: {
        panel: '0 20px 60px rgba(31, 41, 55, 0.12)'
      }
    }
  },
  plugins: []
} satisfies Config;
