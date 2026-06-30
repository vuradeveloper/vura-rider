/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#fbf7f5",
        foreground: "#2e1e1a",
        surface: "#ffffff",
        card: "#ffffff",
        "card-foreground": "#2e1e1a",
        popover: "#ffffff",
        "popover-foreground": "#2e1e1a",
        primary: "#e04e2f",
        "primary-foreground": "#fcfcfc",
        "primary-glow": "#e8654a",
        secondary: "#f5f0ed",
        "secondary-foreground": "#33211c",
        muted: "#f5f0ed",
        "muted-foreground": "#80716b",
        accent: "#f2e2dc",
        "accent-foreground": "#4d2619",
        destructive: "#cc3314",
        "destructive-foreground": "#fcfcfc",
        success: "#16a34a",
        "success-foreground": "#fcfcfc",
        border: "#ebe3de",
        input: "#f0e9e5",
        ring: "#e04e2f",
      },
      fontFamily: {
        display: ["System", "sans-serif"],
        sans: ["System", "sans-serif"],
      },
    },
  },
  plugins: [],
};
