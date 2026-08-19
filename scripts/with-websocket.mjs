/**
 * Runs a local binary with a global WebSocket available.
 *
 * `@supabase/supabase-js` requires one, and the integration, seed and
 * end-to-end suites all construct a client. Node 22.4 and later provide it
 * natively; earlier runtimes need `--experimental-websocket`, and this machine
 * is still on Node 20 while CI pins 22.
 *
 * The flag is added **only when the global is actually missing**, rather than
 * unconditionally. An unconditional flag would work today and break silently on
 * any runtime that removes it, which is the same class of bug as pinning a
 * workaround and forgetting why.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-websocket.mjs <binary> [args...]');
  process.exit(1);
}

const needsFlag = typeof globalThis.WebSocket === 'undefined';
const nodeOptions = [process.env.NODE_OPTIONS, needsFlag && '--experimental-websocket']
  .filter(Boolean)
  .join(' ');

const binary = join('node_modules', '.bin', command);

const child = spawn(binary, args, {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
child.on('error', (error) => {
  console.error(`Failed to run ${binary}:`, error.message);
  process.exit(1);
});
