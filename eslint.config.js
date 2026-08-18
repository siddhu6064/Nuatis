import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/mobile/**',
      '.claude/**',
    ],
  },
  {
    files: ['**/postcss.config.js', '**/tailwind.config.js'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
      },
    },
    rules: {
      // Tailwind v3's config loader is plain CJS (require()), not run through
      // a TS/ESM transpiler — see apps/web/src/theme/tokens.js.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Shared design tokens: plain CJS so tailwind.config.js above can
    // require() it without a build step. See its own file header.
    files: ['**/theme/tokens.js'],
    languageOptions: {
      globals: {
        module: 'writable',
      },
    },
  },
  {
    // API webchat widget — browser-only vanilla JS
    files: ['apps/api/src/webchat-widget/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        navigator: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-empty': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Embeddable chat widget — runs in customer browsers, uses browser globals
    files: ['apps/web/public/widget/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        navigator: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-empty': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
)
