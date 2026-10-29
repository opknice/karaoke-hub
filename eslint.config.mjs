import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["scripts/**/*.cjs", "tests/**/*.cjs", "desktop/**/*.cjs"],
    rules: {
      // These files intentionally run in Node's CommonJS test/operator runtime.
      "@typescript-eslint/no-require-imports": "off",
      "@next/next/no-assign-module-variable": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "android/**/build/**",
    "android/app/src/main/assets/public/**",
    "desktop/dist/**",
    "desktop/audio/assets/**",
    "desktop/vocal/runtime/**",
    "desktop/test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
