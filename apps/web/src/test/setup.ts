import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 이전 테스트가 만든 DOM을 제거해 다음 테스트의 요소 조회에 영향을 주지 않게 합니다.
afterEach(cleanup);
