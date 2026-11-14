'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

function isEvenLengthHex(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.length % 2 !== 0) return false;
  return /^[0-9a-fA-F]+$/.test(value);
}

function isHashed(value) {
  if (typeof value !== 'string') return false;

  const parts = value.split('$');
  if (parts.length !== 6) return false;

  const [prefix, nStr, rStr, pStr, saltHex, hashHex] = parts;

  if (prefix !== SCRYPT_PREFIX) return false;
  if (!/^[0-9]+$/.test(nStr)) return false;
  if (!/^[0-9]+$/.test(rStr)) return false;
  if (!/^[0-9]+$/.test(pStr)) return false;
  if (!isEvenLengthHex(saltHex)) return false;
  if (!isEvenLengthHex(hashHex)) return false;

  return true;
}

async function hashPassword(plain) {
  const password = String(plain);
  const salt = crypto.randomBytes(SALT_BYTES);

  const derivedKey = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    SCRYPT_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derivedKey.toString('hex'),
  ].join('$');
}

async function verifyPassword(stored, plain) {
  if (plain === null || plain === undefined || plain === '') return false;
  if (!isHashed(stored)) return false;

  const parts = stored.split('$');
  const n = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  const saltHex = parts[4];
  const hashHex = parts[5];

  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const keylen = expected.length;

    const derivedKey = await scryptAsync(String(plain), salt, keylen, { N: n, r, p });

    if (derivedKey.length !== expected.length) return false;
    return crypto.timingSafeEqual(derivedKey, expected);
  } catch (err) {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  isHashed,
};
