import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { validate } from '../validators/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();
const CHALLENGES_DIR = path.join(__dirname, '../data/challenges');

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many submissions. Wait a moment.' },
});

function loadChallenge(id) {
  for (const f of fs.readdirSync(CHALLENGES_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, f), 'utf8'));
      if (c.id === id) return c;
    } catch {}
  }
  return null;
}

router.post('/', limiter, async (req, res, next) => {
  try {
    const { challengeId, files } = req.body;
    if (!challengeId || typeof files !== 'object') {
      return res.status(400).json({ error: 'challengeId and files required' });
    }
    const challenge = loadChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
    res.json(await validate(challenge, files));
  } catch (err) {
    next(err);
  }
});

router.post('/connectivity', limiter, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (typeof code !== 'string') {
      return res.status(400).json({ error: 'code string required' });
    }
    const challenge = loadChallenge('10-api-connector');
    if (!challenge) return res.status(404).json({ error: 'Final challenge not found' });
    res.json(await validate(challenge, { 'api-connector.js': code }));
  } catch (err) {
    next(err);
  }
});

export default router;
