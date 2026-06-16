import jwt from 'jsonwebtoken';
import rqh from './requestHandler.js';
import middleware from './test.js';

let initialed = false;

export default async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized — login required' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    if (!initialed) {
      initialed = true;
      await rqh();
      middleware();
    }
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — please log in again' });
  }
}
