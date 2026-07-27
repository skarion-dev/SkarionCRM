// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.wrangler/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      // Not a workspace package - plain browser-extension JS (chrome/window
      // globals, no build step) and a vendored xlsx library, not TS/Node.
      "extension/**",
      // Ad-hoc scratch scripts, not part of any workspace package.
      "scratch/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  }
);
