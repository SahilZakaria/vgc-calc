import { defineConfig } from 'vitest/config';

// The randomized differential run against @smogon/calc is most of the suite's
// runtime, so it is left out of `npm test` and run by `npm run test:fuzz`
// (vitest.fuzz.config.ts).
export const FUZZ_TEST = 'src/oracle/fuzz.test.ts';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', FUZZ_TEST],
  },
});
