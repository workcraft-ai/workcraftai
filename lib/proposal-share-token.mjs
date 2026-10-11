import { createHash } from 'node:crypto';

export function isValidEstimateId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** @param {Request} request */
export function requestShareTokenHash(request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash('sha256').update(token).digest('hex') : null;
}
