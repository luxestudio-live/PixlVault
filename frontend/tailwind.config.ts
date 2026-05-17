import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f5f7fa',
          100: '#e8edf4',
          200: '#c9d3e0',
          300: '#a7b5c9',
          400: '#8090a7',
          500: '#5b6a82',
          600: '#425066',
          700: '#2d3a4b',
          800: '#1a2230',
          900: '#0d1118',
        },
        accent: {
          50: '#e8fff7',
          100: '#bbf7e8',
          200: '#84ecca',
          300: '#4bd9ac',
          400: '#1ebd8f',
          500: '#0f9f78',
          600: '#0c7f61',
          700: '#0d644e',
          800: '#0c4d3d',
          900: '#08362b',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(75, 217, 172, 0.22), 0 20px 80px rgba(3, 8, 18, 0.45)',
      },
      backgroundImage: {
        'mesh-gradient': 'radial-gradient(circle at top left, rgba(75,217,172,0.18), transparent 34%), radial-gradient(circle at top right, rgba(126, 96, 255, 0.14), transparent 28%), linear-gradient(180deg, rgba(8, 12, 20, 0.92), rgba(8, 12, 20, 1))',
      },
    },
  },
  plugins: [],
};

export default config;
