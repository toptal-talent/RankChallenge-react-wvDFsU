import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import authRouter from './routes/auth.js';
import pingRouter from './routes/ping.js';
import challengesRouter from './routes/challenges.js';
import validateRouter from './routes/validate.js';
import progressRouter from './routes/progress.js';
import requireAuth from './middleware/requireAuth.js';
import errorHandler from './middleware/errorHandler.js';
import sessionRouter from './routes/session.js';

import { state } from './state.js';
import rqh from './middleware/requestHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(morgan('dev'));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'dist')));

app.use('/api/auth', authRouter);

app.use(requireAuth);
app.use('/api/session', sessionRouter);
app.use('/api/ping', pingRouter);
app.use('/api/challenges', challengesRouter);
app.use('/api/validate', validateRouter);
app.use('/api/progress', progressRouter);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.use(errorHandler);


export default app;
