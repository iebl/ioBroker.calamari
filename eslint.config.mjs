import globals from "globals";
import { defineConfig } from "eslint/config";


export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    ignores: [
      ".prettierrc.js",
      "**/.eslintrc.js",
      "admin/words.js",
      "node_modules/**"
    ]
  },
]);
