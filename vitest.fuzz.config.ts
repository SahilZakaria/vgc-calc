import { defineConfig } from 'vitest/config';
import { FUZZ_TEST } from './vitest.config';

// Used by `npm run test:fuzz`: runs only the fuzz test excluded from `npm test`.
export default defineConfig({
  test: {
    include: [FUZZ_TEST],
  },
});
