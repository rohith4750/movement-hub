// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  /**
   * Data-layer convention (see src/lib/query-keys.ts and src/lib/refresh.ts):
   * - query keys come from `qk`, never inline arrays, so screens share one cache entry;
   * - writes go through `useAction`, which refreshes the right groups after a save.
   * The lib files that implement the convention are exempt.
   */
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='queryKey'] > ArrayExpression",
          message: 'Use a key from qk (src/lib/query-keys.ts) instead of an inline array.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              importNames: ['useMutation'],
              message: 'Use useAction from @/lib/refresh so saves refresh the right data.',
            },
          ],
        },
      ],
    },
  },
]);
