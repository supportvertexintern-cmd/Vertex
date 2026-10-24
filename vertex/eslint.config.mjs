import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The files eslint-config-next defines its plugins for. Without this the
    // block also reaches files they don't cover (e.g. .cjs), and ESLint stops
    // with 'could not find plugin "react-hooks"'.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // Destructuring a field out to drop it (`const { case: _case, ...rest }`)
      // and `_`-prefixed placeholders are deliberate, not dead code.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // React Compiler rules (eslint-plugin-react-hooks 7, with Next 16):
      // the code predates them (~80 findings, 2026-10-20). Each fix changes
      // how a component's state works, so they are fixed one component per
      // pull request rather than all at once; warnings until then.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
