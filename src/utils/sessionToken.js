'use strict';

const crypto = require('crypto');

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 12 * 60 * 60; // 12 saat
const MAX_AGE_SECONDS = 14 * 24 * 60 * 60; // 14 gün (aiat'tan itibaren mutlak üst sınır)
const MIN_SECRET_LENGTH = 32;

const REQUIRED_PAYLOAD_FIELDS = ['sid', 'role', 'iat', 'exp', 'aiat'];

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64url');
}

function base64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

function getCurrentSecret() {
  const secret = process.env.KT_SESSION_SECRET;
  if (typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH) return secret;
  return null;
}

function getPrevSecret() {
  const secret = process.env.KT_SESSION_SECRET_PREV;
  if (typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH) return secret;
  return null;
}

function isTokenAuthAvailable() {
  return getCurrentSecret() !== null;
}

function computeSignature(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest();
}

function signToken(claims, options) {
  const secret = getCurrentSecret();
  if (!secret) {
    throw new Error('KT_SESSION_SECRET tanimli degil veya 32 karakterden kisa');
  }

  const ttlSeconds = (options && options.ttlSeconds) || DEFAULT_TTL_SECONDS;
  const iat = nowSeconds();
  const exp = iat + ttlSeconds;
  const aiat = (claims && typeof claims.aiat === 'number') ? claims.aiat : iat;

  const payload = {
    v: TOKEN_VERSION,
    sid: claims.sid,
    uid: claims.uid,
    role: claims.role,
    ktRole: claims.ktRole,
    ktClasses: claims.ktClasses,
    iat,
    exp,
    aiat,
  };

  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signatureB64 = base64urlEncode(computeSignature(payloadB64, secret));

  return `${payloadB64}.${signatureB64}`;
}

function verifyToken(token) {
  if (!isTokenAuthAvailable()) {
    return { ok: false, reason: 'unavailable' };
  }

  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'malformed' };
  }

  const dotIndex = token.indexOf('.');
  if (dotIndex === -1 || dotIndex === token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  if (token.indexOf('.', dotIndex + 1) !== -1) {
    return { ok: false, reason: 'malformed' };
  }

  const payloadB64 = token.slice(0, dotIndex);
  const signatureB64 = token.slice(dotIndex + 1);

  let payloadBuf;
  let signatureBuf;
  try {
    payloadBuf = base64urlDecode(payloadB64);
    signatureBuf = base64urlDecode(signatureB64);
  } catch (err) {
    return { ok: false, reason: 'malformed' };
  }

  const candidateSecrets = [getCurrentSecret(), getPrevSecret()].filter((s) => s !== null);

  let signatureValid = false;
  for (const secret of candidateSecrets) {
    const expected = computeSignature(payloadB64, secret);
    if (expected.length === signatureBuf.length && crypto.timingSafeEqual(expected, signatureBuf)) {
      signatureValid = true;
      break;
    }
  }

  if (!signatureValid) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString('utf8'));
  } catch (err) {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.v !== TOKEN_VERSION) {
    return { ok: false, reason: 'malformed' };
  }
  for (const field of REQUIRED_PAYLOAD_FIELDS) {
    if (!(field in payload)) {
      return { ok: false, reason: 'malformed' };
    }
  }
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || typeof payload.aiat !== 'number') {
    return { ok: false, reason: 'malformed' };
  }

  const now = nowSeconds();

  if (now > payload.exp) {
    return { ok: false, reason: 'expired' };
  }
  if (now > payload.aiat + MAX_AGE_SECONDS) {
    return { ok: false, reason: 'too_old' };
  }

  return { ok: true, payload };
}

function shouldRefresh(payload) {
  if (!payload || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    return false;
  }
  const totalLifetime = payload.exp - payload.iat;
  if (totalLifetime <= 0) return true;

  const remaining = payload.exp - nowSeconds();
  return remaining < totalLifetime / 3;
}

// İstek başlıklarından bileti çıkarır: önce x-kt-token, yoksa Authorization: Bearer <token>.
// headers anahtarları Express'te küçük harfe normalize edilmiş gelir (örn. req.headers).
function extractKtToken(headers) {
  if (!headers || typeof headers !== 'object') return null;

  const direct = headers['x-kt-token'];
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim();

  const authHeader = headers['authorization'];
  if (typeof authHeader === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match && match[1].trim() !== '') return match[1].trim();
  }

  return null;
}

module.exports = {
  isTokenAuthAvailable,
  signToken,
  verifyToken,
  shouldRefresh,
  extractKtToken,
};
