import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "app",
  build: {
    outDir: "../dist/app",
    emptyOutDir: true,
  },
});
