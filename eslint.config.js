import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const deepFeatureImport = {
  group: ['@/features/*/*'],
  message: 'Import another feature only through its index: @/features/<name>.',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': ['error', { patterns: [deepFeatureImport] }],
    },
  },
  {
    // Same boundaries as Space: domain is plain TypeScript, testable without React.
    files: ['src/features/*/domain/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'react', message: 'domain/ must not depend on React.' }],
          patterns: [
            deepFeatureImport,
            { group: ['@/features/*'], message: 'domain/ must not import other features.' },
            {
              group: ['../*'],
              message: 'domain/ must not reach into api/, hooks/ or components/.',
            },
          ],
        },
      ],
    },
  },
  {
    // shared/ is domain-agnostic: it never knows about features.
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/features/*'], message: 'shared/ must not import features.' }] },
      ],
    },
  },
);
