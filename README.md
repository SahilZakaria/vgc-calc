# VGC Calc

A Pokémon damage calculator for **Pokémon Champions** and **Pokémon Scarlet/Violet** (Gen 9). It focuses on doubles (VGC) and also handles singles.

- **Champions mode:** fixed level 50, and Stat Points (66 total, max 32 per stat) in place of EVs and IVs.
- **Scarlet/Violet mode:** levels, IVs, EVs and Terastallization.

## Verification

The damage engine is checked against [`@smogon/calc`](https://github.com/smogon/damage-calc) with a randomized differential test: 4,000 generated cases (2,000 per game), each compared on all 16 damage rolls. With the default seed, 3,995 cases match. The other 5 are a known `@smogon/calc` bug (Body Press under Wonder Room swaps Defense twice) and are listed as expected disagreements in `src/oracle/fuzz.test.ts`.

## Layout

- `src/calc`: damage engine shared by both games
- `src/champions`: Champions stat rules
- `src/oracle`: `@smogon/calc` adapter and the differential test
- `ui/`: React + Vite front end, which imports the engine from `src/`

## Development

```sh
npm install && npm install --prefix ui
npm test            # unit tests
npm run test:fuzz   # differential test against @smogon/calc
npm run ui:dev      # local UI
npm run ui:build    # static build to ui/dist
```

The UI deploys to Vercel as a static site. See `vercel.json`.
