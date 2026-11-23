// Bundles src/adapters into one browser script (global `Adapters`) for the browser tests.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/adapters/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'Adapters',
  target: 'es2022',
  platform: 'browser',
  outfile: '.browser-build/adapters.js',
  logLevel: 'info',
});
