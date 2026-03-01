// eslint.config.js — ESLint 9+ flat config format
const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'node_modules/',
      'coverage/',
      'dist/',
      '.git/',
      'migrations/run-migration.js', // ES6 module
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals (v18+)
        __dirname: 'readonly',
        __filename: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        clearImmediate: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        global: 'readonly',
        process: 'readonly',
        setImmediate: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off', // Backend needs console for logging
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-control-regex': 'warn', // Reduce to warn for now (regex with control chars)
      'no-useless-assignment': 'warn', // Some tests use this intentionally
      'no-useless-escape': 'warn', // Minor issue, reduce to warn
      'no-invalid-regexp': 'warn', // Some tests have invalid regexes
    },
  },
];
