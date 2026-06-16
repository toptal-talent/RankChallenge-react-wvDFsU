import express from 'express';
import { otpRequest, OTP_CLIENT_ID } from '../lib/otpClient.js';

const router = express.Router();

function ensureClient(res) {
  if (!OTP_CLIENT_ID) {
    res.status(500).json({ error: 'Server misconfiguration: OTP_CLIENT_ID is not set' });
    return false;
  }
  return true;
}

// GET /api/session/time -> proxies GET /api/clients/:id/time (auth: client)
// Returns { leftTime, remainingSeconds } (both null until the candidate has started).
router.get('/time', async (req, res) => {
  if (!ensureClient(res)) return;
  let result;
  try {
    result = await otpRequest(`/api/clients/${OTP_CLIENT_ID}/time`, { auth: true });
  } catch {
    return res.status(502).json({ error: 'Timer service unavailable.' });
  }
  const { status, body } = result;
  if (status !== 200 || !body?.success) {
    return res.status(status === 200 ? 502 : status).json({ error: body?.error || body?.data || 'Could not read timer' });
  }
  res.json({
    leftTime: body.data?.leftTime ?? null,
    remainingSeconds: body.data?.remainingSeconds ?? null,
  });
});

// POST /api/session/submit -> proxies POST /api/clients/:id/submit (auth: client, no body)
// Marks the candidate's challenge as submitted (idempotent).
router.post('/submit', async (req, res) => {
  if (!ensureClient(res)) return;
  let result;
  try {
    result = await otpRequest(`/api/clients/${OTP_CLIENT_ID}/submit`, { method: 'POST', auth: true });
  } catch {
    return res.status(502).json({ error: 'Submit service unavailable.' });
  }
  const { status, body } = result;
  if (status !== 200 || !body?.success) {
    return res.status(status === 200 ? 502 : status).json({ error: body?.error || body?.data || 'Could not submit' });
  }
  res.json({ submitted: body.data?.submitted === true });
});

export default router;