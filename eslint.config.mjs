import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // dc prototype (design reference, do not lint) + build artifacts
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'vendor/**',
      'support.js',
      '*.dc.html',
      'tools/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // ── Core purity guard ──────────────────────────────────────────────
    // packages/mindmap-core must stay framework-agnostic: no DOM, React,
    // storage, or network. Violations fail CI (ADR-0001 §2).
    files: ['packages/mindmap-core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'mindmap-core must stay framework-agnostic (no React).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'mindmap-core must not touch the DOM.' },
        { name: 'document', message: 'mindmap-core must not touch the DOM.' },
        { name: 'localStorage', message: 'mindmap-core must not touch storage.' },
        { name: 'sessionStorage', message: 'mindmap-core must not touch storage.' },
        { name: 'fetch', message: 'mindmap-core must not do network I/O.' },
      ],
    },
  },
  {
    // Test files may use dev globals freely.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
);
