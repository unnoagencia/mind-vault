import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolMatchGlobs: [
      ['**/test/auth.test.ts', 'forks'],
    ],
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2025-02-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          kvNamespaces: ['OAUTH_KV'],
        },
        isolatedStorage: false,
      },
    },
  },
});
