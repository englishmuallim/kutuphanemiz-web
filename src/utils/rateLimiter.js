'use strict';

// =========================================================================
// 🛡️ BELLEK İÇİ BAŞARISIZ-DENEME SAYACI / KİLİT MEKANİZMASI
// Yeni bağımlılık yok, SQL yok — tek bir Map. Yalnızca BAŞARISIZ denemeler sayılır
// (çağıran taraf karar verir, bu modül sadece sayar). Pencere SABİT'tir (sliding
// değil): bir anahtarın penceresi dolana kadar sayaç birikir, pencere dolunca (ve
// kilit aktif değilse) sıfırdan başlar — tam hassasiyetli bir "son N dakika" sayacı
// değildir ama brute-force caydırıcısı için yeterlidir.
//
// YENİ: sunucu yeniden başladığında TÜM sayaçlar ve kilitler sıfırlanır — kalıcılık
// (dosya/DB) YOK, bu kabul edilen bir davranıştır.
// =========================================================================

const MAX_KEYS = 20000;
// _sweepExpiredUserAuthCache (libraryController.js) ile aynı desen: boyut bu eşiği
// aşınca süpürme tetiklenir.
const SWEEP_AT_SIZE = 5000;

const _store = new Map(); // key -> { count, windowStart, windowMs, lockedUntil }

function _now() {
    return Date.now();
}

function _entryExpiresAt(entry) {
    return Math.max(entry.lockedUntil || 0, entry.windowStart + entry.windowMs);
}

function _sweepExpired(now) {
    for (const [key, entry] of _store) {
        if (_entryExpiresAt(entry) <= now) _store.delete(key);
    }
}

// Bir anahtarın şu an kilitli olup olmadığını döndürür. Kilit süresi geçmişse burada
// otomatik silinmez (recordFailure/sweep zaten bunu temizler) — sadece "kilitli değil"
// bilgisi döner.
function checkLocked(key) {
    const entry = _store.get(key);
    if (!entry) return { locked: false };

    const now = _now();
    if (entry.lockedUntil && entry.lockedUntil > now) {
        return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
    return { locked: false };
}

// keys: string[] (null/undefined girişler yok sayılır — IP çözülemediğinde ilgili
// anahtar hiç üretilmez, çağıran taraf null geçebilir). En büyük retryAfterSeconds
// döner (birden fazla katman aynı anda kilitliyse kullanıcıya en uzun süre gösterilir).
function checkAnyLocked(keys) {
    let retryAfterSeconds = 0;
    for (const key of keys) {
        if (!key) continue;
        const r = checkLocked(key);
        if (r.locked) retryAfterSeconds = Math.max(retryAfterSeconds, r.retryAfterSeconds);
    }
    return retryAfterSeconds > 0 ? { locked: true, retryAfterSeconds } : { locked: false };
}

// Tek bir anahtara bir başarısız deneme kaydeder ve güncel kilit durumunu döndürür.
function recordFailure(key, { windowMs, maxAttempts, lockoutMs }) {
    const now = _now();
    let entry = _store.get(key);
    const currentlyLocked = !!(entry && entry.lockedUntil && entry.lockedUntil > now);

    // Zaten kilitliyse (normal akışta buraya hiç gelinmemeli — çağıran taraf önce
    // checkAnyLocked ile kontrol eder — ama savunma amaçlı): sayaç artırılmaz, kilit
    // süresi UZATILMAZ.
    if (currentlyLocked) return checkLocked(key);

    if (!entry || (now - entry.windowStart) > entry.windowMs) {
        entry = { count: 0, windowStart: now, windowMs, lockedUntil: 0 };
    }

    entry.count += 1;
    if (entry.count >= maxAttempts) {
        entry.lockedUntil = now + lockoutMs;
    }

    if (_store.size >= SWEEP_AT_SIZE) _sweepExpired(now);
    // MAX_KEYS'e ulaşılmışsa ve bu gerçekten YENİ bir anahtarsa: zarifçe göz ardı edilir
    // (eklenmez) — sistemi felç etmek yerine korumanın bu tek istek için devre dışı
    // kalması tercih edilir; pratikte ulaşılması son derece zor bir üst sınır.
    if (_store.has(key) || _store.size < MAX_KEYS) {
        _store.set(key, entry);
    }

    return checkLocked(key);
}

// entries: [{ key, windowMs, maxAttempts, lockoutMs }] — null/undefined key'ler yok sayılır.
function recordFailures(entries) {
    for (const e of entries) {
        if (!e || !e.key) continue;
        recordFailure(e.key, e);
    }
}

function reset(key) {
    if (key) _store.delete(key);
}

function resetMany(keys) {
    for (const key of keys) reset(key);
}

module.exports = {
    checkLocked,
    checkAnyLocked,
    recordFailure,
    recordFailures,
    reset,
    resetMany,
};
