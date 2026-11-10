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
    // **INV-9 — the lint half.** A provider adapter may only be reached
    // through the gateway's provider factory.
    //
    // blueprint 11 §9.4: "**All provider-specific behaviour is confined
    // to the adapter** — NFR-09's acceptance criterion is exactly that."
    //
    // INV-9: "lint proves no provider SDK/type imported outside
    // `gateway/providers/*` and no model-id string outside config."
    //
    // So the adapter modules are importable only by the factory (which
    // constructs them) and by the gateway itself (which is handed
    // already-constructed adapters). Every other path — a test helper,
    // an app, a stray module — is refused.
    //
    // The runtime guard in `packages/gateway/src/providers/factory.ts`
    // makes a direct call *fail*; this rule makes the direct *import*
    // visible in review.
    files: ['**/*.ts'],
    ignores: [
      'packages/gateway/src/providers/**',
      'packages/gateway/src/gateway.ts',
      // The package's own barrel re-exports the factory's constructors,
      // so a consumer can build an adapter without reaching into
      // `providers/`. The barrel is the *public* path; the rule exists
      // to stop a consumer reaching the *private* one.
      'packages/gateway/src/index.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/packages/gateway/src/providers/**',
                'packages/gateway/src/providers/**',
              ],
              message:
                'Provider adapters may only be reached through the gateway. Import @factory/gateway, or the adapter factory at packages/gateway/src/providers/factory.ts.',
            },
          ],
        },
      ],
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
