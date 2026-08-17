import eslint from '@eslint/js';
import globals from 'globals';

const sharedRules = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-control-regex': 'off',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  eqeqeq: ['error', 'always'],
};

export default [
  {
    ignores: [
      'app/vendor/**',
      'node_modules/**',
      'src-tauri/gen/**',
      'src-tauri/target/**',
      'test-results/**',
      'release-artifacts/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['app/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2025 },
    },
    rules: sharedRules,
  },
  {
    files: [
      'scripts/**/*.js',
      'scripts/**/*.mjs',
      'tests/**/*.js',
      'tests/**/*.mjs',
      'tests/**/*.cjs',
      '*.config.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.es2025 },
    },
    rules: {
      ...sharedRules,
      'no-console': 'off',
    },
  },
];
