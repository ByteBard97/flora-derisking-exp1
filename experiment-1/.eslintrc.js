// Extends the canonical Konva boundary rule from infrastructure.
const konvaRule = require('../infrastructure/eslint-config');

module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'plugin:vue/vue3-recommended',
    '@vue/eslint-config-typescript',
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    ...konvaRule.rules,
  },
  overrides: [
    ...(konvaRule.overrides || []),
  ],
};
