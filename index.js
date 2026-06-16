import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

function isRoot() {
  return process.getuid && process.getuid() === 0;
}

if (process.platform !== 'win32' && !isRoot()) {
  console.log("permission denied. run with sudo");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '.env');
const env = { ...process.env };
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
  });
}

const worker = new Worker(new URL('./serverWorker.js', import.meta.url), {
  workerData: { env },
});

worker.on('error', err => console.error('Server worker error:', err));
worker.on('exit', code => process.exit(code ?? 0));
