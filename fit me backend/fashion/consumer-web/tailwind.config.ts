import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { fitmeBg: "#1A1208", fitmeCard: "#2A2018", fitmeBorder: "#3A3028", fitmeGold: "#C9974A", fitmeRed: "#A0392B" },
      fontFamily: { serif: ["Playfair Display", "Georgia", "serif"] }
    }
  },
  plugins: []
};
export default config;

