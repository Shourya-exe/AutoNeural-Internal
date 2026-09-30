import type { Config } from "tailwindcss";

/**
 * AutoNeural CRM design tokens.
 *
 * Palette:
 *  - ivory      #FBF8F3  warm app background
 *  - surface    #FFFFFF  cards & panels
 *  - champagne  #E8D5B7  soft accent / borders / fills
 *  - gold       #C9A063  restrained decorative accent (never the only signal for state)
 *  - espresso   #16120E  primary text
 *  - emerald            positive states
 *  - red                errors & overdue
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // ── Warm white glass theme, maroon accent ─────────────────────────
        // Token NAMES are kept from the original theme so every page re-themes at once;
        // the VALUES describe a warm ivory ground with white frosted-glass surfaces:
        //   ivory      → translucent white (inputs, sunken fields)
        //   surface    → frosted white glass panel
        //   champagne  → warm maroon-tinted fills / hovers
        //   gold       → maroon accent: DEFAULT/600 fills, 700 = readable maroon text
        //   espresso   → text, dark on light (DEFAULT darkest → 300 lightest)
        //   wine       → the warm ivory ground scale (kept name; used by overlays)
        ivory: "rgba(255, 255, 255, 0.66)",
        surface: "rgba(255, 255, 255, 0.5)",
        wine: {
          950: "#FFFDFA",
          900: "#FBF6F0",
          800: "#F5EDE4",
          700: "#EEE0D6",
          600: "#E3CFC6",
          500: "#8C1C2B",
        },
        champagne: {
          DEFAULT: "rgba(124, 24, 40, 0.1)",
          50: "rgba(124, 24, 40, 0.04)",
          100: "rgba(124, 24, 40, 0.07)",
          200: "rgba(124, 24, 40, 0.12)",
          300: "rgba(124, 24, 40, 0.18)",
        },
        gold: {
          DEFAULT: "#8C1C2B",
          600: "#6E1020",
          700: "#8A1226",
        },
        espresso: {
          DEFAULT: "#24101A",
          700: "#46242D",
          500: "#7A5B62",
          300: "#A6888F",
        },
        emerald: {
          DEFAULT: "#0F7A52",
          50: "rgba(15, 122, 82, 0.1)",
          100: "rgba(15, 122, 82, 0.25)",
          500: "#129463",
          600: "#0B6042",
          700: "#094D35",
        },
        danger: {
          DEFAULT: "#C0392B",
          50: "rgba(192, 57, 43, 0.09)",
          100: "rgba(192, 57, 43, 0.25)",
          600: "#9E2C20",
        },
        // shadcn-style semantic aliases (mapped to CSS variables in globals.css)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 16px 40px -22px rgba(72, 20, 30, 0.35)",
        pop: "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 26px 60px -20px rgba(72, 20, 30, 0.4)",
        glow: "0 0 0 1px rgba(140, 28, 43, 0.3), 0 12px 32px -10px rgba(140, 28, 43, 0.4)",
      },
      fontFamily: {
        sans: ["Jost", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        serif: ["'Cormorant Garamond'", "Georgia", "serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(14px) scale(0.985)", filter: "blur(6px)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)", filter: "blur(0)" },
        },
        "page-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "sheen": {
          from: { transform: "translateX(-120%) skewX(-20deg)" },
          to: { transform: "translateX(220%) skewX(-20deg)" },
        },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "rise-in": "rise-in 700ms cubic-bezier(0.22, 1, 0.36, 1) backwards",
        "page-in": "page-in 520ms cubic-bezier(0.22, 1, 0.36, 1) backwards",
        "sheen": "sheen 1.1s cubic-bezier(0.4, 0, 0.2, 1)",
        "spin-slow": "spin-slow 8s linear infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
