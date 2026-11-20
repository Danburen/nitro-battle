import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "dist/**",
      "release/**",
      "node_modules/**",
      ".ai/**",
      "lint-report.json",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
  },
  {
    files: ["src/tests/**/*.ts", "src/tools/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["*.config.ts", "*.config.js", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
