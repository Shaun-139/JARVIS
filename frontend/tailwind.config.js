/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // J.A.R.V.I.S. / Stark Expo HUD palette
        space: {
          DEFAULT: '#020813',
          900: '#020813',
          800: '#04101f',
          700: '#071a30',
        },
        arc: {
          cyan: '#00F0FF',
          blue: '#0077FF',
          dim: '#0a3f52',
        },
      },
      fontFamily: {
        hud: ['"Rajdhani"', '"Chakra Petch"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        hud: '0 0 15px rgba(0,240,255,0.15)',
        'hud-strong': '0 0 28px rgba(0,240,255,0.35)',
        'hud-inset': 'inset 0 0 20px rgba(0,119,255,0.12)',
      },
      dropShadow: {
        glow: '0 0 6px rgba(0,240,255,0.65)',
        'glow-strong': '0 0 14px rgba(0,240,255,0.9)',
      },
      backgroundImage: {
        'hud-grid':
          'linear-gradient(rgba(0,240,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.045) 1px, transparent 1px)',
        'hud-radial':
          'radial-gradient(ellipse at 50% 45%, rgba(0,119,255,0.18), rgba(2,8,19,0) 60%)',
      },
    },
  },
  plugins: [],
};
