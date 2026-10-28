import js from '@eslint/js';
import { plugin as shadcn } from '@shadcn/lint';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { shadcn },
    rules: {
      'shadcn/no-raw-colors': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    // UI primitives own their styles; existing ESLint rules still check them.
    ignores: ['src/components/ui/**'],
    rules: {
      'shadcn/no-restyle': ['error', { allow: ['layout'] }],
    },
  },
  {
    files: ['*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
