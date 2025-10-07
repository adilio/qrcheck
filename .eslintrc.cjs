module.exports = {
  root: true,
  extends: ['eslint:recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
  env: { browser: true, es2021: true, node: true },
  overrides: [
    {
      files: ['tests/**/*.{ts,js}'],
      globals: {
        expect: 'readonly',
        test: 'readonly'
      }
    }
  ]
};
