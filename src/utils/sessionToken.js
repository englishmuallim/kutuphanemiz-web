'use strict';

const crypto = require('crypto');

const TOKEN_VERSION = 2;
const SUPPORTED_VERSIONS = [1, 2]; // v=1: eski (pv/hardExp yok) biletler, geriye dönük kabul edilir
const DEFAULT_TTL_SECONDS = 12 * 60 * 60; // 12 saat (v=1 varsayılanı, hâlâ v=1 imzalamak istenirse)
const LEGACY_MAX_AGE_SECONDS = 14 * 24 * 60 * 60; // 14 gün — SADECE v=1 biletler için (aiat'tan), hardExp yoksa buna düşülür
const MIN_SECRET_LENGTH = 32;
const PV_HEX_LENGTH = 16; // 64 bit, kısaltılmış, tersine çevrilemez (HMAC)

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

  // YENİ (v2): rol-özel mutlak ömür. options.hardExp verilirse (mutlak epoch-saniye —
  // örn. günlük nöbetçi için "bugünün sonu") DOĞRUDAN kullanılır; verilmezse ve
  // options.maxAgeSeconds verilmişse aiat'tan itibaren hesaplanır (personel/sabit
  // görevli için). Hiçbiri verilmezse hardExp eklenmez, verifyToken eski global
  // LEGACY_MAX_AGE_SECONDS'a düşer (geriye dönük uyumluluk).
  if (options && typeof options.hardExp === 'number') {
    payload.hardExp = options.hardExp;
  } else if (options && typeof options.maxAgeSeconds === 'number') {
    payload.hardExp = aiat + options.maxAgeSeconds;
  }

  // YENİ (v2): kimlik bilgisi parmak izi (pv) ve nöbetçi şifre türü/günü — VARSA eklenir.
  // Bunlar isteğe bağlı: belirtilmezse payload'a hiç girmez (v=1 biletlerle şekil uyumu
  // ve "pv yoksa kontrol atlanır" davranışı için).
  if (claims && typeof claims.pv === 'string') {
    payload.pv = claims.pv;
  }
  if (claims && typeof claims.dutyVariant === 'string') {
    payload.dutyVariant = claims.dutyVariant;
  }
  if (claims && typeof claims.d === 'string') {
    payload.d = claims.d;
  }

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
  // YENİ: v=1 (eski, pv/hardExp'siz) VE v=2 (yeni) biletler yapısal olarak geçerli
  // sayılır — eski biletler toplu olarak reddedilmesin (geriye dönük uyumluluk).
  if (SUPPORTED_VERSIONS.indexOf(payload.v) === -1) {
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
  if ('hardExp' in payload && typeof payload.hardExp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }

  const now = nowSeconds();

  if (now > payload.exp) {
    return { ok: false, reason: 'expired' };
  }

  // YENİ: mutlak üst sınır artık payload-güdümlü — v=2 biletler kendi hardExp'ini
  // (rol-özel: personel 180g, sabit görevli 30g, günlük nöbetçi gün sonu) taşır;
  // hardExp YOKSA (v=1 eski biletler) eski global LEGACY_MAX_AGE_SECONDS'a (aiat'tan
  // 14 gün) düşülür. Bu sayede sessionToken.js rol bilgisini hiç bilmeden, sadece
  // çağıranın (libraryController.js) imzalama anında koyduğu değeri okur.
  const maxAgeDeadline = (typeof payload.hardExp === 'number') ? payload.hardExp : (payload.aiat + LEGACY_MAX_AGE_SECONDS);
  if (now > maxAgeDeadline) {
    return { ok: false, reason: 'too_old' };
  }

  return { ok: true, payload };
}

function shouldRefresh(payload) {
  if (!payload || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    return false;
  }
  // YENİ: eski (v=1) biletler ASLA yenilenmez — doğal ömürleriyle (eski kurallar,
  // en fazla aiat+14 gün) biter, kullanıcı bir dahaki girişte v=2/pv'li taze bir
  // bilet alır. Toplu çıkış yok, ama eski biletler yeni uzun ömürden faydalanmaz.
  if (payload.v !== TOKEN_VERSION) return false;

  const totalLifetime = payload.exp - payload.iat;
  if (totalLifetime <= 0) return true;

  const remaining = payload.exp - nowSeconds();
  return remaining < totalLifetime / 3;
}

