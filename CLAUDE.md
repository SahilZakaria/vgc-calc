# VGC Calculator

## What this is
A damage calculator targeting Pokémon Champions primarily, with a Gen 9
(Scarlet/Violet) mode alongside it. Doubles/VGC is the priority; singles is
the same engine with isDoubles false and no allies.

## Architecture rules
- src/calc holds shared battle math used by both games.
- src/champions and src/gen9 hold game-specific logic and data.
- src/calc must never import from src/champions, src/gen9, or src/tournaments.
  Dependencies run one way, toward src/calc.
- src/calc must never make network calls or read from disk at runtime.
- src/types.ts is the shared contract. Do NOT edit it. If you need a type it
  doesn't have, declare it in your own module and say so in your final report.

## Champions domain facts
These differ from Gen 9 and are easy to get wrong. Assume Gen 9 behavior
ONLY where this section says the two match.

- Level is ALWAYS 50 in Champions. It is not shown or chosen.
- IVs do not exist. Every Pokemon is treated as 31 in every stat.
- EVs are replaced by Stat Points (SP): 66 total, maximum 32 per stat.
  One SP adds exactly +1 to the level 50 stat.
- SP maps to EVs as: spToEv(0) = 0, spToEv(n) = 8n - 4. So 32 SP = 252 EVs.
  Champions allows 66 SP, one more total point than 510 EVs permits.
- Natures still exist with the same 1.1 and 0.9 multipliers.
- Terastallization is NOT in Champions. Mega Evolution is the gimmick,
  one per battle. Keep Tera logic for Gen 9 mode; it stays inert in Champions.
- The damage formula is the SAME as Gen 9, including 16 rolls from 85% to
  100%. A launch bug removed the 85% roll; it was fixed in April 2026.
  Keep the roll floor as a named constant so it can be changed.
- SHARED with Gen 9: type chart, STAB, critical hits, spread reduction,
  screens, weather, terrain, burn, stat stages, modifier order, and
  4096-based rounding.
- DIFFERENT from Gen 9: the stat input model, the gimmick, and all data
  tables (move power, move flags, learnsets, items, roster).

## Code rules
- TypeScript, strict mode. No `any`.
- Every module ships with a colocated `.test.ts` file using vitest.
- Tests assert against known-correct values from an external reference, not
  against your own implementation's output. If you cannot find a real
  reference value, say so rather than inventing one.
- Only touch the files named in your task. Do not refactor neighboring modules.

## Verification
- `npm test` and `npx tsc --noEmit` must both pass before you report done.
- Report honestly. If something is unverified or you guessed, say so.