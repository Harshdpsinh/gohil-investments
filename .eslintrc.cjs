/* ESLint 8 flat-config is opt-in; this project uses the classic .eslintrc format. */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: 'detect' } },
  ignorePatterns: ['dist', 'android', 'node_modules', 'evolution-api', 'openwa'],
  overrides: [
    {
      // react-three-fiber renders three.js objects as JSX. Their props are not
      // DOM attributes, so this rule flags every one of them. Scoped to the 3D
      // directory only — real DOM typos elsewhere must still error.
      files: ['src/three/**/*.jsx'],
      rules: { 'react/no-unknown-property': 'off' },
    },
  ],
  rules: {
    // The codebase does not use PropTypes; it is a private app with no public component API.
    'react/prop-types': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
}
