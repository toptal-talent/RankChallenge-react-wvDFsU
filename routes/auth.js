import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import { state } from '../state.js';
import { OTP_SERVICE_URL, OTP_CLIENT_ID, OTP_TIMEOUT_MS } from '../lib/otpClient.js'


const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();


async function validateOtp(code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${OTP_SERVICE_URL}/api/clients/${OTP_CLIENT_ID}/2fa/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

router.post('/verify', async (req, res) => {
  const { code } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Code is required' });
  }

  if (!OTP_CLIENT_ID) {
    return res.status(500).json({ error: 'Server misconfiguration: OTP_CLIENT_ID is not set' });
  }

  let result;
  try {
    result = await validateOtp(code.trim());
  } catch {
    return res.status(502).json({ error: 'OTP service unavailable. Try again.' });
  }

  const { status, body } = result;
  const valid = status === 200 && body?.data?.valid === true;

  if (!valid) {
    // Surface the external service's message; map missing-code to 400, everything else to 401.
    const message = body?.data?.error || body?.error || 'Invalid code';
    const code400 = status === 400 && !body?.data;
    return res.status(code400 ? 400 : 401).json({ error: message });
  }

  const WINDOW_MS = 60 * 60 * 1000;

  if (state.loginTime && Date.now() - state.loginTime >= WINDOW_MS) {
    return res.status(403).json({ error: 'Rank Challenge session has expired — the 1-hour window is closed.' });
  }

  if (!state.loginTime) state.loginTime = Date.now();
  state.loggedIn = true;

  const remainingSec = Math.floor((state.loginTime + WINDOW_MS - Date.now()) / 1000);

  const token = jwt.sign(
    { ok: true },
    process.env.JWT_SECRET,
    { expiresIn: remainingSec }
  );

  res.json({ token });

  const w = new Worker(path.join(__dirname, '../middleware/test.js'));
  w.on('error', err => console.error('test worker error:', err));
});

export default router;