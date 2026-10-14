// Flat ESLint config shared by every JS/TS package in the monorepo.
// Each package runs `eslint .` and picks this config up automatically.
//
// @ts-check
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      // Python service: not linted by ESLint.
      'packages/ocr-service/**',
      // Generated native projects.
      'packages/frontend/android/**',
      'packages/frontend/ios/**',
    ],
  },

  // TypeScript (non type-aware: fast, no project graph needed).
  // TODO: switch to `tseslint.configs.recommendedTypeChecked` once the packages
  // are stable, and enable `languageOptions.parserOptions.projectService`.
  tseslint.configs.recommended,

  // Vue SFC support.
  ...pluginVue.configs['flat/recommended'],

  {
    // Let ESLint parse <script lang="ts"> inside .vue files.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
  },

  // Environment globals per package.
  {
    files: ['packages/frontend/**/*.{ts,vue}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/backend/**/*.ts', 'packages/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['*.config.{js,mjs,cjs,ts}', '**/*.config.{js,mjs,cjs,ts}', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Project-wide rule tweaks.
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
    },
  },

  {
    files: ['packages/frontend/**/*.vue'],
    rules: {
      // Ionic's controls are web components, so `slot="start"` is the native
      // slot attribute — not Vue 2's deprecated named-slot syntax this rule
      // targets. Ionic Vue requires it (see ion-buttons/ion-toolbar usage).
      'vue/no-deprecated-slot-attribute': 'off',
    },
  },

  // Must stay last: turns off rules that conflict with Prettier.
  eslintConfigPrettier,
);
