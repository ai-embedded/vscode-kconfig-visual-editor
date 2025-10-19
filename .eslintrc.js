module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  env: {
    node: true,
    es6: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
  ],
  rules: {
    'no-unused-vars': ['warn', {
      'argsIgnorePattern': '^_',
      'varsIgnorePattern': '^_',
      'ignoreRestSiblings': true
    }],
    'no-console': 'off', // 允许 console 语句
    'no-debugger': 'warn',
    'no-unreachable': 'warn',
    'no-undef': 'off', // TypeScript 会处理这个
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '*.js',
    'webpack.config.js',
    'out/',
  ],
};