/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0B1F3A",
        slate: "#1E3A5F",
        gold: "#C9A227",
        rural: "#3F5D42",
      },
      fontFamily: {
        serif: ["'Source Serif Pro'", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
