import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// globals=false 时 @testing-library/react 不会自动注册 cleanup,手动补上,
// 否则前一个测试渲染的 DOM 残留,会让 screen.queryByText 命中旧元素。
afterEach(() => {
  cleanup();
});
