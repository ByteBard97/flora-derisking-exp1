# ESLint Config — Konva Write-Only Discipline

## What it does

Enforces the Konva import boundary via `no-restricted-imports` with `overrides`:

- **All files**: importing `konva`, `konva/*`, or `vue-konva` is an ESLint error.
- **`src/canvas/projection/**`** and **`src/canvas/tools/**`**: allowed to import Konva.

This makes the write-only discipline structural (a CI gate) rather than cultural (a README note).

## Why `no-restricted-imports` instead of `eslint-plugin-boundaries`

`eslint-plugin-boundaries` restricts imports between your own modules. For restricting
a third-party library (`konva`) to specific directories, `no-restricted-imports` with
`overrides` is simpler, requires no additional dependency, and is transparently auditable.

## Usage in an experiment directory

```js
// .eslintrc.js (in experiment-1/, experiment-2/, etc.)
const konvaRule = require('../infrastructure/eslint-config');

module.exports = {
  extends: ['plugin:vue/vue3-recommended', '@vue/eslint-config-typescript'],
  ...konvaRule,
};
```

Or copy `index.js` directly into the experiment if you don't want a local path dependency.

## CI verification

The test file `src/__tests__/konva-boundary-violation.ts` imports `konva` from an unlisted
directory. Running `eslint src/__tests__/konva-boundary-violation.ts` must exit non-zero.
The CI job verifies this — if the rule is accidentally disabled, CI catches it.
