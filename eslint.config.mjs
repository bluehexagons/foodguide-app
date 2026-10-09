import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['app/**', 'node_modules/**', 'out/**', '.generated/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: globals.node },
    rules: { curly: 'error', eqeqeq: 'error', 'prefer-const': 'error' },
  },
];
