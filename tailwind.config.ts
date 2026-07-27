import type { Config } from 'tailwindcss';

/**
 * Atlas design tokens.
 *
 * The chart-facing colours are not chosen by eye. `series.*`, `status.*`, and
 * the `scale.*` ramp were generated in OKLCH and verified with a colour
 * validator against the #171923 chart surface. All five checks pass on the
 * three-slot categorical set: lightness band (L 0.48-0.67), chroma floor,
 * colour-vision-deficiency separation (worst adjacent deutan dE 17.4, well
 * above the 8.0 floor), normal-vision separation, and 3:1 contrast.
 *
 * The product commits to a single dark appearance rather than shipping an
 * unvalidated light theme. See docs/DESIGN_SYSTEM.md.
 */

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: '#12141c',
          raised: '#171923',
          sunken: '#0d0f16',
          overlay: '#1c1f2b',
          hover: '#20243173',
        },
        edge: {
          DEFAULT: '#242836',
          strong: '#333a4d',
          subtle: '#1d2130',
        },
        ink: {
          DEFAULT: '#e6e9f2',
          muted: '#a8b0c8',
          faint: '#7d879f',
          inverse: '#0d0f16',
        },
        // Brand accent. Doubles as chart series 1.
        accent: {
          DEFAULT: '#00a3c3',
          soft: '#57c8e6',
          deep: '#00647a',
          wash: 'rgba(0, 163, 195, 0.14)',
          line: 'rgba(0, 163, 195, 0.32)',
        },
        iris: {
          DEFAULT: '#5a58c2',
          soft: '#9391dd',
          deep: '#3b3a86',
          wash: 'rgba(90, 88, 194, 0.16)',
        },
        // Validated categorical order. Never cycle past slot 3: fold into
        // "Other" or use small multiples instead.
        series: {
          1: '#00a3c3',
          2: '#5a58c2',
          3: '#429c5a',
        },
        // Reserved for state. Never reused as a chart series colour, and always
        // paired with an icon or text label so state is never colour-alone.
        status: {
          good: '#4fa866',
          warning: '#bd871c',
          critical: '#cd5f5f',
          info: '#00a3c3',
          neutral: '#7d879f',
        },
        // Single-hue sequential ramp for magnitude, light to dark.
        scale: {
          1: '#57c8e6',
          2: '#38afcc',
          3: '#0995b2',
          4: '#007d99',
          5: '#006580',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        panel: '14px',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -14px rgba(0,0,0,0.7)',
        lift: '0 14px 44px -18px rgba(0,0,0,0.8)',
        focus: '0 0 0 2px #12141c, 0 0 0 4px #00a3c3',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
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
