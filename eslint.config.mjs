import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));

const nodeGlobals = {
  Buffer: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  URL: 'readonly',
};

const mochaGlobals = {
  setup: 'readonly',
  suite: 'readonly',
  teardown: 'readonly',
  test: 'readonly',
};

const typeScriptFiles = ['src/**/*.ts'];
const typeScriptStrictConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({
  ...config,
  files: typeScriptFiles,
}));

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '.codex/**',
      '.cursor/**',
      'dist/**',
      'example/**',
      'out/**',
      'node_modules/**',
      '.vscode-test/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...typeScriptStrictConfigs,
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
      globals: {
        ...nodeGlobals,
        ...mochaGlobals,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'curly': ['error', 'all'],
      'eqeqeq': ['error', 'always'],
      'no-console': 'error',
      'no-undef': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'inline-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true, ignoreVoidOperator: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: false,
          allowRegExp: false,
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: 'Доменный слой не работает с файловой системой.' },
            { name: 'node:fs', message: 'Доменный слой не работает с файловой системой.' },
            { name: 'path', message: 'Доменный слой не вычисляет пути.' },
            { name: 'node:path', message: 'Доменный слой не вычисляет пути.' },
            { name: 'vscode', message: 'Доменный слой не зависит от VS Code API.' },
          ],
          patterns: [
            {
              group: ['src/cli/**', '**/cli/**'],
              message: 'Доменный слой не должен зависеть от CLI.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require']",
          message: 'Доменный слой не использует CommonJS require.',
        },
        {
          selector: "CallExpression[callee.property.name='readFileSync']",
          message: 'Доменный слой не читает файлы напрямую.',
        },
      ],
    },
  },
  {
    files: ['src/infra/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vscode', message: 'Инфраструктурный слой не зависит от VS Code API.' },
          ],
          patterns: [
            {
              group: ['src/cli/**', '**/cli/**'],
              message: 'Инфраструктурный слой не должен зависеть от CLI.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/test/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/cli/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['*.js', '*.mjs'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: nodeGlobals,
      sourceType: 'module',
    },
  },
  {
    files: ['*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
);
