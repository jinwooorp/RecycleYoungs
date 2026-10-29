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
      // 화면에서 임의 색상 대신 디자인 토큰을 사용하도록 검사합니다.
      'shadcn/no-raw-colors': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    // 기본 UI 컴포넌트는 자체 스타일을 갖되 기존 ESLint 검사는 계속 적용합니다.
    ignores: ['src/components/ui/**'],
    rules: {
      // 사용 화면에서는 배치만 조절하고 기본 UI 컴포넌트의 시각적 스타일은 유지합니다.
      'shadcn/no-restyle': ['error', { allow: ['layout'] }],
    },
  },
  {
    files: ['*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
