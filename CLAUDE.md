# VGC Calculator

## Architecture rules
- src/calc must never import from src/tournaments. The dependency runs one way only.
- src/calc must never make network calls or read from disk at runtime.
- src/types.ts is the shared contract. Do NOT edit it. If you need a type it
  doesn't have, declare it in your own module and mention it in your final report.

## Code rules
- TypeScript, strict mode. No `any`.
- Every module ships with a colocated `.test.ts` file using vitest.
- Tests assert against known-correct values, not against your own implementation's
  output. If you cannot find a real reference value, say so rather than inventing one.
- Only touch the files named in your task. Do not refactor neighboring modules.

## Verification
- `npm test` must pass before you report done.