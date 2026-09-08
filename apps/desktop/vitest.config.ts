import { defineConfig } from 'vitest/config';

// 셸의 순수 규칙(`src/shell.ts`)만 검증한다 — main/preload는 Electron 런타임이
// 있어야 도는 코드라 여기서 돌리지 않는다(판단은 전부 shell.ts로 빼 뒀다).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
