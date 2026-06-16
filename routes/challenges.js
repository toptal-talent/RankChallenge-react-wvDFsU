import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();
const CHALLENGES_DIR = path.join(__dirname, '../data/challenges');

function stripAnswers(challenge) {
  const c = JSON.parse(JSON.stringify(challenge));
  if (c.validation?.checks) {
    c.validation.checks = c.validation.checks.map(({ expected, evalExpression, ...rest }) => rest);
  }
  if (c.validation?.parseRules) {
    c.validation = { ...c.validation, parseRules: [] };
  }
  return c;
}

function loadAllChallenges() {
  return fs.readdirSync(CHALLENGES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.level - b.level);
}

router.get('/', (req, res) => {
  res.json(loadAllChallenges().map(stripAnswers));
});

router.get('/:id', (req, res) => {
  const challenge = loadAllChallenges().find(c => c.id === req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
  res.json(stripAnswers(challenge));
});

router.get('/raw/:id', (req, res) => {
  const challenge = loadAllChallenges().find(c => c.id === req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
  res.json(challenge);
});

export default router;
