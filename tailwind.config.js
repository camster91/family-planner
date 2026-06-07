/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Apple system colors (light/dark aware via CSS vars)
        surface: {
          base: "var(--surface-base)",
          elevated: "var(--surface-elevated)",
          grouped: "var(--surface-grouped)",
          "grouped-secondary": "var(--surface-grouped-secondary)",
          fill: "var(--surface-fill)",
          "fill-secondary": "var(--surface-fill-secondary)",
        },
        separator: "var(--surface-separator)",
        label: {
          primary: "var(--label-primary)",
          secondary: "var(--label-secondary)",
          tertiary: "var(--label-tertiary)",
          inverse: "var(--label-inverse)",
        },
        accent: {
          // --accent-text for text/link use (4.5:1 on light + dark surfaces)
          // --accent-fill for button bg with white text (4.7:1 in both modes)
          // The CSS --accent var aliases --accent-text for backwards compat
          // but Tailwind's `bg-accent` defaults to --accent-fill so the
          // common `bg-accent text-white` button pattern works.
          DEFAULT: "var(--accent-fill)",
          text: "var(--accent-text)",
          fill: "var(--accent-fill)",
          "fill-hover": "var(--accent-fill-hover)",
          "fill-pressed": "var(--accent-fill-pressed)",
          tint: "var(--accent-tint)",
          "tint-strong": "var(--accent-tint-strong)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        // Family planner tints (used as glyph backgrounds)
        chore: "var(--tint-chore)",
        "tint-calendar": "var(--tint-calendar)",
        "tint-lists": "var(--tint-lists)",
        "tint-budget": "var(--tint-budget)",
        "tint-messages": "var(--tint-messages)",
        "tint-family": "var(--tint-family)",
        "tint-rewards": "var(--tint-rewards)",
        "tint-projects": "var(--tint-projects)",
        "tint-meals": "var(--tint-meals)",
        // Backwards-compat (existing components still reference these)
        border: "var(--surface-separator)",
        input: "var(--surface-separator)",
        ring: "var(--accent-text)",
        background: "var(--surface-grouped)",
        foreground: "var(--label-primary)",
        primary: {
          DEFAULT: "var(--accent-text)",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "var(--surface-fill)",
          foreground: "var(--label-primary)",
        },
        muted: {
          DEFAULT: "var(--surface-fill)",
          foreground: "var(--label-secondary)",
        },
        card: {
          DEFAULT: "var(--surface-elevated)",
          foreground: "var(--label-primary)",
        },
        popover: {
          DEFAULT: "var(--surface-elevated)",
          foreground: "var(--label-primary)",
        },
      },
      borderRadius: {
        none: "0",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        focus: "var(--shadow-focus)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.32, 0.72, 0, 1)",
        emphasis: "cubic-bezier(0.5, 1.2, 0.4, 1)",
        "ease-out": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      transitionDuration: {
        "120": "120ms",
        "200": "200ms",
        "280": "280ms",
        "420": "420ms",
      },
      keyframes: {
        "spring-in": {
          "0%": { opacity: "0", transform: "scale(0.92) translateY(8px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "spring-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "check-pop": {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "60%": { transform: "scale(1.15)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "soft-pulse": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "spring-in": "spring-in 360ms cubic-bezier(0.5, 1.2, 0.4, 1) both",
        "spring-up": "spring-up 320ms cubic-bezier(0.32, 0.72, 0, 1) both",
        "check-pop": "check-pop 360ms cubic-bezier(0.5, 1.2, 0.4, 1) both",
        "soft-pulse": "soft-pulse 2s ease-in-out infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
