import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Base JS rules
  js.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],

    plugins: {
      prettier: prettierPlugin,
    },

    languageOptions: {
      parser: tseslint.parser,

      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },

      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },

    rules: {
      // Disable conflicting rules with prettier
      ...prettierConfig.rules,

      // Your custom rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],

      "no-console": "warn",

      // Prettier rule
      "prettier/prettier": "error",
    },
  },

  // Ignore files
  {
    ignores: ["node_modules", "dist", ".vscode", "*.config.js", "*.config.ts"],
  }
);