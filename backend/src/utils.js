import crypto from 'crypto';

export function makeJoinCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function assertRequired(fields, body) {
  const missing = fields.filter((field) => !body[field]);
  if (missing.length > 0) {
    const error = new Error(`Champs manquants : ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
}
