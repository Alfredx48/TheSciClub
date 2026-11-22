// ESLint 9 flat config. Type-aware rules only — Biome owns formatting and
// fast correctness lint (see biome.json). Do not add stylistic or
// non-type-aware rules here; that's Biome's job.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-native',
      'dist-admin',
      'ios',
      'android',
      'coverage',
      'node_modules',
      'public',
      'map-tiles-out',
      'src/components/ui/**',
      '.claude/worktrees/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Biome already flags unused vars/formatting; keep only rules that need
      // full type information (Biome cannot check these without a type checker).
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    files: ['**/*.config.{ts,js}', 'src/test/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
