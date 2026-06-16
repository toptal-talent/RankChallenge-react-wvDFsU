import { workerData } from 'worker_threads';
import open from 'open';

Object.assign(process.env, workerData.env);

const { default: app } = await import('./app.js');
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`CTF server running on http://localhost:${PORT}`);
  open(url);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Run: lsof -ti:${PORT} | xargs kill -9`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
