import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

export const OTP_SERVICE_URL = process.env.OTP_SERVICE_URL;
export const OTP_CLIENT_ID = process.env.OTP_CLIENT_ID;
export const OTP_CLIENT_TOKEN = process.env.OTP_CLIENT_TOKEN;
export const OTP_TIMEOUT_MS = 3000;

export async function otpRequest(path, { method = 'GET', body, auth = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OTP_TIMEOUT_MS);
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && OTP_CLIENT_TOKEN) headers['Authorization'] = `Bearer ${OTP_CLIENT_TOKEN}`;
    const res = await fetch(`${OTP_SERVICE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json();
    return { status: res.status, body: data };
  } finally {
    clearTimeout(timer);
  }
}