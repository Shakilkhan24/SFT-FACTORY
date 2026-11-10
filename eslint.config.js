import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'build/extract/**',
      'visualizer/**',
      'software-factory-pack/**',
      'checklists/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The CLI entry points are tools: printing to the console IS their job,
    // and `process.exit` is how they report a verdict.
    files: [
      'tools/scope-guard.ts',
      'tools/oracle-guard.ts',
      'tools/context-bundle',
      'tools/export-schemas.ts',
      'tools/extract-pack-ddl.ts',
      'apps/cli/src/index.ts',
    ],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
    },
  },
  {
    // Node scripts that are not part of any tsconfig project.
    files: ['tools/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // **A0.2 — the lint half.** Adapters are constructible only inside the
    // broker module.
    //
    // blueprint 11 §1: "without a registry and a broker, an agent reaches a
    // tool directly and nothing checks whether it may." The runtime guard
    // in `packages/broker/src/adapters/factory.ts` makes a direct call
    // *fail*; this rule makes the direct *import* visible in review.
    //
    // The rule is deliberately narrow about **who** may import an adapter:
    // `adapters/factory.ts` constructs them and `broker.ts` reaches them
    // through the factory. Every other path — a test helper, an app, a
    // stray module — is refused.
    //
    // The pattern bans the adapter modules; the exceptions re-admit them
    // for exactly two files.
    files: ['**/*.ts'],
    ignores: [
      'packages/broker/src/adapters/factory.ts',
      'packages/broker/src/broker.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/packages/broker/src/adapters/**',
                'packages/broker/src/adapters/**',
              ],
              message:
                'Adapters may only be constructed inside the broker module. Import @factory/broker, or the adapter factory at packages/broker/src/adapters/factory.ts.',
            },
          ],
        },
      ],
    },
  },
);
