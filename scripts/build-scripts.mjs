// Bundles the operational scripts (migrate, seed, cron) into plain JS so the
// slim production image can run them with `node` — no tsx, no TypeScript.
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/migrate.ts', 'scripts/seed.ts', 'scripts/cron-push.ts'],
  outdir: 'scripts/dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  // native / optional modules stay external; they exist in the standalone node_modules
  external: ['@node-rs/argon2', 'pg-native'],
  alias: { '@': './src' },
  logLevel: 'info',
  // `server-only` throws when imported outside React Server; scripts are server code
  plugins: [
    {
      name: 'server-only-stub',
      setup(b) {
        b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export {}', loader: 'js' }));
      },
    },
  ],
});
