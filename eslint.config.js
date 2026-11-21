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
    // 浏览器侧代码不得触碰 Node API（tsconfig 合并后靠这条守住）。
    files: ["src/**/*.ts"],
    ignores: ["src/tools/**", "src/tests/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["node:*"] }],
      "no-restricted-globals": ["error", "process", "Buffer", "__dirname", "require", "global"],
    },
  },
  {
    files: ["*.config.ts", "*.config.js", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["electron/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    files: ["electron/**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      // 沙箱 preload 必须是 CommonJS，只能 require("electron")。
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