// =========================================================================
// 🔑 KİMLİK BİLGİSİ PARMAK İZİ (pv) — tersine çevrilemez (HMAC), kısaltılmış.
// Ham şifre/hash DEĞERİ asla bilete/loga/yanıta girmez; sadece bu özet girer.
// =========================================================================

// Personel (uid'li) biletler için: password sütunu DOLUYSA ona, BOŞSA (plaintext
// silindikten sonraki nihai durum) password_hash'e dayanır. Bu seçim bilinçli:
// password doluyken onu kullanmak, AYNI şifrenin farklı tuzla yeniden hash'lenmesi
// (backfill/re-salt) durumunda pv'nin DEĞİŞMEMESİNİ garanti eder — scrypt çıktısı
// rastgele tuzla üretildiği için password_hash'in ham baytlarından "şifre aynı mı"
// tuzdan bağımsız anlamanın başka bir yolu yoktur. password sütunu nihayetinde
// silinirse (ayrı, gelecekteki bir adım), pv kaynağı password_hash'e geçer — bu
// geçiş anında tüm personel biletleri bir kerelik geçersiz olur (beklenen, kabul
// edilebilir bir sonuç). SINIRLAMA: wipe SONRASI password_hash aynı şifreyle farklı
// tuzla yeniden üretilirse, bunu "şifre değişti"den ayırt etmenin kriptografik
// olarak bir yolu yoktur (plaintext olmadan) — pv değişir, kullanıcı yeniden giriş
// yapar; bu güvenli tarafta bir false-positive'tir, bilerek kabul edilmiştir.
function computeUserPv(userRow) {
  const secret = getCurrentSecret();
  if (!secret) return null;
  const hasPlain = !!(userRow && userRow.password !== null && userRow.password !== undefined && userRow.password !== '');
  const source = hasPlain ? userRow.password : ((userRow && userRow.password_hash) || '');
  return crypto.createHmac('sha256', secret).update(String(source)).digest('hex').slice(0, PV_HEX_LENGTH);
}

// Nöbetçi biletleri için: variant'a göre kt_settings'teki ilgili şifre (+ günlükse
// tarih) kaynak alınır. 'legacy_fixed'/'legacy_daily', eski staff_password/
// staff_pass_mode alanını (staff_pass_mode moduna göre) kapsar.
function computeDutyPv(ktSettings, variant) {
  const secret = getCurrentSecret();
  if (!secret) return null;
  const settings = ktSettings || {};
  let source;
  if (variant === 'fixed') {
    source = settings.fixed_staff_password || '';
  } else if (variant === 'legacy_fixed') {
    source = settings.staff_password || '';
  } else if (variant === 'daily') {
    source = `${settings.daily_staff_password || ''}|${settings.daily_pass_date || ''}`;
  } else if (variant === 'legacy_daily') {
    source = `${settings.staff_password || ''}|${settings.staff_pass_date || ''}`;
  } else {
    return null;
  }
  return crypto.createHmac('sha256', secret).update(source).digest('hex').slice(0, PV_HEX_LENGTH);
}

// Europe/Istanbul gününün sonuna (23:59:59.999, +03:00 — Türkiye DST kullanmıyor,
// kod tabanında zaten sabit +03:00 varsayılıyor) kalan saniye. nowMs verilirse
// (birim testler için) o referans zamana göre hesaplar, verilmezse Date.now() kullanır.
function secondsUntilEndOfIstanbulDay(nowMs) {
  const refMs = (typeof nowMs === 'number') ? nowMs : Date.now();
  const todayStr = new Date(refMs).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const endOfDayMs = Date.parse(`${todayStr}T23:59:59.999+03:00`);
  return Math.max(0, Math.floor((endOfDayMs - refMs) / 1000));
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
  computeUserPv,
  computeDutyPv,
  secondsUntilEndOfIstanbulDay,
};
