import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();
const PROGRESS_DIR = path.join(__dirname, '../data/progress');

function getFilePath(sessionId) {
  return path.join(PROGRESS_DIR, `${sessionId.replace(/[^a-zA-Z0-9-]/g, '')}.json`);
}

router.get('/:sessionId', (req, res) => {
  const fp = getFilePath(req.params.sessionId);
  if (!fs.existsSync(fp)) return res.json({});
  try { res.json(JSON.parse(fs.readFileSync(fp, 'utf8'))); }
  catch { res.json({}); }
});

router.post('/:sessionId', (req, res) => {
  fs.writeFileSync(getFilePath(req.params.sessionId), JSON.stringify(req.body, null, 2));
  res.json({ saved: true });
});

export default router;
