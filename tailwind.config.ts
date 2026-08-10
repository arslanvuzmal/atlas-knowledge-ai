import type { Config } from 'tailwindcss';

/**
 * Atlas design system tokens matching the precise design DNA of arslanvuzmallone.com:
 *
 * - Dark, academic, research-desk aesthetic
 * - Deep dark background (#08090B) with structured surfaces (#0D0F12, #111419, #15191E)
 * - Ultra-clean borders (rgba(255,255,255,0.075) & rgba(255,255,255,0.13))
 * - Restrained cold steel blue (#7799D8) and desaturated teal evidence accent (#73B5AF)
 * - Precision radii (4px, 6px, 8px, 10px, max 12px) - zero exaggerated bubbles
 */

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: '#08090B',
          raised: '#0D0F12',
          sunken: '#111419',
          overlay: '#15191E',
          hover: 'rgba(255, 255, 255, 0.03)',
        },
        edge: {
          DEFAULT: 'rgba(255, 255, 255, 0.075)',
          strong: 'rgba(255, 255, 255, 0.13)',
          subtle: 'rgba(255, 255, 255, 0.04)',
        },
        ink: {
          DEFAULT: '#F5F6F7',
          muted: '#A6ADB7',
          faint: '#747D89',
          inverse: '#08090B',
        },
        // Restrained steel blue brand accent
        accent: {
          DEFAULT: '#7799D8',
          soft: '#A3BDF0',
          deep: '#4A69A8',
          wash: 'rgba(119, 153, 216, 0.12)',
          line: 'rgba(119, 153, 216, 0.25)',
        },
        // Evidence desaturated teal accent
        teal: {
          DEFAULT: '#73B5AF',
          soft: '#A1D6D1',
          deep: '#4C8782',
          wash: 'rgba(115, 181, 175, 0.12)',
          line: 'rgba(115, 181, 175, 0.25)',
        },
        rust: {
          DEFAULT: '#D06A4A',
          wash: 'rgba(208, 106, 74, 0.12)',
        },
        amber: {
          DEFAULT: '#D8A84E',
          wash: 'rgba(216, 168, 78, 0.12)',
        },
        olive: {
          DEFAULT: '#7E8B68',
          wash: 'rgba(126, 139, 104, 0.12)',
        },
        indigo: {
          DEFAULT: '#7277A8',
          wash: 'rgba(114, 119, 168, 0.12)',
        },
        iris: {
          DEFAULT: '#7277A8',
          soft: '#A3A7D6',
          deep: '#484C7A',
          wash: 'rgba(114, 119, 168, 0.12)',
        },
        series: {
          1: '#7799D8',
          2: '#73B5AF',
          3: '#7E8B68',
        },
        status: {
          good: '#7E8B68',
          warning: '#D8A84E',
          critical: '#D06A4A',
          info: '#7799D8',
          neutral: '#747D89',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        panel: '8px',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.4), 0 8px 16px -12px rgba(0,0,0,0.6)',
        lift: '0 12px 32px -16px rgba(0,0,0,0.8)',
        focus: '0 0 0 2px #08090B, 0 0 0 4px #7799D8',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'fade-up': 'fade-up 180ms ease-out both',
        'pulse-soft': 'pulse-soft 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
