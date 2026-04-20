/**
 * Canonical ESLint config for the Konva write-only discipline.
 *
 * Rule: only src/canvas/projection/** and src/canvas/tools/** may import
 * from 'konva' or 'vue-konva'. All other files: error.
 *
 * Copy this file (or extend it) in each experiment's .eslintrc.js.
 * Copy to production Flora repo unchanged.
 */

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'konva',
            message:
              'Konva imports are only allowed in src/canvas/projection/** and src/canvas/tools/**.',
          },
          {
            name: 'vue-konva',
            message:
              'vue-konva imports are only allowed in src/canvas/projection/** and src/canvas/tools/**.',
          },
        ],
        patterns: [
          {
            group: ['konva/*'],
            message:
              'Konva sub-imports are only allowed in src/canvas/projection/** and src/canvas/tools/**.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // The two allowlisted directories may import Konva freely.
      files: [
        'src/canvas/projection/**/*.{ts,vue}',
        'src/canvas/tools/**/*.{ts,vue}',
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
    {
      // Deliberate violation test file — used by CI to verify the rule fires.
      files: ['src/__tests__/konva-boundary-violation.ts'],
      rules: {
        // Rule intentionally NOT turned off — this file must fail lint.
      },
    },
  ],
};
