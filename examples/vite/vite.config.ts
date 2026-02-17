import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "gboy-ts": resolve(__dirname, "../../src"),
    },
  },
  build: {
    target: "es2020",
  },
});
