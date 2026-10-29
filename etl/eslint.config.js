import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // 빌드 결과와 커버리지 보고서는 원본 TypeScript 검사 대상에서 제외합니다.
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
];
