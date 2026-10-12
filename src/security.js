'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { AppError } = require('./errors');
const scrypt = promisify(crypto.scrypt);
const settings = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
function equal(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new AppError(422, 'PASSWORD_LENGTH_12_256');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, settings);
  return `scrypt$32768$8$1$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts.slice(0,4).join('$') !== 'scrypt$32768$8$1') return false;
  const hash = await scrypt(password, parts[4], 64, settings);
  return equal(hash.toString('hex'), parts[5]);
}
function safeUser(user) { return { id: user.id, username: user.username, role: user.role, active: user.active, createdAt: user.createdAt }; }
function validateUser(data) {
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(data.username || '')) throw new AppError(422, 'INVALID_USERNAME');
  if (!require('./permissions').ROLES.includes(data.role)) throw new AppError(422, 'INVALID_ROLE');
}
module.exports = { digest, randomToken, equal, hashPassword, verifyPassword, safeUser, validateUser };
