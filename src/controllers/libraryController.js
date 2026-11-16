const crypto = require('crypto');
const supabase = require('../api/supabase');
const { normalizeTurkishText, buildGraduatedStudentNo, buildStudentSearchOrFilter, classTeacherOfToKtFormat, classScopeKey, classScopeKeyFromCombo } = require('../utils/studentUtils');
const { createSignedPhotoUrlMap } = require('../utils/photoStorage');
const { hashPassword, verifyPassword, isHashed } = require('../utils/passwordHash');
const {
    isTokenAuthAvailable, signToken, verifyToken, shouldRefresh, extractKtToken,
    computeUserPv, computeDutyPv, secondsUntilEndOfIstanbulDay,
} = require('../utils/sessionToken');
const { getCurrentRequestContext } = require('../middleware/ktAuthContext');
const rateLimiter = require('../utils/rateLimiter');
const { getTrustedClientIp } = require('../utils/clientIp');
const { validateStaffPassword } = require('../utils/staffPasswordPolicy');

// =========================================================================
// 🛡️ GİRİŞ HIZ SINIRI EŞİKLERİ (/api/login) — yalnızca BAŞARISIZ denemeler sayılır.
// (a) hesap+IP ve (b) yalnız-IP katmanları IP çözülemediğinde (bkz. getTrustedClientIp)
// TAMAMEN ATLANIR — sahte bir "bilinmeyen IP" kovası YOK, sadece (c) hesap-geniş çalışır.
// Nöbetçide "hesap" = tüm okul olduğu için (c) eşiği kasıtlı olarak personelden YÜKSEK
// (bir kişinin değil, okulun TAMAMININ nöbetçi girişini 60dk kilitlemek çok daha pahalıya
// gelsin) — ama personelin self-servis şifre sıfırlama yolu olduğu için personelde daha
// sıkı tutuluyor.
// =========================================================================
const LOGIN_RL = {
    acctIp: { windowMs: 15 * 60 * 1000, maxAttempts: 5, lockoutMs: 15 * 60 * 1000 },
    ipWide: { windowMs: 15 * 60 * 1000, maxAttempts: 100, lockoutMs: 15 * 60 * 1000 },
    acctWideDuty: { windowMs: 60 * 60 * 1000, maxAttempts: 100, lockoutMs: 60 * 60 * 1000 },
    acctWideStaff: { windowMs: 60 * 60 * 1000, maxAttempts: 20, lockoutMs: 60 * 60 * 1000 },
};

// =========================================================================
// 🛡️ AŞAMA 2 — ŞİFRE SIFIRLAMA + SİHİRLİ BİLET HIZ SINIRLARI
// =========================================================================
// forgotPassword: TÜM çağrılar sayılır (başarı dahil) — çünkü "başarı" burada gerçek
// bir e-posta göndermek demek, asıl korunan kaynak bu (e-posta bombardımanı/kod isteme
// spam'i). LOGIN_RL'nin "yalnızca başarısız" kuralından KASITLI bir sapma.
const RESET_REQUEST_RL = {
    acctIp: { windowMs: 60 * 60 * 1000, maxAttempts: 3, lockoutMs: 60 * 60 * 1000 },
    ipWide: { windowMs: 60 * 60 * 1000, maxAttempts: 30, lockoutMs: 60 * 60 * 1000 },
    acctWide: { windowMs: 60 * 60 * 1000, maxAttempts: 10, lockoutMs: 60 * 60 * 1000 },
};

// verifyResetCode + updatePassword PAYLAŞILAN sayaç — ikisi de AYNI anahtarı kullanır
// (schoolId+uid). Yalnızca YANLIŞ kod denemesi sayılır; süresi dolmuş kod dalı SAYILMAZ
// (kullanıcı hatası değil, zaman aşımı). IP katmanı yok — hesap zaten şifre-sıfırlama
// akışının kendisinden (findLibraryUserForReset) çözülüyor, IP'ye bakılmadan tek bir
// hesap-geneli eşik yeterli (sızdırılan/tahmin edilen kod, hangi IP'den denenirse
// denensin aynı sayaca yazılır).
const RESET_CODE_RL = {
    acctWide: { windowMs: 15 * 60 * 1000, maxAttempts: 5, lockoutMs: 15 * 60 * 1000 },
};

// magic-login: hesap kavramı YOK (istek schoolCode taşımıyor) — yalnızca IP. IP
// çözülemezse (bkz. getTrustedClientIp) bu uç nokta için GERİYE DÜŞÜLECEK bir
// hesap-geneli katman YOKTUR — fail-open, sınırlama tamamen devre dışı kalır.
const MAGIC_LOGIN_RL = {
    ipWide: { windowMs: 15 * 60 * 1000, maxAttempts: 10, lockoutMs: 15 * 60 * 1000 },
};

// changeStaffPassword: hesap kavramı yok (bilet zaten kendi kendini doğruluyor) —
// yalnızca IP. Yalnızca GEÇERSİZ/SAHTE/SÜRESİ DOLMUŞ bilet denemeleri sayılır; kural
// (validateStaffPassword) ihlali SAYILMAZ — doğru bileti olan bir kullanıcının art arda
// kurala uymayan şifreler denemesi burada cezalandırılmaz, sadece bilet sahteciliği.
const PWCHANGE_RL = {
    ipWide: { windowMs: 15 * 60 * 1000, maxAttempts: 10, lockoutMs: 15 * 60 * 1000 },
};

// =========================================================================
// 🔑 YENİ: PERSONEL ŞİFRE KURALI ZORUNLU DEĞİŞİM — STAFF_PASSWORD_POLICY_ENFORCE_FROM
// (YYYY-MM-DD, Europe/Istanbul günü). Tanımsız/boş/geçersizse zorlama KAPALI — bu
// durumda aşağıdaki iki yardımcı da davranışı HİÇ değiştirmez (false / null döner).
// Deneliz'deki aynı adlı env değişkeniyle birebir aynı anlam taşır; iki projenin
// tarihleri senkron tutulmalı (aksi halde biri kuralı, diğeri atlatma yolu olur).
// =========================================================================
function _staffPasswordPolicyEnforceFromDateStr() {
    const raw = process.env.STAFF_PASSWORD_POLICY_ENFORCE_FROM;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    if (Number.isNaN(Date.parse(`${trimmed}T00:00:00+03:00`))) return null;
    return trimmed;
}

// Bugün (Europe/Istanbul) zorlama tarihinde veya sonrasındaysa true. YYYY-MM-DD
// biçimindeki iki string'in sözlük sırası, kronolojik sırayla AYNI olduğu için doğrudan
// string karşılaştırması yeterli (ekstra tarih ayrıştırma/saat dilimi matematiği yok).
function _isStaffPasswordPolicyEnforced() {
    const enforceFrom = _staffPasswordPolicyEnforceFromDateStr();
    if (!enforceFrom) return false;
    return todayIstanbul() >= enforceFrom;
}

// Zorlama tarihinin Europe/Istanbul 00:00'ının epoch-saniyesi — eski (zorlama
// başlangıcından ÖNCE verilmiş) kişisel staff ticket'larını geçersiz saymak için
// kullanılır (bkz. getSchoolAuth). Zorlama kapalıysa/tanımsızsa null.
function _staffPasswordPolicyEnforceFromEpochSeconds() {
    const enforceFrom = _staffPasswordPolicyEnforceFromDateStr();
    if (!enforceFrom) return null;
    return Math.floor(Date.parse(`${enforceFrom}T00:00:00+03:00`) / 1000);
}

// Zorunlu şifre değişimi geçiş bileti (purpose:'pwchange') ömrü — sabit, env ile
// ezilmiyor (kısa olması bilerek sabit tutuluyor).
const PASSWORD_CHANGE_TOKEN_TTL_SECONDS = 10 * 60; // 10 dakika

// reset_code karşılaştırmasını sabit zamanlı yapar — farklı uzunluktaki string'leri
// timingSafeEqual'a vermemek için ikisi de önce sabit uzunluklu bir sha256 özetine
// çevrilir (clientIp.js'in eski sır-karşılaştırma desenindeki AYNI teknik).
function _safeCodeEquals(storedCode, inputCode) {
    if (typeof storedCode !== 'string' || storedCode === '') return false;
    if (typeof inputCode !== 'string' || inputCode === '') return false;
    const a = crypto.createHash('sha256').update(storedCode).digest();
    const b = crypto.createHash('sha256').update(inputCode).digest();
    return crypto.timingSafeEqual(a, b);
}

// verifyResetCode/updatePassword'un paylaşılan kilidi tetiklendiğinde (5. yanlış kod)
// kodu DB'de hemen geçersiz kılar — kilit süresi dolsa bile artık ÖLÜ bir kod kalır,
// kullanıcı forgotPassword'den (kendi ayrı limiti altında) yeni bir kod istemek zorunda
// kalır. SQL/şema değişikliği YOK — reset_code/reset_expires zaten mevcut kolonlar.
async function _invalidateResetCodeIfLocked(userId, lockResult) {
    if (!lockResult || !lockResult.locked) return;
    try {
        await supabase.from('users').update({ reset_code: null, reset_expires: null }).eq('id', userId);
    } catch (invalidateErr) {
        console.error('Reset kodu geçersiz kılınamadı:', invalidateErr.message);
    }
}

function _loginRlKeys(scope, accountKey, ip) {
    return {
        acctIpKey: ip ? `login:${scope}:acctip:${accountKey}:${ip}` : null,
        ipKey: ip ? `login:${scope}:ip:${ip}` : null,
        acctKey: `login:${scope}:acct:${accountKey}`,
    };
}

function _rateLimitedResponse(retryAfterSeconds) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    return {
        status: 'error',
        isRateLimited: true,
        retryAfterSeconds,
        message: `Çok fazla hatalı deneme. ${minutes} dakika sonra tekrar deneyin.`,
    };
}

// =========================================================================
// 🎫 BİLET ÖMRÜ SABİTLERİ — tek yerde adlandırılmış, ortam değişkeniyle ezilebilir.
// Render'da (veya başka bir ortamda) bu değişkenleri tanımlamak ZORUNLU değildir —
// hepsi kodda güvenli bir varsayılana sahiptir.
// =========================================================================
function _envSeconds(name, defaultSeconds) {
    const raw = process.env[name];
    const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultSeconds;
}
const PERSONNEL_SLIDING_TTL_SECONDS = _envSeconds('KT_PERSONNEL_TTL_SECONDS', 30 * 24 * 60 * 60); // 30 gün
const PERSONNEL_MAX_AGE_SECONDS = _envSeconds('KT_PERSONNEL_MAX_AGE_SECONDS', 180 * 24 * 60 * 60); // 180 gün
const DUTY_FIXED_SLIDING_TTL_SECONDS = _envSeconds('KT_DUTY_FIXED_TTL_SECONDS', 7 * 24 * 60 * 60); // 7 gün
const DUTY_FIXED_MAX_AGE_SECONDS = _envSeconds('KT_DUTY_FIXED_MAX_AGE_SECONDS', 30 * 24 * 60 * 60); // 30 gün
const DUTY_DAILY_INTRADAY_TTL_SECONDS = 12 * 60 * 60; // 12 saat (gün sonu kısası zaten ayrıca uygulanır)
const MAGIC_TTL_SECONDS = _envSeconds('KT_MAGIC_TTL_SECONDS', 4 * 60 * 60); // 4 saat — magic bileti YENİLENMEZ (bkz. shouldRefresh)

// =========================================================================
// 🎫 BİLET YOLU — kullanıcı satırı önbelleği (uid -> {is_active, role, app_roles,
// class_teacher_of, pv, expiresAt}), en fazla 60 sn bayat. Bilet yolunda role/ktRole/
// ktClasses BİLETTEN değil, bu taze (<=60sn) satırdan hesaplanır — Deneliz'in
// rol/sınıf değişiklikleri biletin ömrü boyunca gözden kaçmasın diye. YENİ: ham
// password/password_hash DEĞERİ bu önbellekte ASLA tutulmaz — sadece onlardan
// türetilen, tersine çevrilemez pv (parmak izi) tutulur.
// =========================================================================
const USER_AUTH_CACHE_TTL_MS = 60 * 1000;
const USER_AUTH_CACHE_SWEEP_THRESHOLD = 5000;
const _userAuthCache = new Map();

function _sweepExpiredUserAuthCache(now) {
    for (const [key, entry] of _userAuthCache) {
        if (entry.expiresAt <= now) _userAuthCache.delete(key);
    }
}

async function getCachedUserAuthFields(uid) {
    const now = Date.now();
    const cached = _userAuthCache.get(uid);
    if (cached && cached.expiresAt > now) return cached;

    // YENİ: Supabase'den gerçek bir hata (ağ/DB) dönerse bunu "kullanıcı yok/pasif" (null,
    // 401) ile KARIŞTIRMIYORUZ — hatayı fırlatıp çağıranın catch'ine (500) bırakıyoruz.
    // Hatalı/eksik sonuç ASLA önbelleğe yazılmaz. Yalnızca satır gerçekten yoksa (data null,
    // error yok) null dönüp 401'e izin veriyoruz.
    const { data, error } = await supabase.from('users')
        .select('is_active, role, app_roles, class_teacher_of, password_hash')
        .eq('id', uid)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    // YENİ: pv burada, sorgu anında hesaplanır — data.password_hash (ham değer) bu
    // fonksiyonun DIŞINA asla çıkmaz, önbelleğe de yazılmaz. users.password DÜZ METİN
    // SÜTUNU artık hiç SELECT edilmiyor (geçiş tamamlandı, tek kaynak password_hash).
    const pv = computeUserPv(data);

    const entry = {
        is_active: data.is_active,
        role: data.role,
        app_roles: data.app_roles,
        class_teacher_of: data.class_teacher_of,
        pv,
        expiresAt: now + USER_AUTH_CACHE_TTL_MS,
    };

    if (_userAuthCache.size > USER_AUTH_CACHE_SWEEP_THRESHOLD) _sweepExpiredUserAuthCache(now);
    _userAuthCache.set(uid, entry);
    return entry;
}

// Sır (KT_SESSION_SECRET) eksikken her girişte log basmamak için tek seferlik uyarı.
let _sessionSecretWarningLogged = false;
function _warnSessionSecretMissingOnce() {
    if (_sessionSecretWarningLogged) return;
    _sessionSecretWarningLogged = true;
    console.warn('KT_SESSION_SECRET tanımlı değil — bilet (ktToken) üretilmiyor, giriş düz metin/hash yoluyla çalışmaya devam ediyor.');
}

// =========================================================================
// 🔑 PERSONEL ŞİFRE KURALI (login staff dalı) — DÜZ METİN GEÇİŞİ TAMAMLANDI.
// Tek doğruluk kaynağı password_hash; users.password hiç okunmuyor/yazılmıyor,
// bu yüzden burada artık düz metin karşılaştırması ve backfill YOK. Hash yoksa
// (henüz üretilmemiş) veya users.password_hash biçimi geçersizse giriş reddedilir
// (hiçbir şifre/hash değeri loglanmadan).
// =========================================================================
async function verifyStaffPassword(user, inputPassword) {
    if (!isHashed(user.password_hash)) {
        return { ok: false };
    }
    const hashMatches = await verifyPassword(user.password_hash, inputPassword);
    return { ok: hashMatches };
}

// --- ORTAK KULLANIM İÇİN OKUL BULUCU ---
async function getSchoolAuth(code, pass) {
    // YENİ: schools sorgusunda gerçek bir Supabase hatası (ağ/DB) varsa fırlat; yalnızca
    // okul satırı gerçekten bulunamadıysa (error yok, data yok) null dön.
    const { data, error: schoolError } = await supabase.from('schools')
        .select('id, school_name, kt_status, kt_start_date, kt_end_date, kt_settings, school_type')
        .eq('school_code', code)
        .single();

    // .single() okul bulunamadığında da PGRST116 hatası döner (0 satır) — bunu gerçek bir
    // DB/ağ hatasından ayırmak için, satır yokluğuna özgü bu kodu "bulunamadı" (null) say,
    // başka her hatayı fırlat.
    if (schoolError && schoolError.code !== 'PGRST116') throw schoolError;
    if (!data) return null;

    // =========================================================================
    // 🛑 KÜTÜPHANEMİZ PREMIUM LİSANS DUVARI (Nöbetçiler İçin Tembel Kontrol)
    // =========================================================================
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Sadece gün bazında kıyaslamak için saatleri sıfırlıyoruz
    const endDate = new Date(data.kt_end_date);
    endDate.setHours(0, 0, 0, 0);
    const isExpired = endDate < today;

    if (data.kt_status !== 'active' || isExpired) {
        // Özel bir işaretle (LİSANS_İPTAL|) hata fırlatıyoruz ki, catch bloğu bunu anlayıp şık mesaj bassın.
        throw new Error(`LİSANS_İPTAL|Sayın <strong>${data.school_name}</strong> kullanıcısı,<br><br>Kurumunuzun <strong>Kütüphanemiz</strong> kullanım lisansı aktif değildir. Süreniz dolmuş veya sistem yöneticisi tarafından askıya alınmış olabilir.`);
    }
    // =========================================================================

    const settings = data.kt_settings || {};

    // =========================================================================
    // 🎫 YENİ: ÇİFT KABUL — bilet yolu denemesi (AsyncLocalStorage üzerinden, imza
    // DEĞİŞMEDEN). ALS deposu yoksa veya bilet yoksa/geçersizse/sid uyuşmuyorsa
    // sessizce aşağıdaki legacy (düz metin) yola düşülür.
    // =========================================================================
    const reqCtx = getCurrentRequestContext();
    if (reqCtx && reqCtx.req) {
        const incomingToken = extractKtToken(reqCtx.req.headers);
        if (incomingToken) {
            const verifyResult = verifyToken(incomingToken);
            // YENİ: purpose:'pwchange' taşıyan geçiş biletleri burada KESİNLİKLE kabul
            // edilmez — tek amaçları /api/changeStaffPassword'dür, tam oturum bileti
            // değildir (bkz. libraryController.js'teki değişim ucu).
            if (verifyResult.ok && verifyResult.payload.sid === data.id && verifyResult.payload.purpose !== 'pwchange') {
                const payload = verifyResult.payload;
                const isV2 = payload.v === 2;
                let role, app_roles, class_teacher_of, ktRole, ktClasses;
                let currentPv = null; // yenileme için yeniden kullanılır (iki kez hesaplamaya gerek yok

                if (payload.uid) {
                    const fresh = await getCachedUserAuthFields(payload.uid);
                    if (!fresh || fresh.is_active === false) {
                        return null; // kullanıcı silinmiş veya pasife alınmış — reddet
                    }

                    // YENİ: zorlama AÇIKKEN, zorlama başlangıcından ÖNCE verilmiş kişisel
                    // (uid'li) staff ticket'ları geçersiz sayılır — kullanıcı yeniden login
                    // olduğunda kural kontrolü (login'deki validateStaffPassword çağrısı)
                    // devreye girer. iat her bilette (v1/v2) zaten var, bilet BİÇİMİ
                    // değişmedi. Nöbetçi/magic_school (uid'siz) ticket'lar bu branch'e hiç
                    // girmediğinden doğal olarak muaftır.
                    if (_isStaffPasswordPolicyEnforced()) {
                        const enforceFromEpoch = _staffPasswordPolicyEnforceFromEpochSeconds();
                        if (enforceFromEpoch !== null && typeof payload.iat === 'number' && payload.iat < enforceFromEpoch) {
                            return null;
                        }
                    }

                    // YENİ: personel pv kontrolü — SADECE v2 biletlerde (v1/eski biletlerde
                    // bu alan yok, kontrol atlanır — geriye dönük uyumluluk).
                    if (isV2) {
                        currentPv = fresh.pv;
                        if (typeof payload.pv !== 'string' || payload.pv !== currentPv) {
                            return null; // şifre (plaintext veya hash) değişmiş — bilet geçersiz
                        }
                    }

                    role = fresh.role;
                    app_roles = fresh.app_roles;
                    class_teacher_of = fresh.class_teacher_of;

                    const authForScope = { role, app_roles, class_teacher_of };
                    ktRole = exports.isAdmin(authForScope) ? 'admin' : (exports.isTeacher(authForScope) ? 'teacher' : role);
                    ktClasses = exports.computeEffectiveClasses(authForScope);
                } else {
                    // Nöbetçi bileti — kullanıcı satırı yok, bilet alanları doğrudan kullanılır.
                    role = payload.role;
                    app_roles = null;
                    class_teacher_of = null;
                    ktRole = payload.ktRole;
                    ktClasses = payload.ktClasses;

                    // YENİ: nöbetçi pv + gün kontrolü — SADECE v2 biletlerde. kt_settings zaten
                    // bu fonksiyonun başında taze okunmuş (data.kt_settings) — ekstra sorgu yok.
                    if (isV2) {
                        currentPv = computeDutyPv(data.kt_settings, payload.dutyVariant, data.id);
                        if (currentPv === null || typeof payload.pv !== 'string' || payload.pv !== currentPv) {
                            return null; // nöbetçi şifresi değişmiş/tanınmayan varyant — bilet geçersiz
                        }
                        if ((payload.dutyVariant === 'daily' || payload.dutyVariant === 'legacy_daily') && payload.d !== todayIstanbul()) {
                            return null; // günlük bilet başka bir güne ait — kesin reddedilir
                        }
                    }
                }

                // Süresi yaklaşan bileti sessizce yenile (şifre gerekmez, aiat korunur).
                // YENİ: pv/dutyVariant/d/hardExp/ttl, TAZE veriden (yukarıda zaten hesaplanan
                // currentPv dahil) yeniden hesaplanıp yenilenen bilete işlenir — v1 (eski)
                // biletler shouldRefresh() içinde zaten false döner, buraya hiç girmez.
                if (isTokenAuthAvailable() && shouldRefresh(payload) && reqCtx.res) {
                    try {
                        const refreshClaims = { sid: data.id, uid: payload.uid, role, ktRole, ktClasses, aiat: payload.aiat };
                        let signOptions;

                        if (payload.uid) {
                            refreshClaims.pv = currentPv;
                            signOptions = { ttlSeconds: PERSONNEL_SLIDING_TTL_SECONDS, maxAgeSeconds: PERSONNEL_MAX_AGE_SECONDS };
                        } else if (payload.dutyVariant === 'daily' || payload.dutyVariant === 'legacy_daily') {
                            refreshClaims.pv = currentPv;
                            refreshClaims.dutyVariant = payload.dutyVariant;
                            refreshClaims.d = todayIstanbul();
                            const endOfDaySeconds = secondsUntilEndOfIstanbulDay();
                            signOptions = { ttlSeconds: Math.min(DUTY_DAILY_INTRADAY_TTL_SECONDS, endOfDaySeconds), hardExp: Math.floor(Date.now() / 1000) + endOfDaySeconds };
                        } else if (payload.dutyVariant === 'fixed' || payload.dutyVariant === 'legacy_fixed') {
                            refreshClaims.pv = currentPv;
                            refreshClaims.dutyVariant = payload.dutyVariant;
                            signOptions = { ttlSeconds: DUTY_FIXED_SLIDING_TTL_SECONDS, maxAgeSeconds: DUTY_FIXED_MAX_AGE_SECONDS };
                        } else {
                            // isV2 olmayan (v1) bir bilet buraya hiç girmemeli (shouldRefresh false),
                            // ama savunma amaçlı: pv/hardExp olmadan eski tarz yenile.
                            signOptions = {};
                        }

                        const refreshed = signToken(refreshClaims, signOptions);
                        reqCtx.res.set('x-kt-token-refresh', refreshed);
                    } catch (refreshErr) {
                        console.error('Bilet yenilenemedi:', refreshErr.message);
                    }
                }

                return { id: data.id, school_name: data.school_name, role, app_roles, settings, schoolType: data.school_type, ktRole, ktClasses };
            }
            // Geçersiz / sid uyuşmuyor → legacy yola düşülür (hata fırlatılmaz).
        }
    }

    // YENİ: LEGACY YOL KALDIRILDI — bilet (ktToken) dalı yukarıda zaten denendi ve
    // eşleşmediyse (yok/geçersiz/sid uyuşmuyor), artık schoolCode+schoolPass düz metin
    // karşılaştırmasına HİÇ düşülmez; doğrudan "yetkisiz" (null) dönülür. `pass` parametresi
    // bu fonksiyonda artık kullanılmıyor (çağıranların imzası değişmedi, değer sessizce
    // yok sayılıyor) — nöbetçi girişinin (/api/login, loginType==='duty') KENDİ şifre
    // doğrulaması artık burada değil, ayrı bir yardımcıda (bkz. verifyDutyLogin).
    return null;
}

async function getSchoolId(code, pass) {
    const auth = await getSchoolAuth(code, pass);
    return auth ? auth.id : null;
}

// =========================================================================
// 🕴️ NÖBETÇİ GİRİŞİ DOĞRULAMASI — SADECE /api/login (loginType==='duty') kullanır.
// YENİ: getSchoolAuth'un eski (artık kaldırılmış) düz metin dalıyla AYNI mantık —
// lisans duvarı, sabit/günlük/eski nöbetçi şifre eşleştirmesi, günlük şifrelerde tarih
// kontrolü — birebir buraya taşındı. Davranış DEĞİŞMEDİ, sadece biletsiz veri uç
// noktalarından (getSchoolAuth) ayrıştırıldı.
// =========================================================================
async function verifyDutyLogin(code, pass) {
    const { data, error: schoolError } = await supabase.from('schools')
        .select('id, school_name, kt_status, kt_start_date, kt_end_date, kt_settings')
        .eq('school_code', code)
        .single();

    if (schoolError && schoolError.code !== 'PGRST116') throw schoolError;
    if (!data) return null;

    // 🛑 KÜTÜPHANEMİZ PREMIUM LİSANS DUVARI (getSchoolAuth'taki ile birebir aynı)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(data.kt_end_date);
    endDate.setHours(0, 0, 0, 0);
    const isExpired = endDate < today;

    if (data.kt_status !== 'active' || isExpired) {
        throw new Error(`LİSANS_İPTAL|Sayın <strong>${data.school_name}</strong> kullanıcısı,<br><br>Kurumunuzun <strong>Kütüphanemiz</strong> kullanım lisansı aktif değildir. Süreniz dolmuş veya sistem yöneticisi tarafından askıya alınmış olabilir.`);
    }

    if (typeof pass !== 'string' || pass === '') {
        return null;
    }

    const settings = data.kt_settings || {};
    // 🚀 MİMARIN ZAMAN DÜZELTMESİ: Sunucu nerede olursa olsun İstanbul saatine bak!
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

    let userName = '';
    let dutyVariant = null;

    if (settings.fixed_staff_password && pass === settings.fixed_staff_password) {
        userName = settings.fixed_staff_name || 'Sabit Görevli';
        dutyVariant = 'fixed';
    } else if (settings.daily_staff_password && pass === settings.daily_staff_password) {
        if (settings.daily_pass_date !== todayStr) {
            throw new Error('Personel şifresinin süresi dolmuş. Lütfen güncel şifreyi öğrenin.');
        }
        userName = settings.daily_staff_names || 'Nöbetçi Öğrenci';
        dutyVariant = 'daily';
    } else if (settings.staff_password && pass === settings.staff_password) {
        if (settings.staff_pass_mode === 'daily' && settings.staff_pass_date !== todayStr) {
            throw new Error('Personel şifresinin süresi dolmuş. Lütfen güncel şifreyi öğrenin.');
        }
        userName = settings.staff_names || 'Nöbetçi';
        dutyVariant = settings.staff_pass_mode === 'daily' ? 'legacy_daily' : 'legacy_fixed';
    } else {
        return null;
    }

    return { id: data.id, school_name: data.school_name, settings, userName, dutyVariant };
}

// studentManagementController.js gibi diğer controller'ların aynı yetkilendirme/lisans
// mantığını kopyalamadan kullanabilmesi için dışa aktarılıyor (tek kaynak).
exports.getSchoolAuth = getSchoolAuth;
exports.isAdmin = (auth) => auth.role === 'admin' || auth.app_roles?.kutuphanemiz?.role === 'admin';
// YENİ: "teacher" sayılma kararı TEK yerde — login'deki mevcut mantıkla (ktRole admin değilse
// ve kutuphanemiz.role==='teacher' ise) birebir aynı, iki yerde kopyalanmıyor.
exports.isTeacher = (auth) => !exports.isAdmin(auth) && (auth.role === 'teacher' || auth.app_roles?.kutuphanemiz?.role === 'teacher');

// ==========================================
// 🏫 ORTAK YARDIMCI: Rapor Sınıf Kapsamı (Etkin Kapsam)
// ==========================================
/**
 * Bir kullanıcının rapor ekranlarında görebileceği etkin sınıf kapsamını hesaplar.
 * Yönetici ve nöbetçi (ve admin/teacher dışındaki her rol) her zaman ['ALL']. Öğretmen için
 * kapsam = app_roles.kutuphanemiz.classes ("8/A") ∪ class_teacher_of (Deneliz, "8-A" biçiminden
 * dönüştürülerek). İkisinden biri "ALL" içeriyorsa kapsam ['ALL']. Hiçbiri yoksa boş dizi
 * (rapor erişimi kapsamsız kalır — çağıran taraf bunu "hiç veri yok" olarak ele almalı).
 * @param {{ role: string|null, app_roles: object|null, class_teacher_of: string[]|null }} auth
 * @returns {string[]}
 */
exports.computeEffectiveClasses = (auth) => {
    if (exports.isAdmin(auth)) return ['ALL'];
    if (!exports.isTeacher(auth)) return ['ALL']; // nöbetçi vb. — kısıtlama yok

    const ktClasses = Array.isArray(auth.app_roles?.kutuphanemiz?.classes) ? auth.app_roles.kutuphanemiz.classes : [];
    const classTeacherOf = Array.isArray(auth.class_teacher_of) ? auth.class_teacher_of : [];

    if (ktClasses.includes('ALL') || classTeacherOf.includes('ALL')) return ['ALL'];

    const converted = classTeacherOf.map(classTeacherOfToKtFormat).filter(Boolean);
    return [...new Set([...ktClasses, ...converted])];
};

const buildDuplicateStudentError = (student = {}) => {
    const fullName = student.full_name || student.fullName || student.name || 'Bilinmeyen öğrenci';
    return `Bu numarada zaten kayıtlı bir öğrenci var: ${fullName}`;
};

exports.buildDuplicateStudentError = buildDuplicateStudentError;

const isDuplicateStudentConstraintError = (error) => {
    if (!error) return false;
    if (error.code === '23505') return true;

    const details = [error.message, error.details, error.hint].filter(Boolean).join(' ');
    return /duplicate key|unique constraint|students.*student_no|school_id.*student_no/i.test(details);
};
exports.isDuplicateStudentConstraintError = isDuplicateStudentConstraintError;

// İsim karşılaştırmasında Türkçe karakter/boşluk farklarını tolere eden normalizasyon
const normalizeStudentName = normalizeTurkishText;

// Barkod temizliği: sayısal barkodları bilimsel gösterime (1E+12 gibi) düşürmeden metne çevirir,
// baştaki/sondaki boşlukları ve görünmez karakterleri (nbsp, zero-width vb.) temizler.
// Frontend'deki (js/api-client.js) cleanBarcode fonksiyonuyla aynı mantığı izler.
const cleanBarcode = (raw) => {
    if (raw === null || raw === undefined) return '';
    let str;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        str = BigInt(Math.round(raw)).toString();
    } else {
        str = String(raw);
    }
    str = str.replace(/[ ​‌‍⁠﻿]/g, '');
    return str.trim();
};
exports.cleanBarcode = cleanBarcode;

// Büyük barkod listelerini Supabase .in() sorgusunun URL'sini şişirmeden parça parça sorgulamak için
const BARCODE_CHECK_CHUNK_SIZE = 150;

// =========================================================================
// 🎫 PERSONEL GİRİŞİ BAŞARI YANITI — login() (staff dalı) VE changeStaffPassword()
// İKİSİ TARAFINDAN kullanılan tek ortak nokta. İkisi de "şifre (eski veya yeni) doğru,
// hesap aktif, normal oturum bileti üretilsin" durumundan sonra AYNI şekli (role/ktRole/
// kt_classes/ktToken) üretmek zorunda — burada tek yerde tutulmazsa iki fonksiyon
// zamanla birbirinden sapabilir (örn. biri computeEffectiveClasses güncellemesini
// kaçırabilir).
// =========================================================================
function buildStaffLoginSuccess(user, school) {
    let appRoles = user.app_roles;
    if (typeof appRoles === 'string') {
        try { appRoles = JSON.parse(appRoles); } catch (e) { appRoles = {}; }
    }
    appRoles = appRoles || {};

    const ktRole = appRoles.kutuphanemiz?.role;

    // 🎫 Bilet üretimi — sır eksikse sessizce null (giriş yine de çalışır).
    // pv, user'ın password/password_hash'inden türetilir (ham değer bilete GİRMEZ,
    // sadece HMAC özeti); PERSONNEL_* sabitleriyle imzalanır (sliding 30g, mutlak 180g).
    const makeTicket = (role, ktRoleForTicket, ktClassesForTicket) => {
        if (!isTokenAuthAvailable()) {
            _warnSessionSecretMissingOnce();
            return null;
        }
        try {
            const pv = computeUserPv(user);
            return signToken(
                { sid: school.id, uid: user.id, role, ktRole: ktRoleForTicket, ktClasses: ktClassesForTicket, pv },
                { ttlSeconds: PERSONNEL_SLIDING_TTL_SECONDS, maxAgeSeconds: PERSONNEL_MAX_AGE_SECONDS }
            );
        } catch (ticketErr) {
            console.error('Bilet üretilemedi (staff):', ticketErr.message);
            return null;
        }
    };

    if (user.role === 'admin' || ktRole === 'admin') {
        return {
            status: 'success',
            schoolName: school.school_name,
            userName: user.full_name,
            role: user.role,
            kt_role: 'admin',
            kt_classes: ['ALL'],
            ktToken: makeTicket(user.role, 'admin', ['ALL'])
        };
    }
    if (ktRole === 'teacher') {
        // kt_classes etkin kapsamı (kt_classes ∪ class_teacher_of) döndürür — tek ortak
        // fonksiyon, getSchoolAuth'un kullandığıyla aynı.
        const effectiveClasses = exports.computeEffectiveClasses({ role: user.role, app_roles: appRoles, class_teacher_of: user.class_teacher_of });
        return {
            status: 'success',
            schoolName: school.school_name,
            userName: user.full_name,
            role: user.role,
            kt_role: 'teacher',
            kt_classes: effectiveClasses,
            ktToken: makeTicket(user.role, 'teacher', effectiveClasses)
        };
    }
    return { status: 'error', message: 'Bu panele giriş için Kütüphane yetkiniz bulunmamaktadır.' };
}

exports.login = async (req, res) => {
    try {
        const { schoolCode, schoolPass, loginType } = req.body;
        const identity = req.body.identity || req.body.username || req.body.email || req.body.phone || "";

        // -------------------------
        // 1. NÖBETÇİ GİRİŞİ (DUTY)
        // -------------------------
        if (loginType === 'duty') {
            // YENİ: hız sınırı — "hesap" burada tüm okul (kişi yok), şifre doğrulamasından
            // ÖNCE kontrol edilir ki kilitliyken doğru şifre bile denenmesin (oracle olmasın).
            const dutyAccountKey = String(schoolCode || '').trim().toLowerCase();
            const dutyIp = getTrustedClientIp(req);
            const { acctIpKey: dutyAcctIpKey, ipKey: dutyIpKey, acctKey: dutyAcctKey } = _loginRlKeys('duty', dutyAccountKey, dutyIp);

            try {
                const dutyLockCheck = rateLimiter.checkAnyLocked([dutyAcctIpKey, dutyIpKey, dutyAcctKey]);
                if (dutyLockCheck.locked) return res.json(_rateLimitedResponse(dutyLockCheck.retryAfterSeconds));
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (duty kontrol):', rlErr.message);
            }

            // YENİ: nöbetçi şifre doğrulaması artık getSchoolAuth'tan (biletsiz veri uç
            // noktalarından) tamamen ayrı, SADECE bu endpoint'in kullandığı verifyDutyLogin'de.
            // (throw = lisans hatası, deneme SAYILMAZ; null = yanlış şifre, deneme SAYILIR.)
            const dutyAuth = await verifyDutyLogin(schoolCode, schoolPass);
            if (!dutyAuth) {
                try {
                    rateLimiter.recordFailures([
                        dutyAcctIpKey && { key: dutyAcctIpKey, ...LOGIN_RL.acctIp },
                        dutyIpKey && { key: dutyIpKey, ...LOGIN_RL.ipWide },
                        { key: dutyAcctKey, ...LOGIN_RL.acctWideDuty },
                    ].filter(Boolean));
                } catch (rlErr) {
                    console.error('Hız sınırlayıcı hatası (duty kayıt):', rlErr.message);
                }
                return res.json({ status: 'error', message: 'Hatalı kurum kodu veya nöbetçi şifresi. Lütfen bilgilerinizi kontrol edip tekrar deneyin.' });
            }

            // Şifre doğru — (a) hesap+IP sayacı sıfırlanır (yalnızca bu katman, spesifikasyon böyle).
            try {
                rateLimiter.reset(dutyAcctIpKey);
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (duty sıfırlama):', rlErr.message);
            }

            const { id: schoolId, school_name, settings, userName, dutyVariant } = dutyAuth;

            // 🎫 Bilet üretimi — sır eksikse sessizce null (giriş yine de çalışır).
            let ktToken = null;
            if (isTokenAuthAvailable()) {
                try {
                    const pv = computeDutyPv(settings, dutyVariant);
                    if (dutyVariant === 'daily' || dutyVariant === 'legacy_daily') {
                        const d = todayIstanbul();
                        const endOfDaySeconds = secondsUntilEndOfIstanbulDay();
                        ktToken = signToken(
                            { sid: schoolId, uid: null, role: 'duty', ktRole: 'duty', ktClasses: ['ALL'], pv, dutyVariant, d },
                            { ttlSeconds: Math.min(DUTY_DAILY_INTRADAY_TTL_SECONDS, endOfDaySeconds), hardExp: Math.floor(Date.now() / 1000) + endOfDaySeconds }
                        );
                    } else {
                        ktToken = signToken(
                            { sid: schoolId, uid: null, role: 'duty', ktRole: 'duty', ktClasses: ['ALL'], pv, dutyVariant },
                            { ttlSeconds: DUTY_FIXED_SLIDING_TTL_SECONDS, maxAgeSeconds: DUTY_FIXED_MAX_AGE_SECONDS }
                        );
                    }
                } catch (ticketErr) {
                    console.error('Bilet üretilemedi (duty):', ticketErr.message);
                }
            } else {
                _warnSessionSecretMissingOnce();
            }

            return res.json({
                status: 'success',
                schoolName: school_name,
                userName: userName,
                role: 'duty',
                kt_role: 'duty',
                kt_classes: ['ALL'],
                ktToken
            });
        }

        // -------------------------
        // 2. PERSONEL GİRİŞİ (STAFF)
        // -------------------------
        if (loginType === 'staff') {
            console.log("🔍 GİRİŞ DENEMESİ - Kimlik:", identity, "Okul:", schoolCode);

            const { data: school } = await supabase.from('schools')
                .select('id, school_name, kt_status, kt_start_date, kt_end_date')
                .eq('school_code', schoolCode)
                .maybeSingle();

            if (!school) return res.json({ status: 'error', message: 'Geçersiz kurum kodu. Lütfen kurum kodunu kontrol edip tekrar deneyin.' });

            // =========================================================================
            // 🛑 KÜTÜPHANEMİZ PREMIUM LİSANS DUVARI (Personeller İçin Tembel Kontrol)
            // =========================================================================
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const endDate = new Date(school.kt_end_date);
            endDate.setHours(0, 0, 0, 0);
            const isExpired = endDate < today;

            if (school.kt_status !== 'active' || isExpired) {
                console.log(`🚨 LİSANS ENGELİ: ${school.school_name} kurumunun Kütüphanemiz lisansı kapalı!`);
                // Frontend'in bunu yakalayıp SweetAlert basması için 'isLicenseError' bayrağı ekliyoruz!
                return res.json({
                    status: 'error',
                    isLicenseError: true,
                    message: `Sayın <strong>${school.school_name}</strong> kullanıcısı,<br><br>Kurumunuzun <strong>Kütüphanemiz</strong> kullanım lisansı aktif değildir. Süreniz dolmuş veya sistem yöneticisi tarafından askıya alınmış olabilir.`
                });
            }
            // =========================================================================

            // YENİ: önce KİMLİKLE eşleşen satır(lar)ı bul — şifreye göre DB filtresi YOK artık.
            // (Eski kod önce .eq('password', schoolPass) ile filtreliyordu; aynı şifreyi
            // paylaşan iki personel varsa bu, yanlış kimlik/şifre kombinasyonunu kabul
            // edebiliyordu. Artık her kimlik eşleşmesine KENDİ satırının şifre kuralı uygulanır.)
            // YENİ: açık sütun listesi — users.password (düz metin) KASITLI OLARAK dışarıda;
            // burada listelenenler verifyStaffPassword/buildStaffLoginSuccess'in gerçekten
            // kullandığı alanların tamamı (id, kimlik eşleştirme alanları, rol/sınıf, hash).
            const { data: candidateUsers, error } = await supabase.from('users')
                .select('id, username, email, phone, full_name, role, app_roles, class_teacher_of, password_hash, is_active')
                .eq('school_id', school.id);

            if (error) throw error;

            const normalizedPhone = identity.replace(/\D/g, '').replace(/^0/, '').replace(/^90/, '');
            const matchedUsers = (candidateUsers || []).filter(u =>
                u.email === identity ||
                u.username === identity ||
                (normalizedPhone && u.phone === normalizedPhone)
            );

            // YENİ: hız sınırı hesabı — kimlik (e-posta/kullanıcı adı/telefon) TEK bir
            // kullanıcıyla eşleşiyorsa o kullanıcının id'si kullanılır, böylece aynı kişi
            // üç farklı kimlikle denese de TEK sayaca yazılır. Eşleşme yoksa (veya —çok
            // nadir bir veri tutarsızlığıyla— birden fazla kullanıcıyla eşleşiyorsa, ki bu
            // durum aşağıda zaten ayrı ve deneme SAYILMAYAN bir hata olarak ele alınıyor)
            // normalize edilmiş okul+kimlik metni kullanılır. Kontrol, şifre doğrulamasından
            // ÖNCE yapılır ki kilitliyken doğru şifre bile denenmesin.
            const staffAccountKey = matchedUsers.length === 1
                ? `uid:${matchedUsers[0].id}`
                : `identity:${school.id}:${String(identity || '').trim().toLowerCase()}`;
            const staffIp = getTrustedClientIp(req);
            const { acctIpKey: staffAcctIpKey, ipKey: staffIpKey, acctKey: staffAcctKey } = _loginRlKeys('staff', staffAccountKey, staffIp);

            try {
                const staffLockCheck = rateLimiter.checkAnyLocked([staffAcctIpKey, staffIpKey, staffAcctKey]);
                if (staffLockCheck.locked) return res.json(_rateLimitedResponse(staffLockCheck.retryAfterSeconds));
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (staff kontrol):', rlErr.message);
            }

            const passingUsers = [];
            for (const candidate of matchedUsers) {
                const result = await verifyStaffPassword(candidate, schoolPass);
                if (result.ok) passingUsers.push(candidate);
            }

            if (passingUsers.length > 1) {
                console.warn(`Giriş belirsizliği: schoolId=${school.id} kimlik ile birden fazla kullanıcı aynı şifreyle eşleşti.`);
                return res.json({ status: 'error', message: 'Hesap kaydınızda bir tutarsızlık tespit edildi. Lütfen yöneticinizle iletişime geçin.' });
            }

            const user = passingUsers[0];

            if (user) {
                console.log("✅ KULLANICI BULUNDU:", user.full_name);

                // YENİ: pasife alınmış kullanıcı girişi reddedilir. (Şifre dışı bir reddetme —
                // hız sınırına deneme olarak SAYILMAZ.)
                if (user.is_active === false) {
                    return res.json({ status: 'error', message: 'Bu kullanıcı hesabı pasif durumda. Lütfen yöneticinizle iletişime geçin.' });
                }

                // Şifre doğru ve hesap aktif — (a) hesap+IP sayacı sıfırlanır (yalnızca bu
                // katman, spesifikasyon böyle; rol yetkisiz olsa da şifre doğru olduğundan
                // zararı yok).
                try {
                    rateLimiter.reset(staffAcctIpKey);
                } catch (rlErr) {
                    console.error('Hız sınırlayıcı hatası (staff sıfırlama):', rlErr.message);
                }

                // YENİ: STAFF_PASSWORD_POLICY_ENFORCE_FROM açıksa, doğrulanmış (doğru) şifre
                // kurala uymuyorsa normal bilet verilmez — kısa ömürlü, tek amaçlı bir geçiş
                // bileti (purpose:'pwchange') döndürülüp kullanıcı zorunlu şifre değişimine
                // (POST /api/changeStaffPassword) yönlendirilir. Sır tanımsızsa
                // (isTokenAuthAvailable false) güvenli bir geçiş bileti üretilemez — bu
                // durumda zorlama, diğer bilet-temelli özelliklerle AYNI şekilde sessizce
                // atlanır (kapalıymış gibi davranır).
                if (_isStaffPasswordPolicyEnforced() && isTokenAuthAvailable()) {
                    const policyCheck = validateStaffPassword(schoolPass, { username: user.username });
                    if (!policyCheck.ok) {
                        let passwordChangeToken = null;
                        try {
                            const pv = computeUserPv(user);
                            const nowSec = Math.floor(Date.now() / 1000);
                            passwordChangeToken = signToken(
                                { sid: school.id, uid: user.id, role: 'pwchange', pv, purpose: 'pwchange' },
                                { ttlSeconds: PASSWORD_CHANGE_TOKEN_TTL_SECONDS, hardExp: nowSec + PASSWORD_CHANGE_TOKEN_TTL_SECONDS }
                            );
                        } catch (ticketErr) {
                            console.error('Geçiş bileti üretilemedi (pwchange):', ticketErr.message);
                            return res.json({ status: 'error', message: 'Sunucu hatası oluştu.' });
                        }
                        return res.json({
                            status: 'password_change_required',
                            message: policyCheck.message,
                            passwordChangeToken
                        });
                    }
                }

                return res.json(buildStaffLoginSuccess(user, school));
            }

            // Buraya gelindiyse: kimlik hiçbir kullanıcıyla eşleşmedi VEYA eşleşen
            // kullanıcı(lar)ın hiçbiri girilen şifreyi geçemedi — gerçek bir başarısız
            // deneme, hız sınırına SAYILIR.
            try {
                rateLimiter.recordFailures([
                    staffAcctIpKey && { key: staffAcctIpKey, ...LOGIN_RL.acctIp },
                    staffIpKey && { key: staffIpKey, ...LOGIN_RL.ipWide },
                    { key: staffAcctKey, ...LOGIN_RL.acctWideStaff },
                ].filter(Boolean));
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (staff kayıt):', rlErr.message);
            }
            return res.json({ status: 'error', message: 'Giriş bilgileri hatalı. Lütfen kimlik ve şifrenizi kontrol edip tekrar deneyin.' });
        }

        return res.json({ status: 'error', message: 'Geçersiz giriş tipi.' });

    } catch (error) {
        // Nöbetçi kısmından (getSchoolAuth) fırlatılan özel lisans hatasını yakalıyoruz
        if (error.message.startsWith('LİSANS_İPTAL|')) {
            return res.json({ status: 'error', isLicenseError: true, message: error.message.split('|')[1] });
        }
        return res.status(401).json({ status: 'error', message: error.message });
    }
};

// =========================================================================
// 🎫 YENİ: POST /api/session — SADECE bilet ile oturum doğrulama (otomatik giriş /
// sessiz yükseltme için). Eski schoolCode+schoolPass yolu bu endpoint'te KABUL
// EDİLMEZ: bilet yoksa hemen 401, getSchoolAuth'a hiç gidilmez (legacy'ye düşme
// ihtimali bile denenmez). Bilet varsa getSchoolAuth'un bilet dalı normal şekilde
// çalışır (lisans + is_active + 60sn önbellek + sessiz yenileme AYNEN uygulanır);
// biletin kendisi geçersiz/süresi dolmuşsa getSchoolAuth legacy'ye düşer ama
// schoolPass hiç gönderilmediğinden (pass=undefined) legacy de eşleşmez → null → 401.
// =========================================================================
exports.session = async (req, res) => {
    try {
        const { schoolCode } = req.body;
        const incomingToken = extractKtToken(req.headers);

        if (!incomingToken) {
            return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        }

        const auth = await getSchoolAuth(schoolCode, undefined);
        if (!auth) {
            return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        }

        // YENİ: EK SAĞLAMLAŞTIRMA — getSchoolAuth'un bilet dalından mı geçtiğini burada
        // AÇIKÇA yeniden doğruluyoruz. getSchoolAuth genel amaçlı bir fonksiyon olduğu için
        // (legacy yola da düşebilir), /api/session'ın "SADECE bilet, eski şifre yolu asla
        // kabul edilmez" garantisini getSchoolAuth'un iç mantığına güvenmek yerine burada
        // ikinci bir bağımsız kontrolle sağlıyoruz: aynı bileti tekrar doğrula, sid okulla
        // eşleşmiyorsa reddet.
        const verifyResult = verifyToken(incomingToken);
        if (!verifyResult.ok || verifyResult.payload.sid !== auth.id || verifyResult.payload.purpose === 'pwchange') {
            return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        }

        return res.json({
            status: 'success',
            schoolName: auth.school_name,
            role: auth.role,
            kt_role: auth.ktRole,
            kt_classes: auth.ktClasses
        });
    } catch (error) {
        // YENİ: diğer getSchoolAuth-tabanlı endpoint'lerin (addBook, stats, getSettings vb.)
        // genel deseniyle AYNI — login()'in özel isLicenseError dallanması burada YOK,
        // çünkü görev talimatı "diğer endpoint'lerin catch'i ne dönüyorsa onu" istiyor.
        return res.status(500).json({ status: 'error', message: error.message });
    }
};


// =========================================================================
// 🔐 KÜTÜPHANEMİZ - BİREYSEL ŞİFRE SIFIRLAMA MİMARİSİ
// =========================================================================
const emailService = require('../api/emailService');

// YENİ: crypto.randomInt kriptografik olarak güvenli bir RNG kullanır (Math.random
// tahmin edilebilir/kriptografik değildir) — aralık Math.floor(100000+Math.random()*900000)
// ile BİREBİR aynı (100000 dahil, 1000000 hariç → 100000-999999).
const generateOTP = () => crypto.randomInt(100000, 1000000).toString();

// 🕵🏻‍♂️ YARDIMCI MOTOR: Kurumu ve Personeli Bulur
// YENİ: `reason` alanı eklendi (dış mesaj metnini DEĞİŞTİRMEZ, sadece forgotPassword'ün
// "okul bulunamadı" ile "kimlik bulunamadı" durumlarını birbirinden ayırabilmesi için —
// ilki aynen kalacak, ikincisi genel bir "başarılı" mesajına dönüşecek).
const findLibraryUserForReset = async (schoolCode, identity) => {
    const { data: school } = await supabase.from('schools').select('id, school_name').eq('school_code', schoolCode).single();
    if (!school) return { error: 'Bu kurum koduna ait bir okul bulunamadı.', reason: 'school_not_found' };

    const cleanIdentity = String(identity).trim();
    const phoneIdentity = cleanIdentity.replace(/\D/g, '').replace(/^0/, '').replace(/^90/, '');

    // Kütüphanemiz'de sadece personeller (users) şifre sıfırlayabilir, nöbetçilerin sabit şifresi vardır.
    const { data: users } = await supabase.from('users').select('id, email, phone, username, reset_code, reset_expires').eq('school_id', school.id);

    const targetUser = users?.find(u =>
        u.email === cleanIdentity ||
        u.username === cleanIdentity ||
        (phoneIdentity && u.phone && u.phone.replace(/\D/g, '').replace(/^0/, '').replace(/^90/, '') === phoneIdentity)
    );

    if (!targetUser) return { error: 'Girdiğiniz bilgilere ait bir personel veya yönetici hesabı bulunamadı. (Not: Nöbetçi şifreleri sistemden sıfırlanamaz, idareden öğrenilmelidir).', reason: 'identity_not_found' };
    return { school, user: targetUser };
};

/**
 * 1️⃣ KODU GÖNDER (POST /api/forgotPassword)
 */
exports.forgotPassword = async (req, res) => {
    try {
        const { schoolCode, identity } = req.body;
        if (!schoolCode || !identity) return res.json({ status: 'error', message: 'Eksik bilgi gönderdiniz.' });

        const result = await findLibraryUserForReset(schoolCode, identity);

        // YENİ: hız sınırı hesabı — gerçek bir kullanıcı çözüldüyse uid'e göre (e-posta/
        // kullanıcı adı/telefon hangisiyle girilirse girilsin tek sayaç), çözülemediyse
        // (okul yok veya kimlik yok) normalize okul+kimlik metnine göre — her iki durumda
        // da bir anahtar üretilir ki rastgele okul kodu/kimlik denemeleri de throttlansın.
        const resetAccountKey = result.user
            ? `uid:${result.user.id}`
            : `identity:${String(schoolCode).trim().toLowerCase()}:${String(identity).trim().toLowerCase()}`;
        const resetIp = getTrustedClientIp(req);
        const { acctIpKey: resetAcctIpKey, ipKey: resetIpKey, acctKey: resetAcctKey } = _loginRlKeys('forgot', resetAccountKey, resetIp);

        try {
            const resetLockCheck = rateLimiter.checkAnyLocked([resetAcctIpKey, resetIpKey, resetAcctKey]);
            if (resetLockCheck.locked) return res.json(_rateLimitedResponse(resetLockCheck.retryAfterSeconds));
        } catch (rlErr) {
            console.error('Hız sınırlayıcı hatası (forgotPassword kontrol):', rlErr.message);
        }

        // YENİ: TÜM çağrılar sayılır (başarılı kod gönderimi dahil) — bu endpoint'te
        // korunan asıl kaynak "gerçek bir e-posta göndermek", LOGIN_RL'nin "yalnızca
        // başarısız" kuralı burada KASITLI olarak uygulanmıyor.
        try {
            rateLimiter.recordFailures([
                resetAcctIpKey && { key: resetAcctIpKey, ...RESET_REQUEST_RL.acctIp },
                resetIpKey && { key: resetIpKey, ...RESET_REQUEST_RL.ipWide },
                { key: resetAcctKey, ...RESET_REQUEST_RL.acctWide },
            ].filter(Boolean));
        } catch (rlErr) {
            console.error('Hız sınırlayıcı hatası (forgotPassword kayıt):', rlErr.message);
        }

        if (result.error) {
            // YENİ: "okul bulunamadı" AYNEN kalıyor. "kimlik bulunamadı" ise artık hesap
            // var/yok sızdırmayan GENEL bir "başarılı" yanıta dönüşüyor — gerçekte hiçbir
            // kod/e-posta gönderilmeden. maskedEmail YOK (front-end bunu nötr bir metinle
            // karşılıyor, bkz. js/api-client.js).
            if (result.reason === 'identity_not_found') {
                return res.json({ status: 'success', message: 'Eğer bu bilgilerle eşleşen ve e-postası kayıtlı bir hesap varsa, sıfırlama kodu gönderildi.' });
            }
            return res.json({ status: 'error', message: result.error });
        }

        const { school, user } = result;

        // 🛑 Çıkmaz Sokak: E-posta Yoksa! (AYNEN kalıyor — kasıtlı olarak kendi özel
        // mesajını koruyor, bkz. plan onayı.)
        if (!user.email) {
            return res.json({ status: 'error', message: 'Sisteme kayıtlı bireysel bir e-posta adresiniz bulunmuyor. Şifrenizi sıfırlamak için lütfen sistem yöneticinizle iletişime geçin.' });
        }

        const resetCode = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        const { error: updateErr } = await supabase.from('users').update({ reset_code: resetCode, reset_expires: expiresAt }).eq('id', user.id);
        if (updateErr) throw updateErr;

        const emailSent = await emailService.sendResetCodeEmail(user.email, school.school_name, resetCode);

        if (emailSent) {
            const maskedEmail = user.email.replace(/(.{2})(.*)(?=@)/, (gp1, gp2, gp3) => gp1 + gp2.replace(/./g, '*'));
            return res.json({ status: 'success', message: 'Sıfırlama kodu gönderildi.', maskedEmail });
        } else {
            return res.json({ status: 'error', message: 'E-posta gönderilirken sunucu tarafında bir hata oluştu.' });
        }
    } catch (error) {
        console.error("Şifre Sıfırlama Hatası:", error);
        return res.json({ status: 'error', message: 'Sunucu hatası oluştu.' });
    }
};

/**
 * 2️⃣ KODU DOĞRULA (POST /api/verifyResetCode)
 */
exports.verifyResetCode = async (req, res) => {
    try {
        const { schoolCode, identity, resetCode } = req.body;
        const result = await findLibraryUserForReset(schoolCode, identity);

        if (result.error) return res.json({ status: 'error', message: result.error });
        const { school, user } = result;

        // YENİ: updatePassword İLE PAYLAŞILAN tek sayaç (schoolId+uid) — kilit kontrolü
        // kod karşılaştırmasından ÖNCE.
        const resetCodeKey = `reset:code:acct:${school.id}:${user.id}`;
        try {
            const codeLockCheck = rateLimiter.checkLocked(resetCodeKey);
            if (codeLockCheck.locked) return res.json(_rateLimitedResponse(codeLockCheck.retryAfterSeconds));
        } catch (rlErr) {
            console.error('Hız sınırlayıcı hatası (verifyResetCode kontrol):', rlErr.message);
        }

        // YENİ: eşleşme kontrolü, mevcut davranışla AYNI ÖNCELİK sırasında — yanlış kod
        // her zaman "kod hatalı" döner (kodun ayrıca süresi dolmuş olsa da bunu hiç
        // açıklamaz, orijinal davranışla birebir aynı). Süresi dolmuşluk SADECE kod
        // DOĞRU eşleştiğinde ayrıca kontrol edilir.
        if (!_safeCodeEquals(user.reset_code, resetCode)) {
            try {
                const afterFail = rateLimiter.recordFailure(resetCodeKey, RESET_CODE_RL.acctWide);
                await _invalidateResetCodeIfLocked(user.id, afterFail);
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (verifyResetCode kayıt):', rlErr.message);
            }
            return res.json({ status: 'error', message: 'Girdiğiniz kod hatalı.' });
        }

        // Kod doğru ama süresi dolmuş — kullanıcı hatası DEĞİL, hız sınırına SAYILMAZ
        // (sayaç da sıfırlanmaz, dokunulmaz).
        if (new Date(user.reset_expires) < new Date()) {
            return res.json({ status: 'error', message: 'Bu kodun süresi dolmuş. Lütfen yeni bir kod isteyin.' });
        }

        // Doğru ve geçerli kod — paylaşılan sayaç sıfırlanır (updatePassword'da da aynı
        // kod tekrar kullanılacağı için orada tekrar doğrulanacak, ama birikmiş
        // yanlış-deneme geçmişi artık anlamsız).
        try {
            rateLimiter.reset(resetCodeKey);
        } catch (rlErr) {
            console.error('Hız sınırlayıcı hatası (verifyResetCode sıfırlama):', rlErr.message);
        }

        return res.json({ status: 'success', message: 'Kod başarıyla doğrulandı.' });
    } catch (error) {
        return res.json({ status: 'error', message: 'Doğrulama sırasında bir hata oluştu.' });
    }
};

/**
 * 3️⃣ ŞİFREYİ GÜNCELLE (PUT /api/updatePassword)
 */
exports.updatePassword = async (req, res) => {
    try {
        const { schoolCode, identity, resetCode, newPassword } = req.body;
        const result = await findLibraryUserForReset(schoolCode, identity);

        if (result.error) return res.json({ status: 'error', message: result.error });
        const { school, user } = result;

        // YENİ: verifyResetCode İLE PAYLAŞILAN AYNI anahtar/sayaç.
        const resetCodeKey = `reset:code:acct:${school.id}:${user.id}`;
        try {
            const codeLockCheck = rateLimiter.checkLocked(resetCodeKey);
            if (codeLockCheck.locked) return res.json(_rateLimitedResponse(codeLockCheck.retryAfterSeconds));
        } catch (rlErr) {
            console.error('Hız sınırlayıcı hatası (updatePassword kontrol):', rlErr.message);
        }

        // YENİ: mevcut tek-koşullu kontrol, verifyResetCode'daki ile AYNI önceliğe
        // bölündü — yanlış kod her zaman "geçersiz" döner (süre dolmuş olsa da bunu
        // açıklamaz), süresi dolmuşluk SADECE kod doğru eşleştiğinde kontrol edilir.
        if (!_safeCodeEquals(user.reset_code, resetCode)) {
            try {
                const afterFail = rateLimiter.recordFailure(resetCodeKey, RESET_CODE_RL.acctWide);
                await _invalidateResetCodeIfLocked(user.id, afterFail);
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (updatePassword kayıt):', rlErr.message);
            }
            return res.json({ status: 'error', message: 'Geçersiz veya süresi dolmuş işlem.' });
        }

        if (new Date(user.reset_expires) < new Date()) {
            return res.json({ status: 'error', message: 'Geçersiz veya süresi dolmuş işlem.' });
        }

        // YENİ: personel şifre kuralı — kod/bilet geçerliliğinden BAĞIMSIZ, her zaman
        // kontrol edilir (STAFF_PASSWORD_POLICY_ENFORCE_FROM tarihinden bağımsız — bu uç,
        // "şifremi unuttum" ile belirlenen YENİ şifre için zaten eskiden beri bir kural
        // (4 karakter) uyguluyordu, burada sadece o kural güncelleniyor).
        const policyCheck = validateStaffPassword(newPassword, { username: user.username });
        if (!policyCheck.ok) {
            return res.json({ status: 'error', message: policyCheck.message });
        }

        // YENİ: düz metin geçişi TAMAMLANDI — password her zaman null yazılır, tek kaynak
        // password_hash'tir.
        const newPasswordHash = await hashPassword(newPassword);

        const { error: updateErr } = await supabase
            .from('users')
            .update({ password: null, password_hash: newPasswordHash, reset_code: null, reset_expires: null })
            .eq('id', user.id);

        if (updateErr) throw updateErr;

        // Başarılı sıfırlama — paylaşılan sayaç da sıfırlanır (temizlik amaçlı; kod
        // zaten null'landı, bu anahtar bir daha bu kod için kullanılmayacak).
        try {
            rateLimiter.reset(resetCodeKey);
        } catch (rlErr) {
            console.error('Hız sınırlayıcı hatası (updatePassword sıfırlama):', rlErr.message);
        }

        return res.json({ status: 'success', message: 'Şifreniz başarıyla güncellendi.' });
    } catch (error) {
        return res.json({ status: 'error', message: 'Şifre güncellenirken bir hata oluştu.' });
    }
};

/**
 * 🔑 YENİ: POST /api/changeStaffPassword — zorunlu şifre değişimi (bkz. login() staff
 * dalındaki STAFF_PASSWORD_POLICY_ENFORCE_FROM kontrolü). SADECE login'in ürettiği
 * purpose:'pwchange' geçiş bileti ile çalışır; mevcut şifre TEKRAR SORULMAZ (kullanıcı
 * az önce login'de doğruladı). Başarıda normal (tam) ktToken üretip login'in başarı
 * yanıtıyla AYNI biçimde döner — kullanıcı tekrar giriş yapmak zorunda kalmaz.
 */
exports.changeStaffPassword = async (req, res) => {
    try {
        const { passwordChangeToken, newPassword } = req.body;
        if (!passwordChangeToken || !newPassword) {
            return res.json({ status: 'error', message: 'Eksik bilgi gönderdiniz.' });
        }

        // YENİ: hesap kavramı yok (bilet kendi kendini doğruluyor) — yalnızca IP, ve
        // SADECE geçersiz/sahte/süresi dolmuş bilet denemeleri sayılır (aşağıda). IP
        // çözülemezse (getTrustedClientIp null) bu katman fail-open'dır.
        const pwchangeIp = getTrustedClientIp(req);
        const pwchangeIpKey = pwchangeIp ? `pwchange:ip:${pwchangeIp}` : null;

        try {
            const lockCheck = rateLimiter.checkAnyLocked([pwchangeIpKey]);
            if (lockCheck.locked) return res.json(_rateLimitedResponse(lockCheck.retryAfterSeconds));
        } catch (rlErr) {
            console.error('Hız sınırlayıcı hatası (pwchange kontrol):', rlErr.message);
        }

        const _rejectInvalidTicket = () => {
            try {
                rateLimiter.recordFailures([pwchangeIpKey && { key: pwchangeIpKey, ...PWCHANGE_RL.ipWide }].filter(Boolean));
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (pwchange kayıt):', rlErr.message);
            }
            return res.json({ status: 'error', message: 'Geçersiz veya süresi dolmuş işlem.' });
        };

        const verifyResult = verifyToken(passwordChangeToken);
        if (!verifyResult.ok || verifyResult.payload.purpose !== 'pwchange' || !verifyResult.payload.uid) {
            return _rejectInvalidTicket();
        }

        const { sid, uid, pv: tokenPv } = verifyResult.payload;

        const { data: user, error } = await supabase.from('users')
            .select('id, username, full_name, role, app_roles, class_teacher_of, password_hash, is_active, school_id')
            .eq('id', uid)
            .eq('school_id', sid)
            .maybeSingle();
        if (error) throw error;
        if (!user || user.is_active === false) {
            return _rejectInvalidTicket();
        }

        // Bilet pv'si kullanıcının GÜNCEL pv'sine eşit olmalı — eşit değilse şifre bu
        // biletin verilişinden sonra (örn. aynı bilet ikinci kez kullanılmaya çalışıldığında,
        // ki birincisi zaten şifreyi değiştirip pv'yi ilerletmiştir) zaten değişmiş demektir;
        // bilet kendiliğinden ölür — ekstra bir "kullanıldı" kaydı tutmaya gerek yok.
        const currentPv = computeUserPv(user);
        if (currentPv === null || typeof tokenPv !== 'string' || tokenPv !== currentPv) {
            return _rejectInvalidTicket();
        }

        // Bilet geçerli — buradan sonrası KURAL kontrolüdür, hız sınırına SAYILMAZ.
        const policyCheck = validateStaffPassword(newPassword, { username: user.username });
        if (!policyCheck.ok) {
            return res.json({ status: 'error', message: policyCheck.message });
        }

        const newPasswordHash = await hashPassword(newPassword);
        const { error: updateErr } = await supabase.from('users')
            .update({ password: null, password_hash: newPasswordHash })
            .eq('id', uid);
        if (updateErr) throw updateErr;

        // YENİ: 60sn'lik kullanıcı-satırı önbelleği (bkz. getCachedUserAuthFields) eski pv'yi
        // taşıyor olabilir — hemen silinmezse, az sonra üretilecek YENİ (doğru) ktToken bile
        // getSchoolAuth'ta "pv uyuşmuyor" diye reddedilip kullanıcıyı anında kilitler.
        _userAuthCache.delete(uid);

        const { data: school, error: schoolError } = await supabase.from('schools')
            .select('id, school_name')
            .eq('id', sid)
            .maybeSingle();
        if (schoolError) throw schoolError;
        if (!school) return _rejectInvalidTicket();

        // YENİ: freshUser'da password ALANI YOK (user zaten password'ü hiç SELECT etmedi) —
        // yalnızca password_hash güncellenir, böylece computeUserPv burada da DB'deki
        // kalıcı durumla (password_hash kaynaklı) AYNI pv'yi üretir; taze ktToken bir
        // sonraki istekte "pv uyuşmuyor" diye anında düşmez.
        const freshUser = { ...user, password_hash: newPasswordHash };
        return res.json(buildStaffLoginSuccess(freshUser, school));
    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Şifre değiştirilirken bir hata oluştu.' });
    }
};

exports.stats = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        // 3 istatistiği aynı anda ve sadece sayı (count) olarak çekiyoruz! Çok hızlı!
        const [books, students, loans] = await Promise.all([
            supabase.from('books').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('is_active', true),
            supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('is_active', true),
            supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'borrowed')
        ]);

        // KRİTİK: Herhangi bir sorguda Supabase hatası varsa yakala ve catch bloğuna fırlat
        if (books.error) throw books.error;
        if (students.error) throw students.error;
        if (loans.error) throw loans.error;

        res.json({ status: 'success', data: { kitap: books.count || 0, ogrenci: students.count || 0, emanet: loans.count || 0 } });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};



exports.statDetails = async (req, res) => {
    try {
        const { schoolCode, schoolPass, type } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const schoolId = auth.id;

        let allData = [];
        let from = 0;
        const step = 1000;
        let fetchMore = true;

        while (fetchMore) {
            let query;
            if (type === 'emanet') {
                query = supabase.from('transactions')
                    .select('borrow_date, students(student_no, full_name, class_name, grade), books(barcode, book_name)')
                    .eq('school_id', schoolId).eq('status', 'borrowed')
                    .order('borrow_date', { ascending: false });
            } else if (type === 'kitap') {
                query = supabase.from('books')
                    .select('barcode, book_name, author, shelf, condition, page_count, category')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('book_name', { ascending: true });
            } else if (type === 'ogrenci') {
                query = supabase.from('students')
                    .select('student_no, full_name, class_name, grade')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('class_name', { ascending: true });
            }

            // Döngü her döndüğünde sayfalamayı (range) ekleyip veriyi çekiyoruz
            const { data } = await query.range(from, from + step - 1);

            if (data && data.length > 0) {
                allData.push(...data);
                from += step;
                if (data.length < step) fetchMore = false; // 1000'den az geldiyse bitti
            } else {
                fetchMore = false; // Veri hiç gelmediyse bitti
            }
        }

        res.json({ status: 'success', data: allData });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.getClasses = async (req, res) => {
    try {
        const { schoolCode, schoolPass, type } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        let allData = [];
        let from = 0;
        const step = 1000;
        let fetchMore = true;

        while (fetchMore) {
            let queryData = null;
            if (type === 'emanet') {
                const { data } = await supabase.from('transactions')
                    .select('borrow_date, students(student_no, full_name, class_name), books(barcode, book_name)')
                    .eq('school_id', schoolId).eq('status', 'borrowed')
                    .order('borrow_date', { ascending: false })
                    .range(from, from + step - 1);
                queryData = data;
            } else if (type === 'kitap') {
                const { data } = await supabase.from('books')
                    .select('barcode, book_name, author, shelf, condition')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('book_name', { ascending: true })
                    .range(from, from + step - 1);
                queryData = data;
            } else if (type === 'ogrenci') {
                const { data } = await supabase.from('students')
                    .select('student_no, full_name, class_name')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('class_name', { ascending: true })
                    .range(from, from + step - 1);
                queryData = data;
            }

            if (queryData && queryData.length > 0) {
                allData.push(...queryData);
                from += step;
                if (queryData.length < step) fetchMore = false; // 1000'den az veri geldiyse son sayfadayız demektir
            } else {
                fetchMore = false; // Veri bitti
            }
        }

        res.json({ status: 'success', data: allData });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.getClasses = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const { data } = await supabase.from('students').select('grade, class_name').eq('school_id', schoolId).eq('is_active', true);

        const grades = [...new Set(data.map(s => s.grade).filter(Boolean))].sort((a, b) => a - b);
        const classes = [...new Set(data.map(s => s.class_name).filter(Boolean))].sort();

        res.json({ status: 'success', data: { grades, classes } });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.addBook = async (req, res) => {
    try {
        const { schoolCode, schoolPass, name, author, page, type, shelf, quantity, condition, barcode, customBarcodeRange } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const loopCount = parseInt(quantity) || 1;
        const trimmedBarcode = String(barcode ?? '').trim();
        const rangeMode = !!customBarcodeRange;

        let assignedBarcodes = [];

        if (loopCount === 1 && trimmedBarcode) {
            // Adet=1, özel barkod girilmiş: benzersizlik kontrolü yapıp bu barkodu kullan
            const { data: existing, error: lookupError } = await supabase
                .from('books').select('book_name')
                .eq('school_id', schoolId).eq('barcode', trimmedBarcode)
                .maybeSingle();
            if (lookupError) throw lookupError;
            if (existing) {
                return res.json({ status: 'error', message: `Bu barkod zaten kayıtlı: ${existing.book_name}` });
            }
            assignedBarcodes = [trimmedBarcode];
        } else if (loopCount > 1 && rangeMode) {
            // Adet>1, "Başlangıç Barkodu Belirle" işaretli: ardışık aralık üret ve tek sorguda çakışma kontrolü yap
            if (!trimmedBarcode) {
                return res.json({ status: 'error', message: '"Başlangıç Barkodu Belirle" işaretliyken başlangıç barkodu girilmelidir.' });
            }
            if (!/^\d+$/.test(trimmedBarcode)) {
                return res.json({ status: 'error', message: 'Başlangıç barkodu sadece rakamlardan oluşmalıdır.' });
            }

            let startBig;
            try {
                startBig = BigInt(trimmedBarcode);
            } catch {
                return res.json({ status: 'error', message: 'Geçersiz başlangıç barkodu.' });
            }

            const candidateBarcodes = [];
            for (let i = 0; i < loopCount; i++) {
                candidateBarcodes.push((startBig + BigInt(i)).toString());
            }

            const { data: conflicts, error: conflictError } = await supabase
                .from('books').select('barcode, book_name')
                .eq('school_id', schoolId)
                .in('barcode', candidateBarcodes);
            if (conflictError) throw conflictError;

            if (conflicts && conflicts.length > 0) {
                // Aralıktaki sırayı korumak için candidateBarcodes sırasına göre filtrele
                const conflictNameByBarcode = new Map(conflicts.map(c => [c.barcode, c.book_name]));
                const conflictList = candidateBarcodes
                    .filter(bc => conflictNameByBarcode.has(bc))
                    .map(bc => ({ barcode: bc, book_name: conflictNameByBarcode.get(bc) }));

                const shown = conflictList.slice(0, 10);
                const lines = shown.map(c => `- ${c.barcode} (${c.book_name})`);
                if (conflictList.length > 10) {
                    lines.push(`...ve ${conflictList.length - 10} tane daha`);
                }

                return res.json({ status: 'error', message: `Aşağıdaki barkodlar zaten kayıtlı, işlem iptal edildi:\n${lines.join('\n')}` });
            }

            assignedBarcodes = candidateBarcodes;
        } else if (loopCount > 1 && trimmedBarcode) {
            // Arayüzde bu alan devre dışı bırakılmalıydı: API üzerinden gelen tutarsız istek
            return res.json({ status: 'error', message: 'Birden fazla adet eklerken özel barkod girmek için "Başlangıç Barkodu Belirle" seçeneğini işaretleyin.' });
        }

        if (assignedBarcodes.length === 0) {
            // Barkod girilmemiş: mevcut otomatik üretim mantığı (en büyük barkod + 1)
            const { data: lastBook } = await supabase.from('books').select('barcode').eq('school_id', schoolId).order('barcode', { ascending: false }).limit(1).single();
            let startBarcode = lastBook && lastBook.barcode ? parseInt(lastBook.barcode) : 10000;
            for (let i = 1; i <= loopCount; i++) {
                assignedBarcodes.push((startBarcode + i).toString());
            }
        }

        const newBooks = assignedBarcodes.map(bc => ({
            school_id: schoolId, barcode: bc, book_name: name,
            author: author, page_count: page, category: type, shelf: shelf, status: 'available', condition: condition || 'Yeni'
        }));

        const { error: insertError } = await supabase.from('books').insert(newBooks);
        if (insertError) throw insertError;

        res.json({ status: 'success', message: 'Eklendi', barcodes: assignedBarcodes });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.bulkAddBooks = async (req, res) => {
    try {
        const { schoolCode, schoolPass, data } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const rawItems = Array.isArray(data) ? data : [];
        const cleanedItems = rawItems
            .map(item => {
                const barcode = cleanBarcode(item.barcode);
                const book_name = String(item.book_name ?? '').trim();
                if (!barcode || !book_name) return null;
                return {
                    barcode,
                    book_name,
                    author: item.author ? String(item.author).trim() : null,
                    publisher: item.publisher ? String(item.publisher).trim() : null,
                    category: item.category ? String(item.category).trim() : null,
                    page_count: item.page_count ? (parseInt(item.page_count, 10) || null) : null,
                    shelf: item.shelf ? String(item.shelf).trim() : null,
                    condition: item.condition ? String(item.condition).trim() : 'Yeni'
                };
            })
            .filter(Boolean);

        if (cleanedItems.length === 0) {
            return res.json({ status: 'error', message: 'Yüklenecek geçerli kitap bulunamadı.' });
        }

        // 1) Gönderilen verinin kendi içinde mükerrer barkod var mı? (tüm-veya-hiç kuralı: hiçbir satır eklenmez)
        const seenBarcodes = new Map();
        const fileDuplicateBarcodes = new Set();
        cleanedItems.forEach(item => {
            if (seenBarcodes.has(item.barcode)) fileDuplicateBarcodes.add(item.barcode);
            seenBarcodes.set(item.barcode, item.book_name);
        });

        if (fileDuplicateBarcodes.size > 0) {
            return res.json({
                status: 'error',
                message: 'Gönderilen veride mükerrer barkod bulundu. Hiçbir kitap eklenmedi.',
                duplicateBarcodes: [...fileDuplicateBarcodes]
            });
        }

        // 2) Bu okulda (school_id) zaten kayıtlı barkod var mı? (savunma: frontend kontrolünü atlayan/yarış durumuna düşen istekler için)
        const uniqueBarcodes = [...new Set(cleanedItems.map(item => item.barcode))];
        const existingBooks = [];
        for (let i = 0; i < uniqueBarcodes.length; i += BARCODE_CHECK_CHUNK_SIZE) {
            const chunk = uniqueBarcodes.slice(i, i + BARCODE_CHECK_CHUNK_SIZE);
            const { data: existingRows, error: lookupError } = await supabase
                .from('books').select('barcode, book_name')
                .eq('school_id', auth.id)
                .in('barcode', chunk);
            if (lookupError) throw lookupError;
            if (existingRows) existingBooks.push(...existingRows);
        }

        if (existingBooks.length > 0) {
            return res.json({
                status: 'error',
                message: 'Bu barkodlardan bazıları okulda zaten kayıtlı. Hiçbir kitap eklenmedi.',
                existing: existingBooks
            });
        }

        const mappedData = cleanedItems.map(item => ({
            ...item,
            school_id: auth.id,
            status: 'available',
            is_active: true
        }));

        const { data: inserted, error } = await supabase.from('books').insert(mappedData).select('id');
        if (error) throw error;

        const ids = (inserted || []).map(row => row.id);
        res.json({ status: 'success', message: 'Toplu kitap ekleme başarılı', insertedCount: ids.length || mappedData.length, ids });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: EXCEL TOPLU YÜKLEME ÖNCESİ BARKOD KONTROLÜ
// ==========================================
// Verilen barkod listesinden, bu okulda (school_id) zaten kayıtlı olanları döner.
// Hiçbir ekleme/silme yapmaz, sadece okur.
exports.checkBookBarcodes = async (req, res) => {
    try {
        const { schoolCode, schoolPass, barcodes } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const cleanedBarcodes = [...new Set(
            (Array.isArray(barcodes) ? barcodes : [])
                .map(cleanBarcode)
                .filter(Boolean)
        )];

        if (cleanedBarcodes.length === 0) {
            return res.json({ status: 'success', existing: [] });
        }

        const existing = [];
        for (let i = 0; i < cleanedBarcodes.length; i += BARCODE_CHECK_CHUNK_SIZE) {
            const chunk = cleanedBarcodes.slice(i, i + BARCODE_CHECK_CHUNK_SIZE);
            const { data, error } = await supabase
                .from('books').select('barcode, book_name')
                .eq('school_id', auth.id)
                .in('barcode', chunk);
            if (error) throw error;
            if (data) existing.push(...data);
        }

        res.json({ status: 'success', existing });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: EXCEL TOPLU YÜKLEME GERİ ALMA (ROLLBACK)
// ==========================================
// Parçalı (chunk) yükleme sırasında bir parça başarısız olursa, önceki parçalarla eklenmiş
// kitapları id + school_id ile sınırlı şekilde siler. Hem id hem school_id zorunludur.
exports.bulkDeleteBooks = async (req, res) => {
    try {
        const { schoolCode, schoolPass, ids } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const idList = (Array.isArray(ids) ? ids : []).filter(Boolean);
        if (idList.length === 0) {
            return res.json({ status: 'success', deletedCount: 0 });
        }

        let deletedCount = 0;
        for (let i = 0; i < idList.length; i += BARCODE_CHECK_CHUNK_SIZE) {
            const chunk = idList.slice(i, i + BARCODE_CHECK_CHUNK_SIZE);
            const { error, count } = await supabase
                .from('books')
                .delete({ count: 'exact' })
                .eq('school_id', auth.id)
                .in('id', chunk);
            if (error) throw error;
            deletedCount += count ?? chunk.length;
        }

        res.json({ status: 'success', deletedCount });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// ORTAK DOĞRULAMA: kitapVer ve kitapVerPreflight tarafından paylaşılır
// ==========================================
// kitapVer'in eski haliyle BİREBİR aynı kontroller/mesajlar (sadece fonksiyon sınırına
// çıkarıldı). Yazma YAPMAZ. Başarılıysa { ok: true, book, student } döner; student
// nesnesi artık fotoğraf/sınıf bilgisi için de yeterli kolonları içerir (kitapVer bunların
// fazlasını kullanmıyor, davranışı değiştirmez).
async function validateKitapVerRequest(auth, { barkod, ogrNo }) {
    const schoolId = auth.id;
    const settings = auth.settings;

    if (settings.lib_open_time && settings.lib_close_time) {
        const currentHourStr = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });
        if (currentHourStr < settings.lib_open_time || currentHourStr > settings.lib_close_time) {
            return { ok: false, message: `Mesai saatleri dışındasınız. Kütüphane çalışma saatleri: ${settings.lib_open_time} - ${settings.lib_close_time}` };
        }
    }

    const [bookRes, studentRes] = await Promise.all([
        supabase.from('books').select('id, book_name, status, condition').eq('school_id', schoolId).eq('barcode', barkod).single(),
        supabase.from('students').select('id, full_name, is_active, student_no, grade, class_name, photo_path').eq('school_id', schoolId).eq('student_no', ogrNo).single()
    ]);

    const book = bookRes.data;
    const student = studentRes.data;

    if (!book) return { ok: false, message: 'Kitap bulunamadı' };
    if (book.status === 'borrowed') return { ok: false, message: 'Kitap başkasında!' };
    if (!student) return { ok: false, message: 'Öğrenci bulunamadı' };

    if (student.is_active === false && !settings.allow_lending_to_archived) {
        return { ok: false, message: 'Bu öğrenci arşivlenmiş (mezun/nakil), kitap verilemez. Ayarlar sayfasından bu kısıtlamayı kaldırabilirsiniz.' };
    }

    const { count: activeCount } = await supabase.from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('student_id', student.id)
        .eq('status', 'borrowed');

    const limit = settings.max_borrow_limit !== undefined ? settings.max_borrow_limit : 2;
    if (activeCount >= limit) {
        return { ok: false, message: `Öğrenci kitap alma sınırını aşmıştır. (Maksimum: ${limit})` };
    }

    return { ok: true, book, student };
}

exports.kitapVer = async (req, res) => {
    try {
        const { schoolCode, schoolPass, barkod, ogrNo, condition, handlerName } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const validation = await validateKitapVerRequest(auth, { barkod, ogrNo });
        if (!validation.ok) return res.json({ status: 'error', message: validation.message });
        const { book, student } = validation;

        const now = new Date();
        const today = now.toISOString();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0=Ocak, 1=Şubat, ..., 8=Eylül

        // Eğer şu an Ağustos'tan (7) önce bir aydaysak, eğitim yılı geçen sene başlamıştır.
        const startYear = currentMonth < 7 ? currentYear - 1 : currentYear;
        const academicYear = `${startYear}-${startYear + 1}`;

        // Eğer formdan durum geldiyse (seçildiyse) ekle
        let updateData = { status: 'borrowed' };
        if (condition) updateData.condition = condition;

        const [transRes, bookUpdRes] = await Promise.all([
            supabase.from('transactions').insert([{ school_id: auth.id, student_id: student.id, book_id: book.id, status: 'borrowed', borrow_date: today, academic_year: academicYear, handed_by: handlerName || 'Bilinmeyen', borrow_condition: condition || book.condition }]),
            supabase.from('books').update(updateData).eq('id', book.id)
        ]);

        // KRİTİK: Yazma işlemlerinden biri bile hata verirse sistemi try/catch'e düşür
        if (transRes.error) throw transRes.error;
        if (bookUpdRes.error) throw bookUpdRes.error;

        res.json({ status: 'success', message: `<b>"${book.book_name}"</b> adlı kitap <b>${student.full_name}</b> isimli öğrenciye verildi.` });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: KİTAP VERME ÖN-KONTROLÜ (fotoğraflı onay için) — YAZMA YAPMAZ
// ==========================================
exports.kitapVerPreflight = async (req, res) => {
    try {
        const { schoolCode, schoolPass, barkod, ogrNo } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const validation = await validateKitapVerRequest(auth, { barkod, ogrNo });
        if (!validation.ok) return res.json({ status: 'error', message: validation.message });
        const { book, student } = validation;

        let photoUrl = null;
        if (student.photo_path) {
            const urlMap = await createSignedPhotoUrlMap([student.photo_path], 300); // 5 dakika
            photoUrl = urlMap.get(student.photo_path) || null;
        }

        res.json({
            status: 'success',
            data: {
                student: {
                    fullName: student.full_name,
                    studentNo: student.student_no,
                    grade: student.grade,
                    className: student.class_name
                },
                book: {
                    bookName: book.book_name,
                    barcode: barkod
                },
                photoUrl
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};


// ==========================================
// 🕐 ORTAK YARDIMCI: İstanbul Tarih Dönüştürücüleri
// ==========================================
/**
 * Bir tarih/zaman değerini "YYYY-MM-DD" biçiminde, Türkiye (Europe/Istanbul) gününe göre döner.
 * Değer zaten düz "YYYY-MM-DD" tarih stringiyse (saat bileşeni yok) hiç dönüştürmeden aynen kullanılır
 * — zira bu durumda zaten hangi güne ait olduğu bellidir, timezone dönüşümü hataya yol açabilir.
 * Zaman damgası (timestamptz) içeren değerlerde ise Europe/Istanbul gününe çevrilir.
 * @param {string|Date|null} value
 * @returns {string|null}
 */
function istanbulDateStr(value) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}
exports.istanbulDateStr = istanbulDateStr;

/** Şu anki Türkiye gününü "YYYY-MM-DD" biçiminde döner. */
function todayIstanbul() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}
exports.todayIstanbul = todayIstanbul;

// ==========================================
// 📐 ORTAK YARDIMCI: Dinamik Gün Hesaplayıcı
// ==========================================
/**
 * Kitabın sayfa sayısına göre kt_settings.dynamic_rules tablosundan ilgili süreyi döner.
 * @param {number} pageCount - Kitabın sayfa sayısı
 * @param {object} settings  - kt_settings objesi (dynamic_rules, min_borrow_days, max_borrow_days içerir)
 * @param {'min'|'max'} mode - 'min' = iade alt sınırı (kitapAl), 'max' = gecikme üst sınırı (overdue/rapor)
 * @returns {number} Hesaplanan gün sayısı
 */
function calculateMaxDays(pageCount, settings, mode = 'max') {
    if (settings.dynamic_rules && Array.isArray(settings.dynamic_rules) && settings.dynamic_rules.length > 0) {
        const rules = [...settings.dynamic_rules].sort((a, b) => a.max_pages - b.max_pages);
        const pCount = pageCount || 0;
        const matchedRule = rules.find(r => pCount <= r.max_pages);
        const rule = matchedRule || rules[rules.length - 1]; // En büyük kural (sınırsız sayfa)
        return mode === 'min' ? (rule.min_days ?? 1) : (rule.max_days ?? 15);
    }
    // Fallback: dynamic_rules yoksa tekil ayarlara bak
    if (mode === 'min' && settings.min_borrow_days !== undefined) return settings.min_borrow_days;
    if (mode === 'max' && settings.max_borrow_days !== undefined) return parseInt(settings.max_borrow_days, 10);
    return 15; // Son çare sabit değer
}

// ==========================================
// 📅 ORTAK YARDIMCI: Akademik Yıl Tarih Dönüştürücü
// ==========================================
/**
 * "2025-2026" → { startDate: '2025-07-01', endDate: '2026-06-30' }
 * yearString boş gelirse, bulunduğumuz tarihe göre otomatik hesaplar.
 * Türkiye eğitim takvimi: 1 Temmuz başlangıç, 30 Haziran bitiş.
 */
function getAcademicYearDates(yearString) {
    let startYear, endYear;

    if (yearString && /^\d{4}-\d{4}$/.test(yearString)) {
        [startYear, endYear] = yearString.split('-').map(Number);
    } else {
        // Otomatik hesapla: Temmuz (ay indeksi 6) ve sonrası = yeni yıl başladı
        const now = new Date();
        startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
        endYear = startYear + 1;
    }

    return {
        startDate: `${startYear}-07-01`,
        endDate:   `${endYear}-06-30`
    };
}

exports.kitapAl = async (req, res) => {
    try {
        const { schoolCode, schoolPass, barkod, condition, handlerName } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const schoolId = auth.id;
        const settings = auth.settings;

        if (settings.lib_open_time && settings.lib_close_time) {
            const currentHourStr = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });
            if (currentHourStr < settings.lib_open_time || currentHourStr > settings.lib_close_time) {
                return res.json({ status: 'error', message: `Mesai saatleri dışındasınız. Kütüphane çalışma saatleri: ${settings.lib_open_time} - ${settings.lib_close_time}` });
            }
        }

        const { data: book } = await supabase.from('books').select('id, book_name, shelf, status, condition, page_count').eq('school_id', schoolId).eq('barcode', barkod).single();
        if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });
        if (book.status === 'available') return res.json({ status: 'error', message: 'Bu kitap zaten rafta.' });

        // Aktif işlemi ve öğrenciyi bul
        const { data: trans } = await supabase.from('transactions').select('id, borrow_date, student_id, students(student_no, full_name, photo_path)').eq('book_id', book.id).eq('status', 'borrowed').single();

        if (!trans) return res.json({ status: 'error', message: 'Aktif bir ödünç işlemi bulunamadı.' });

        let minDays = 1;
        if (settings.dynamic_rules && Array.isArray(settings.dynamic_rules) && settings.dynamic_rules.length > 0) {
            const rules = [...settings.dynamic_rules].sort((a, b) => a.max_pages - b.max_pages);
            const pCount = book.page_count || 0;
            const matchedRule = rules.find(r => pCount <= r.max_pages);
            minDays = matchedRule ? matchedRule.min_days : rules[rules.length - 1].min_days;
        } else if (settings.min_borrow_days !== undefined) {
            minDays = settings.min_borrow_days;
        }

        const bDate = new Date(trans.borrow_date);
        const diffDays = Math.floor(Math.abs(new Date() - bDate) / (1000 * 60 * 60 * 24));
        if (diffDays < minDays) {
            return res.json({ status: 'error', message: `Bu kitabı henüz iade edemezsiniz. ${book.page_count ? `(${book.page_count} sayfalık kitap)` : ''} En az ${minDays} gün okunmalı.` });
        }

        const today = new Date().toISOString();

        let updateData = { status: 'available' };
        if (condition) updateData.condition = condition;

        // Transaction tablosunda "received_by" güncellenerek teslim edenin adı loglanır.
        const [transRes, bookUpdRes] = await Promise.all([
            supabase.from('transactions').update({ status: 'returned', return_date: today, received_by: handlerName || 'Bilinmeyen', return_condition: condition || book.condition }).eq('id', trans.id),
            supabase.from('books').update(updateData).eq('id', book.id)
        ]);

        // KRİTİK: Yazma işlemlerinden biri bile hata verirse sistemi try/catch'e düşür
        if (transRes.error) throw transRes.error;
        if (bookUpdRes.error) throw bookUpdRes.error;

        // YENİ: Bilgi amaçlı — sadece require_photo_confirm açıksa ve fotoğraf varsa signed URL üret
        let photoUrl = null;
        const requirePhotoConfirm = settings.require_photo_confirm !== false;
        if (requirePhotoConfirm && trans.students.photo_path) {
            const urlMap = await createSignedPhotoUrlMap([trans.students.photo_path], 300); // 5 dakika
            photoUrl = urlMap.get(trans.students.photo_path) || null;
        }

        res.json({
            status: 'success',
            message: `<b>"${book.book_name}"</b> adlı kitap <b>${trans.students.full_name}</b> isimli öğrenciden teslim alındı. Lütfen kitabı rafa yerleştiriniz.`,
            raf: book.shelf,
            studentNo: trans.students.student_no,
            photoUrl,
            transactionId: trans.id,
            bookName: book.book_name,
            bookPageCount: book.page_count || null,
            trackReadingStatus: settings.track_reading_status === true
        });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.addStudent = async (req, res) => {
    try {
        const { schoolCode, schoolPass, no, name, grade, className } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!exports.isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }
        const schoolId = auth.id;

        const normalizedNo = String(no ?? '').trim();
        const { data: existingStudents, error: lookupError } = await supabase
            .from('students')
            .select('full_name')
            .eq('school_id', schoolId)
            .eq('student_no', normalizedNo)
            .eq('is_active', true)
            .limit(1);

        if (lookupError) throw lookupError;

        if (existingStudents && existingStudents.length > 0) {
            return res.json({ status: 'error', message: buildDuplicateStudentError(existingStudents[0]) });
        }

        const { error } = await supabase.from('students').insert([
            { school_id: schoolId, student_no: normalizedNo, full_name: name, grade: grade, class_name: className, is_active: true }
        ]);

        if (error) {
            if (isDuplicateStudentConstraintError(error)) {
                return res.json({ status: 'error', message: buildDuplicateStudentError({ full_name: name }) });
            }
            throw error;
        }

        res.json({ status: 'success', message: 'Öğrenci eklendi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.bulkAddStudents = async (req, res) => {
    try {
        const { schoolCode, schoolPass, data, updateExistingClass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!exports.isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }

        const rawItems = Array.isArray(data) ? data : [];
        const cleanedItems = rawItems
            .map(item => {
                const studentNo = String(item.student_no ?? item.studentNo ?? '').trim();
                const fullName = String(item.full_name ?? item.fullName ?? item.name ?? '').trim();
                if (!studentNo || !fullName) return null;
                return {
                    ...item,
                    student_no: studentNo,
                    full_name: fullName,
                    school_id: auth.id,
                    is_active: true
                };
            })
            .filter(Boolean);

        if (cleanedItems.length === 0) {
            return res.json({ status: 'success', insertedCount: 0, updatedCount: 0, duplicateCount: 0, nameMismatchCount: 0, duplicates: [], updated: [], nameMismatches: [], message: 'İçe aktarılacak öğrenci bulunamadı.' });
        }

        const uniqueNos = [...new Set(cleanedItems.map(item => item.student_no))];
        const { data: existingRows, error: lookupError } = await supabase
            .from('students')
            .select('id, student_no, full_name')
            .eq('school_id', auth.id)
            .eq('is_active', true)
            .in('student_no', uniqueNos);

        if (lookupError) throw lookupError;

        const existingMap = new Map((existingRows || []).map(row => [String(row.student_no).trim(), row]));
        const toInsert = [];
        const toUpdate = [];
        const duplicates = [];
        const nameMismatches = [];

        cleanedItems.forEach(item => {
            const studentNo = String(item.student_no).trim();
            const existing = existingMap.get(studentNo);

            if (!existing) {
                toInsert.push(item);
                return;
            }

            if (!updateExistingClass) {
                duplicates.push({ student_no: studentNo, full_name: item.full_name || 'Bilinmeyen öğrenci' });
                return;
            }

            if (normalizeStudentName(existing.full_name) === normalizeStudentName(item.full_name)) {
                toUpdate.push({ id: existing.id, student_no: studentNo, full_name: existing.full_name, grade: item.grade, class_name: item.class_name });
            } else {
                nameMismatches.push({ student_no: studentNo, existing_name: existing.full_name, file_name: item.full_name });
            }
        });

        // Mutabakat kontrolü: hiçbir satır sessizce kaybolmasın
        const categorizedTotal = toInsert.length + toUpdate.length + duplicates.length + nameMismatches.length;
        if (categorizedTotal !== cleanedItems.length) {
            throw new Error(`İçe aktarma mutabakat hatası: ${cleanedItems.length} satır işlenecekti, ${categorizedTotal} satır kategorize edildi.`);
        }

        let insertedCount = 0;
        if (toInsert.length > 0) {
            const { error } = await supabase.from('students').insert(toInsert);
            if (error) {
                if (isDuplicateStudentConstraintError(error)) {
                    const raceDuplicates = toInsert.map(item => ({ student_no: item.student_no, full_name: item.full_name }));
                    return res.json({
                        status: 'success',
                        insertedCount: 0,
                        updatedCount: 0,
                        duplicateCount: duplicates.length + raceDuplicates.length,
                        nameMismatchCount: nameMismatches.length,
                        duplicates: [...duplicates, ...raceDuplicates],
                        updated: [],
                        nameMismatches,
                        message: 'Bazı öğrenciler eşzamanlı ekleme nedeniyle mükerrer olarak atlandı.'
                    });
                }
                throw error;
            }
            insertedCount = toInsert.length;
        }

        const updated = [];
        if (toUpdate.length > 0) {
            const updateResults = await Promise.all(toUpdate.map(item =>
                supabase.from('students').update({ grade: item.grade, class_name: item.class_name }).eq('id', item.id)
            ));
            const updateError = updateResults.find(r => r.error);
            if (updateError) throw updateError.error;
            updated.push(...toUpdate.map(({ id, ...rest }) => rest));
        }

        return res.json({
            status: 'success',
            insertedCount,
            updatedCount: updated.length,
            duplicateCount: duplicates.length,
            nameMismatchCount: nameMismatches.length,
            duplicates,
            updated,
            nameMismatches,
            message: 'Toplu öğrenci ekleme başarılı'
        });
    } catch (error) {
        if (isDuplicateStudentConstraintError(error)) {
            return res.json({ status: 'success', insertedCount: 0, updatedCount: 0, duplicateCount: 1, nameMismatchCount: 0, duplicates: [{ full_name: 'Bilinmeyen öğrenci', student_no: 'Bilinmeyen numara' }], updated: [], nameMismatches: [], message: 'Mükerrer öğrenci olduğu için kayıt atlandı.' });
        }
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.updateStudent = async (req, res) => {
    try {
        const { schoolCode, schoolPass, no, newGrade, newClass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!exports.isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }
        const schoolId = auth.id;

        const { data, error } = await supabase.from('students').update({ grade: newGrade, class_name: newClass }).eq('school_id', schoolId).eq('student_no', no).select().single();
        if (!data) return res.json({ status: 'error', message: 'Öğrenci bulunamadı!' });

        res.json({ status: 'success', message: 'Öğrenci sınıfı güncellendi.', studentName: data.full_name });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.searchStudentsAdvanced = async (req, res) => {
    try {
        const { schoolCode, schoolPass, query } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!exports.isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }
        const schoolId = auth.id;

        if (!query || query.trim() === '') {
            return res.json({ status: 'success', data: [] });
        }

        // Türkçe karakter varyasyonlarını genişleten ortak arama filtresi (studentUtils)
        const orQueryString = buildStudentSearchOrFilter(query);

        const { data, error } = await supabase.from('students')
            .select('full_name, student_no, grade, class_name')
            .eq('school_id', schoolId)
            .eq('is_active', true)
            .or(orQueryString)
            .limit(20);

        if (error) throw error;

        res.json({ status: 'success', data: data || [] });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.updateStudentDetailed = async (req, res) => {
    try {
        const { schoolCode, schoolPass, oldNo, newNo, newName, newGrade, newClass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!exports.isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }
        const schoolId = auth.id;

        const { data, error } = await supabase.from('students')
            .update({ full_name: newName, student_no: newNo, grade: newGrade, class_name: newClass })
            .eq('school_id', schoolId)
            .eq('student_no', oldNo)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.json({ status: 'error', message: 'Bu öğrenci numarası sistemde zaten kayıtlı!' });
            throw error;
        }
        if (!data) return res.json({ status: 'error', message: 'Öğrenci bulunamadı!' });

        res.json({ status: 'success', message: 'Öğrenci bilgileri güncellendi.', data: data });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.sorgula = async (req, res) => {
    try {
        const { schoolCode, schoolPass, query, type } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const schoolId = auth.id;
        const q = query.trim();

        if (type === 'book') {
            const { data: book } = await supabase.from('books').select('*').eq('school_id', schoolId).eq('barcode', q).single();
            if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı.' });

            let detail = {
                name: book.book_name, code: book.barcode, author: book.author,
                status: book.status === 'borrowed' ? 'Out' : 'In', shelf: book.shelf, condition: book.condition, holder: null, holderNo: null, date: null
            };

            if (book.status === 'borrowed') {
                // JOIN işlemi: Kitap kimdeyse o öğrencinin bilgilerini de getir!
                const { data: trans } = await supabase.from('transactions')
                    .select('borrow_date, students(student_no, full_name)')
                    .eq('book_id', book.id).eq('status', 'borrowed').single();
                if (trans) {
                    detail.holder = trans.students.full_name;
                    detail.holderNo = trans.students.student_no;
                    detail.date = new Date(trans.borrow_date).toLocaleDateString("tr-TR");
                }
            }
            return res.json({ status: 'success', result: { type: 'book', data: [detail] } });
        }

        if (type === 'student') {
            const { data: student } = await supabase.from('students').select('*').eq('school_id', schoolId).eq('student_no', q).single();
            if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

            // JOIN İşlemi: Öğrencinin tüm işlemlerini ve okuduğu kitapların isimlerini/sayfalarını tek seferde çek!
            const { data: transactions } = await supabase.from('transactions')
                .select('id, borrow_date, return_date, status, reading_status, pages_read, books(barcode, book_name, page_count, condition)')
                .eq('student_id', student.id);

            // YENİ (Faz A2): "Belirtilmedi" rozeti kararı sunucuda verilir — ayar şu an açık,
            // since dolu ve kayıt since'den sonra (veya o gün) iade edilmişse ve durumu hâlâ
            // boşsa true. since boşsa (özellik eklenmeden önce açılmış okullar) hep false.
            const isAdminCaller = exports.isAdmin(auth);
            const trackReadingNow = auth.settings.track_reading_status === true;
            const trackSince = auth.settings.track_reading_status_since || null;

            let history = []; let activeBooks = []; let totalPages = 0; let completedWithPages = 0;

            if (transactions) {
                transactions.forEach(t => {
                    const pageCount = t.books.page_count || 0;
                    const isCompleted = t.status === 'returned';
                    const returnDateIst = istanbulDateStr(t.return_date);

                    // YENİ (Faz B): tutarlılık için totalReadPages/totalReadCount ayar açıkken
                    // getReport ile AYNI kuralı (computeReadPages) kullanır; kapalıyken eski hesap
                    // (tam page_count) harfiyen korunur.
                    let rowUnspecified = false;
                    if (isCompleted) {
                        if (trackReadingNow) {
                            const result = computeReadPages(t.reading_status, pageCount, t.pages_read, trackSince, returnDateIst);
                            totalPages += result.pages;
                            rowUnspecified = result.unspecified;
                            if (result.pages > 0) completedWithPages += 1;
                        } else {
                            totalPages += pageCount;
                        }
                    }

                    const record = {
                        name: t.books.book_name, code: t.books.barcode, condition: t.books.condition,
                        date: new Date(t.borrow_date).toLocaleDateString("tr-TR"),
                        returnDate: t.return_date ? new Date(t.return_date).toLocaleDateString("tr-TR") : '',
                        status: isCompleted ? 'Completed' : 'Active', pages: pageCount,
                        readingStatus: t.reading_status || null, pagesRead: t.pages_read || null,
                        unspecified: rowUnspecified
                    };
                    if (isAdminCaller) record.transactionId = t.id;

                    history.push(record);
                    if (!isCompleted) activeBooks.push(record);
                });
            }

            const totalReadCount = trackReadingNow
                ? completedWithPages
                : history.filter(h => h.status === 'Completed').length;

            return res.json({
                status: 'success', result: {
                    type: 'student',
                    data: {
                        name: student.full_name, no: student.student_no,
                        grade: student.grade, className: student.class_name,
                        activeBooks: activeBooks, history: history,
                        totalReadPages: totalPages, totalReadCount
                    }
                }
            });
        }
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};



// ==========================================
// 📖 ORTAK YARDIMCI: Okuma Durumuna Göre Sayfa Hesabı (Ayın Şampiyonları)
// ==========================================
/**
 * @param {string|null} readingStatus - 'read' | 'partially_read' | 'not_read' | null (belirtilmemiş)
 * @param {number} pageCount - kitabın toplam sayfa sayısı (page_count || 0)
 * @param {number|null} pagesRead - 'partially_read' için öğrencinin okuduğu sayfa sayısı
 * @param {string|null} since - kt_settings.track_reading_status_since ("YYYY-MM-DD") ya da null
 * @param {string|null} returnDateIst - kaydın iade günü, Europe/Istanbul'a göre ("YYYY-MM-DD") ya da null
 * @returns {{ pages: number, unspecified: boolean }}
 */
function computeReadPages(readingStatus, pageCount, pagesRead, since = null, returnDateIst = null) {
    const p = pageCount || 0;
    if (readingStatus === 'read') return { pages: p, unspecified: false };
    if (readingStatus === 'partially_read') return { pages: pagesRead || 0, unspecified: false };
    if (readingStatus === 'not_read') return { pages: 0, unspecified: false };

    // reading_status boş (NULL): since kuralına göre karar verilir.
    const sinceApplies = !!since && !!returnDateIst && returnDateIst >= since;
    if (sinceApplies) {
        // Ayar açıldıktan SONRA iade edilmiş ama durumu hiç belirtilmemiş kayıt: 0 sayfa, "belirtilmedi" sayılır.
        return { pages: 0, unspecified: true };
    }
    // since'den ÖNCEKİ iade ya da since hiç ayarlanmamış: eski davranış (tam sayfa, hiçbir sayaca girmez).
    return { pages: p, unspecified: false };
}
exports.computeReadPages = computeReadPages;

// ==========================================
// RAPORLAR (Şampiyonlar Ligi)
// ==========================================
exports.getReport = async (req, res) => {
    try {
        const { schoolCode, schoolPass, filterGrade, filterClass, filterMonth, academicYear: reqYear } = req.body;
        // YENİ: getSchoolAuth'a geçildi ki schoolId'ye ek olarak DB'den yıl da çekilebisin
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        // Nöbetçi rolü Ayın Şampiyonları'nı hiç görmemeli (UI'da gizlemek yetmez, veri de dönmesin)
        if (auth.role === 'duty') {
            return res.json({ status: 'success', data: [], hidden: true });
        }

        const schoolId = auth.id;
        const settings = auth.settings || {};
        const trackReading = settings.track_reading_status === true;
        const trackSince = settings.track_reading_status_since || null;
        const isAdminCaller = exports.isAdmin(auth);

        // YENİ: Öğretmen rolünde istemcinin filterGrade/filterClass'ına GÜVENİLMİYOR; etkin
        // sınıf kapsamı (auth.ktClasses, getSchoolAuth'ta hesaplanır) sunucuda ayrıca uygulanır.
        const effectiveClasses = auth.ktClasses || ['ALL'];
        const scopeIsAll = effectiveClasses.includes('ALL');
        const allowedScopeKeys = scopeIsAll ? null : new Set(effectiveClasses.map(classScopeKeyFromCombo).filter(Boolean));

        // YENİ: Hibrit Yıl Kaynağı — önce req.body'den, yoksa DB'den
        let academicYear = reqYear;
        if (!academicYear) {
            const { data: school } = await supabase
                .from('schools').select('active_academic_year').eq('id', schoolId).single();
            academicYear = school?.active_academic_year || null;
        }
        const { startDate, endDate } = getAcademicYearDates(academicYear);

        // YENİ: Bir kitap artık İADE EDİLDİĞİ aya/döneme/eğitim yılına sayılıyor (borrow_date değil).
        // return_date timestamptz olduğu için pencere sınırları Türkiye saatine (+03:00, DST yok)
        // açıkça sabitleniyor; aksi halde Postgres sınırları session saat dilimine göre yorumlardı.
        const startDateTimeIst = `${startDate}T00:00:00+03:00`;
        const endDateTimeIst = `${endDate}T23:59:59.999+03:00`;

        // Sadece teslim edilmiş kitapları, öğrenci ve kitap bilgileriyle getir
        let query = supabase.from('transactions')
            .select('id, return_date, reading_status, pages_read, students!inner(student_no, full_name, class_name, grade), books!inner(book_name, page_count)')
            .eq('school_id', schoolId).eq('status', 'returned')
            .gte('return_date', startDateTimeIst)
            .lte('return_date', endDateTimeIst);

        if (filterGrade && filterGrade !== 'ALL') query = query.eq('students.grade', filterGrade);
        if (filterClass && filterClass !== 'ALL') query = query.eq('students.class_name', filterClass);

        const { data: transactions, error } = await query;
        if (error) throw error; // KRİTİK: Supabase veritabanı hatalarını try/catch bloğuna düşürür

        let reportData = {};

        if (transactions && transactions.length > 0) {
            reportData = transactions.reduce((acc, t) => {
                // YENİ: Etkin sınıf kapsamı dışındaki öğrenciler atlanır (istemci filtresiyle
                // kesişim olarak çalışır — filterGrade/filterClass zaten DB sorgusunda uygulandı).
                if (!scopeIsAll && !allowedScopeKeys.has(classScopeKey(t.students.grade, t.students.class_name))) {
                    return acc;
                }

                // YENİ: Ay/dönem sınırı da artık return_date'ten, Türkiye gününe göre (istanbulDateStr).
                const returnDateIst = istanbulDateStr(t.return_date);
                const monthStr = returnDateIst ? returnDateIst.slice(5, 7) : null;

                if (filterMonth && filterMonth !== 'ALL') {
                    const fMonthStr = String(filterMonth).trim().toUpperCase();
                    if (fMonthStr === 'TERM1') {
                        if (!monthStr || !['07', '08', '09', '10', '11', '12', '01'].includes(monthStr)) return acc;
                    } else if (fMonthStr === 'TERM2') {
                        if (!monthStr || !['02', '03', '04', '05', '06'].includes(monthStr)) return acc;
                    } else {
                        const targetMonth = String(filterMonth).trim().padStart(2, '0');
                        if (monthStr !== targetMonth) return acc;
                    }
                }

                const sNo = t.students.student_no;
                if (!acc[sNo]) {
                    const cName = t.students.grade ? `${t.students.grade}/${t.students.class_name}` : t.students.class_name;
                    acc[sNo] = { no: sNo, name: t.students.full_name, className: cName, totalPage: 0, books: [] };
                    // YENİ: Bu sayaçlar yalnızca ayar AÇIKKEN eklenir; kapalıyken yanıt şekli harfiyen eskisi gibi kalır.
                    if (trackReading) {
                        acc[sNo].readCount = 0; acc[sNo].partialCount = 0; acc[sNo].notReadCount = 0; acc[sNo].unspecifiedCount = 0;
                    }
                }

                const pageCount = t.books.page_count || 0;
                let p = pageCount;
                const bookEntry = { name: t.books.book_name, page: p };

                if (trackReading) {
                    const result = computeReadPages(t.reading_status, pageCount, t.pages_read, trackSince, returnDateIst);
                    p = result.pages;
                    bookEntry.page = p;
                    bookEntry.pageCount = pageCount;
                    bookEntry.readingStatus = t.reading_status || null;
                    bookEntry.pagesRead = t.pages_read || null;
                    bookEntry.returnDate = returnDateIst;
                    bookEntry.unspecified = result.unspecified;
                    if (isAdminCaller) bookEntry.transactionId = t.id;

                    if (t.reading_status === 'read') acc[sNo].readCount += 1;
                    else if (t.reading_status === 'partially_read') acc[sNo].partialCount += 1;
                    else if (t.reading_status === 'not_read') acc[sNo].notReadCount += 1;
                    else if (result.unspecified) acc[sNo].unspecifiedCount += 1;
                }

                acc[sNo].totalPage += p;
                acc[sNo].books.push(bookEntry);

                return acc;
            }, {});
        }

        let sortedReport = Object.values(reportData).sort((a, b) => b.totalPage - a.totalPage);
        res.json({ status: 'success', data: sortedReport });

    } catch (error) { res.status(500).json({ status: 'error', message: 'Sunucu Hatası: ' + (error.message || JSON.stringify(error) || error) }); }
};

// --- YENİ EKLENEN: Emanet Raporu Controller ---
exports.getBorrowedReport = async (req, res) => {
    try {
        const { schoolCode, schoolPass, filterGrade, filterClass, filterStatus } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const schoolId = auth.id;
        const settings = auth.settings; // dynamic_rules buradan gelir

        // YENİ: Öğretmen rolünde istemcinin filterGrade/filterClass'ına GÜVENİLMİYOR; etkin
        // sınıf kapsamı (auth.ktClasses, getSchoolAuth'ta hesaplanır) sunucuda ayrıca uygulanır.
        const effectiveClasses = auth.ktClasses || ['ALL'];
        const scopeIsAll = effectiveClasses.includes('ALL');
        const allowedScopeKeys = scopeIsAll ? null : new Set(effectiveClasses.map(classScopeKeyFromCombo).filter(Boolean));

        // Emanetteki ('borrowed') kitapları çek
        let query = supabase.from('transactions')
            .select('borrow_date, students!inner(student_no, full_name, class_name, grade), books!inner(barcode, book_name, page_count)')
            .eq('school_id', schoolId).eq('status', 'borrowed');

        if (filterGrade && filterGrade !== 'ALL') query = query.eq('students.grade', filterGrade);
        if (filterClass && filterClass !== 'ALL') query = query.eq('students.class_name', filterClass);

        const { data: transactions, error } = await query;
        if (error) throw error;

        let reportData = {};
        const today = new Date();

        if (transactions && transactions.length > 0) {
            transactions.forEach(t => {
                // YENİ: Etkin sınıf kapsamı dışındaki öğrenciler atlanır (istemci filtresiyle
                // kesişim olarak çalışır — filterGrade/filterClass zaten DB sorgusunda uygulandı).
                if (!scopeIsAll && !allowedScopeKeys.has(classScopeKey(t.students.grade, t.students.class_name))) {
                    return;
                }

                const borrowDate = new Date(t.borrow_date);
                const diffTime = Math.abs(today - borrowDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                // Her kitap için sayfa sayısına göre dinamik max gün hesapla
                const maxDays = calculateMaxDays(t.books.page_count, settings, 'max');

                // Filtre: Sadece gecikenler seçilmişse ve gecikmemişse pas geç
                if (filterStatus === 'OVERDUE' && diffDays <= maxDays) return;

                const sNo = t.students.student_no;
                if (!reportData[sNo]) {
                    const cName = t.students.grade ? `${t.students.grade}/${t.students.class_name}` : t.students.class_name;
                    reportData[sNo] = {
                        no: sNo,
                        name: t.students.full_name,
                        className: cName,
                        grade: t.students.grade || '',
                        subClass: t.students.class_name || '',
                        oldestDate: borrowDate,
                        hasOverdue: false,
                        books: []
                    };
                } else {
                    if (borrowDate < reportData[sNo].oldestDate) {
                        reportData[sNo].oldestDate = borrowDate;
                    }
                }

                let statusText = `${diffDays} Gündür Emanette`;
                let statusColor = '#0ea5e9'; // Mavi
                if (diffDays > maxDays) {
                    statusText = `Gecikti (${diffDays - maxDays} Gün)`;
                    statusColor = '#ef4444'; // Kırmızı
                    reportData[sNo].hasOverdue = true;
                }

                reportData[sNo].books.push({ name: t.books.book_name, barcode: t.books.barcode, statusText, statusColor });
            });
        }

        // Sınıf > Şube > Eski Tarih sıralaması (Deneliz ile aynı)
        const sortedData = Object.values(reportData).sort((a, b) => {
            if (a.grade !== b.grade) return String(a.grade).localeCompare(String(b.grade), 'tr', { numeric: true });
            if (a.subClass !== b.subClass) return String(a.subClass).localeCompare(String(b.subClass), 'tr');
            return a.oldestDate - b.oldestDate;
        });

        res.json({ status: 'success', data: sortedData });

    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Sunucu Hatası: ' + (error.message || JSON.stringify(error) || error) });
    }
};

// ==========================================
// GECİKEN KİTAPLAR (15 Günü Aşanlar)
// ==========================================
exports.overdue = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const schoolId = auth.id;
        const settings = auth.settings; // dynamic_rules buradan gelir

        const { data: activeTrans, error } = await supabase.from('transactions')
            .select('borrow_date, students!inner(full_name, grade, class_name), books!inner(barcode, book_name, page_count)')
            .eq('school_id', schoolId).eq('status', 'borrowed');

        if (error) throw error; // KRİTİK: Supabase hatalarını yakala ve try/catch'e düşür

        const now = new Date();
        let list = [];

        if (activeTrans && activeTrans.length > 0) {
            list = activeTrans.reduce((acc, t) => {
                const bDate = new Date(t.borrow_date);
                const diffDays = Math.ceil(Math.abs(now - bDate) / (1000 * 60 * 60 * 24));
                const maxDays = calculateMaxDays(t.books.page_count, settings, 'max');

                if (diffDays > maxDays) {
                    const sName = t.students.grade ? `${t.students.full_name} (${t.students.grade}/${t.students.class_name})` : t.students.full_name;
                    acc.push({ code: t.books.barcode, student: sName, book: t.books.book_name, date: bDate.toLocaleDateString("tr-TR") });
                }
                return acc;
            }, []);
        }
        res.json({ status: 'success', data: list });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// GERİ AL (Yanlışlıkla Verilen/Alınan Kitaplar)
// ==========================================
exports.undo = async (req, res) => {
    try {
        const { schoolCode, schoolPass, type, bookCode, studentNo } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const { data: book } = await supabase.from('books').select('id').eq('school_id', schoolId).eq('barcode', bookCode).single();
        const { data: student } = await supabase.from('students').select('id').eq('school_id', schoolId).eq('student_no', studentNo).single();

        if (!book || !student) return res.json({ status: 'error', message: 'Kitap veya öğrenci bulunamadı.' });

        if (type === 'ver') {
            // Kitap verme işlemini iptal et: İşlemi sil, kitabı 'available' yap
            const { data: trans } = await supabase.from('transactions').select('id').eq('book_id', book.id).eq('student_id', student.id).eq('status', 'borrowed').single();
            if (trans) {
                await supabase.from('transactions').delete().eq('id', trans.id);
                await supabase.from('books').update({ status: 'available' }).eq('id', book.id);
            }
        }
        else if (type === 'al') {
            // Kitap alma işlemini iptal et: En son teslimi bul, tekrar 'borrowed' yap
            const { data: trans } = await supabase.from('transactions').select('id').eq('book_id', book.id).eq('student_id', student.id).eq('status', 'returned').order('return_date', { ascending: false }).limit(1).single();
            if (trans) {
                await supabase.from('transactions').update({ status: 'borrowed', return_date: null, return_condition: null, received_by: null, reading_status: null, pages_read: null, reading_status_by: null, reading_status_at: null }).eq('id', trans.id);
                await supabase.from('books').update({ status: 'borrowed' }).eq('id', book.id);
            }
        }
        res.json({ status: 'success', message: 'İşlem başarıyla geri alındı.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// OKUMA DURUMU (İade Sonrası Öğrenci Beyanı)
// ==========================================
exports.setReadingStatus = async (req, res) => {
    try {
        const { schoolCode, schoolPass, handlerName, transactionId, readingStatus, pagesRead } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (auth.settings.track_reading_status !== true) {
            return res.json({ status: 'error', message: 'Okuma durumu takibi bu okulda açık değil.' });
        }

        const isAdminCaller = exports.isAdmin(auth);

        // YENİ (Faz A2): 'clear' (durumu temizle) yalnızca yönetici için.
        if (readingStatus === 'clear' && !isAdminCaller) {
            return res.json({ status: 'error', message: 'Bu işlem için yetkiniz yok.' });
        }

        if (!['read', 'partially_read', 'not_read', 'clear'].includes(readingStatus)) {
            return res.json({ status: 'error', message: 'Geçersiz okuma durumu.' });
        }

        const { data: trans } = await supabase.from('transactions')
            .select('id, status, return_date, reading_status, books(page_count)')
            .eq('id', transactionId).eq('school_id', auth.id).single();

        if (!trans) return res.json({ status: 'error', message: 'İşlem bulunamadı.' });
        if (trans.status !== 'returned') return res.json({ status: 'error', message: 'Bu kitap henüz iade edilmemiş.' });

        const newReadingStatus = readingStatus === 'clear' ? null : readingStatus;
        let pages_read = null;
        if (readingStatus === 'partially_read') {
            const pageCount = trans.books?.page_count || 0;
            if (pageCount < 1) {
                return res.json({ status: 'error', message: 'Bu kitabın sayfa sayısı tanımlı olmadığı için "Kısmen okudum" seçilemez.' });
            }
            const p = parseInt(pagesRead, 10);
            if (!Number.isInteger(p) || p < 1 || p > pageCount) {
                return res.json({ status: 'error', message: `Okunan sayfa sayısı 1 ile ${pageCount} arasında olmalı.` });
            }
            pages_read = p;
        }

        let updateQuery = supabase.from('transactions').update({
            reading_status: newReadingStatus,
            pages_read: pages_read,
            reading_status_by: handlerName || 'Bilinmeyen',
            reading_status_at: new Date().toISOString()
        }).eq('id', trans.id).eq('school_id', auth.id);

        // Yönetici dışındaki roller (nöbetçi/öğretmen) yalnızca BUGÜN iade edilmiş, henüz durumu
        // belirlenmemiş (reading_status NULL) VE daha önce bir yönetici tarafından dokunulmamış
        // (reading_status_at NULL) bir kayıtta ilk kez yazabilir; sonradan kurcalanamaz. Yönetici
        // bir kaydı düzelttiğinde/temizlediğinde reading_status_at dolacağı için nöbetçi/öğretmen
        // o kaydı bir daha yazamaz. Admin, kayıt iade edilmiş olduğu sürece her zaman düzeltebilir.
        if (!isAdminCaller) {
            const today = todayIstanbul();
            const returnDateIst = istanbulDateStr(trans.return_date);
            if (returnDateIst !== today) {
                return res.json({ status: 'error', message: 'Bu işlem bugün yapılmadığı için okuma durumu artık buradan değiştirilemez.' });
            }
            updateQuery = updateQuery.is('reading_status', null).is('reading_status_at', null);
        }

        const { data: updated, error } = await updateQuery.select('id');
        if (error) throw error;

        if (!updated || updated.length === 0) {
            return res.json({ status: 'error', message: 'Bu kayıt zaten belirlenmiş ya da yönetici tarafından düzenlenmiş.' });
        }

        res.json({ status: 'success', message: readingStatus === 'clear' ? 'Okuma durumu temizlendi.' : 'Okuma durumu kaydedildi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: GLOBAL KİTAP ÖNERİLERİ
// ==========================================
exports.getGlobalBooks = async (req, res) => {
    try {
        // Frontend'den gelen arama terimini alıyoruz (GET veya POST destekli)
        const query = req.query.q || req.body.q;

        // Eğer arama terimi yoksa veya çok kısaysa boş dön (sistemi yorma)
        if (!query || query.trim().length < 2) {
            return res.json({ status: 'success', data: [] });
        }

        const baseQuery = query.trim().replace(/,/g, '');

        // --- VARYASYON TEKNİĞİ BAŞLANGICI ---
        const variations = new Set();
        variations.add(baseQuery);
        variations.add(baseQuery.toLocaleLowerCase('tr-TR'));
        variations.add(baseQuery.toLocaleUpperCase('tr-TR'));
        variations.add(baseQuery.toLowerCase());
        variations.add(baseQuery.toUpperCase());
        variations.add(baseQuery.replace(/i/g, 'ı').replace(/İ/g, 'I'));
        variations.add(baseQuery.replace(/ı/g, 'i').replace(/I/g, 'İ'));
        variations.add(baseQuery.toLocaleUpperCase('tr-TR').replace(/İ/g, 'I'));

        const validVariations = Array.from(variations).filter(v => v);
        const orQueryString = validVariations.map(v => `book_name.ilike.%${v}%`).join(',');
        // --- VARYASYON TEKNİĞİ BİTİŞİ ---

        // Artık while döngüsü YOK. Sadece eşleşenleri ve maksimum 50 tanesini çekiyoruz.
        const { data, error } = await supabase
            .from('books')
            .select('book_name')
            .neq('is_active', false)
            .or(orQueryString)
            .limit(50);

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.json({ status: 'success', data: [] });
        }

        // Benzersizleştir ve sırala
        const uniqueBooks = [...new Set(data.map(b => b.book_name))].sort();
        res.json({ status: 'success', data: uniqueBooks });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: SOFT-DELETE (ARŞİVLEME)
// ==========================================
exports.archiveRecord = async (req, res) => {
    try {
        const { schoolCode, schoolPass, type, code } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (type === 'book') {
            const { data: book } = await supabase.from('books').select('status').eq('school_id', schoolId).eq('barcode', code).single();
            if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı.' });
            if (book.status === 'borrowed') return res.json({ status: 'error', message: 'Kitap şu an öğrencide, arşive alınamaz!' });

            await supabase.from('books').update({ is_active: false }).eq('school_id', schoolId).eq('barcode', code);
        } else if (type === 'student') {
            const { data: student } = await supabase.from('students').select('id').eq('school_id', schoolId).eq('student_no', code).single();
            if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

            const { count: activeTransCount } = await supabase.from('transactions')
                .select('id', { count: 'exact', head: true })
                .eq('school_id', schoolId)
                .eq('student_id', student.id)
                .eq('status', 'borrowed');

            if (activeTransCount && activeTransCount > 0) {
                return res.json({ status: 'error', message: 'Bu öğrencinin üzerinde teslim edilmemiş kitap bulunuyor. Önce kitapları iade almalısınız!' });
            }

            await supabase.from('students').update({ is_active: false }).eq('id', student.id);
        } else {
            return res.json({ status: 'error', message: 'Geçersiz işlem tipi.' });
        }

        res.json({ status: 'success', message: 'Kayıt başarıyla arşive gönderildi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// AYARLAR (YÖNETİM PANELİ)
// ==========================================
exports.getSettings = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        // YENİ: active_academic_year ve logo_url'ü de döndürmek için schools tablosunu ayrıca sorgula
        const { data: school } = await supabase
            .from('schools')
            .select('active_academic_year, logo_url')
            .eq('id', auth.id)
            .single();

        // YENİ (güvenlik): kt_settings'in TAMAMI (şifreler, magic_token, nöbetçi isimleri dahil)
        // sadece yöneticiye dönsün. Öğretmen/nöbetçi arayüzünün gerçekte ihtiyaç duyduğu tek
        // şeyler header logosu ve require_photo_confirm bayrağı — diğer tüm kurallar zaten
        // sunucu tarafında (kitapVer/kitapAl) ayrıca zorlanıyor, istemcide bilinmesi gerekmiyor.
        if (!exports.isAdmin(auth)) {
            return res.json({
                status: 'success',
                data: {
                    logo_url: school?.logo_url || null,
                    require_photo_confirm: auth.settings.require_photo_confirm
                }
            });
        }

        res.json({
            status: 'success',
            data: {
                ...auth.settings,
                active_academic_year: school?.active_academic_year || null,
                logo_url: school?.logo_url || null
            }
        });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: OKUL LOGOSU YÜKLEME
// ==========================================
exports.uploadSchoolLogo = async (req, res) => {
    try {
        const schoolCode = req.headers['x-school-code'];
        const fileExt = String(req.headers['x-file-ext'] || 'png').toLowerCase();

        const auth = await getSchoolAuth(schoolCode);
        if (!auth || !exports.isAdmin(auth)) {
            return res.json({ success: false, message: 'Yetkisiz işlem.' });
        }

        const fileName = `logo_${auth.id}.${fileExt}`;
        const fileBuffer = req.body;

        const { error: uploadError } = await supabase.storage
            .from('school_logos')
            .upload(fileName, fileBuffer, {
                contentType: req.headers['content-type'] || 'application/octet-stream',
                upsert: true,
                cacheControl: '3600'
            });

        if (uploadError) {
            return res.json({ success: false, message: `Logo yüklenemedi: ${uploadError.message}` });
        }

        const { data: publicUrlData } = supabase.storage.from('school_logos').getPublicUrl(fileName);
        const logoUrl = publicUrlData.publicUrl;

        const { error: updateError } = await supabase.from('schools')
            .update({ logo_url: logoUrl })
            .eq('id', auth.id);
        if (updateError) throw updateError;

        res.json({ success: true, logo_url: logoUrl });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const { schoolCode, schoolPass, settings } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!(auth.role === 'admin' || auth.app_roles?.kutuphanemiz?.role === 'admin')) {
            return res.json({ status: 'error', message: 'Bu işlem için yetkiniz yok.' });
        }

        const previousTrackReading = auth.settings.track_reading_status === true;
        const updatedSettings = { ...auth.settings, ...settings };

        // YENİ (Faz A2): track_reading_status_since YALNIZCA sunucu yazar; istemciden gelen
        // değer (varsa) her zaman yok sayılır. Kapalı/tanımsız -> açık geçişinde bugünün
        // tarihi yazılır; kapatılınca alan silinir; açık kalıyorsa eski değer korunur.
        const newTrackReading = updatedSettings.track_reading_status === true;
        if (newTrackReading && !previousTrackReading) {
            updatedSettings.track_reading_status_since = todayIstanbul();
        } else if (!newTrackReading) {
            updatedSettings.track_reading_status_since = null;
        } else {
            updatedSettings.track_reading_status_since = auth.settings.track_reading_status_since || null;
        }

        Object.keys(updatedSettings).forEach(key => {
            if (updatedSettings[key] === null) delete updatedSettings[key];
        });

        const { error } = await supabase.from('schools').update({ kt_settings: updatedSettings }).eq('id', auth.id);
        if (error) throw error;

        res.json({ status: 'success', message: 'Ayarlar güncellendi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: ÖĞRENCİ NUMARASI İLE BULMA (NÖBETÇİ İÇİN)
// ==========================================
exports.getStudentByNo = async (req, res) => {
    try {
        const { schoolCode, schoolPass, studentNo } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const { data: student } = await supabase.from('students')
            .select('full_name')
            .eq('school_id', auth.id)
            .eq('student_no', studentNo)
            .single();

        if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

        res.json({ status: 'success', data: student });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: İŞLEM GEÇMİŞİ LOGLARI (OMNI-SEARCH İÇİN)
// ==========================================
exports.getLogs = async (req, res) => {
    try {
        const { schoolCode, schoolPass, filterDate, academicYear: reqYear } = req.body;
        // YENİ: getSchoolAuth'a geçildi ki DB'den yıl da çekilebisin
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const schoolId = auth.id;

        // YENİ: Hibrit Yıl Kaynağı — önce req.body'den, yoksa DB'den
        let academicYear = reqYear;
        if (!academicYear) {
            const { data: school } = await supabase
                .from('schools').select('active_academic_year').eq('id', schoolId).single();
            academicYear = school?.active_academic_year || null;
        }
        const { startDate, endDate } = getAcademicYearDates(academicYear);

        let query = supabase.from('transactions')
            .select('id, created_at, borrow_date, return_date, status, handed_by, received_by, academic_year, borrow_condition, return_condition, students(student_no, full_name, grade, class_name), books(barcode, book_name)')
            .eq('school_id', schoolId)
            .order('created_at', { ascending: false })
            .limit(100)
            .gte('borrow_date', startDate)   // YENİ: Akademik yıl başlangıcı
            .lte('borrow_date', endDate);    // YENİ: Akademik yıl bitişi

        if (filterDate) {
            query = query.gte('created_at', `${filterDate}T00:00:00`).lte('created_at', `${filterDate}T23:59:59`);
        }

        const { data: logs, error } = await query;
        if (error) throw error;

        res.json({ status: 'success', data: logs || [] });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: ÖĞRETMEN YETKİLENDİRME (ADMİN İÇİN)
// ==========================================
exports.getTeachers = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);

        if (!auth || auth.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Yetkisiz erişim. Sadece yöneticiler öğretmen listeleyebilir.' });
        }

        const { data: teachers, error } = await supabase.from('users')
            .select('id, full_name, username, email, phone, app_roles, class_teacher_of')
            .eq('school_id', auth.id)
            .eq('role', 'teacher');

        if (error) throw error;

        res.json({ status: 'success', data: teachers });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// YENİ: Deneliz'in class_teacher_of sütunu için tek bir girdi doğrular/normalize eder
// ("8-a" -> "8-A"). Biçime uymayan/boş girdi null döner (sessizce atılır, asla çökmez).
function normalizeClassTeacherOfEntry(raw) {
    if (typeof raw !== 'string') return null;
    const upper = raw.trim().toLocaleUpperCase('tr-TR');
    if (!upper) return null;
    if (!/^[0-9A-ZÇĞİÖŞÜ]+-[A-ZÇĞİÖŞÜ]+$/.test(upper)) return null;
    return upper;
}

exports.saveTeacher = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id, fullName, username, email, phone, password, ktRole, ktClasses, classTeacherOf } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);

        if (!auth || auth.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Yetkisiz erişim. Sadece yöneticiler yetki değiştirebilir.' });
        }

        const appRolesPayload = {
            kutuphanemiz: {
                role: ktRole,
                classes: ktClasses || []
            }
        };

        // YENİ: class_teacher_of yalnızca istemci bunu bir DİZİ olarak gönderdiyse (yani
        // kullanıcı o bölümde bilinçli bir değişiklik yaptıysa) yazılacak alanlara eklenir;
        // hiç gelmezse (undefined) ne updateData'ya ne insertData'ya eklenir — Deneliz'in
        // verisi dokunulmadan kalır.
        let classTeacherOfToWrite;
        if (Array.isArray(classTeacherOf)) {
            classTeacherOfToWrite = [...new Set(classTeacherOf.map(normalizeClassTeacherOfEntry).filter(Boolean))];
        }

        if (id) {
            // GÜNCELLEME İŞLEMİ
            const { data: user, error: fetchError } = await supabase.from('users')
                .select('app_roles')
                .eq('id', id)
                .eq('school_id', auth.id)
                .single();

            if (fetchError || !user) throw new Error("Öğretmen bulunamadı.");

            let mergedRoles = user.app_roles;
            if (typeof mergedRoles === 'string') {
                try { mergedRoles = JSON.parse(mergedRoles); } catch (e) { mergedRoles = {}; }
            }
            mergedRoles = mergedRoles || {};
            mergedRoles.kutuphanemiz = appRolesPayload.kutuphanemiz;

            const updateData = {
                full_name: fullName,
                username: username || null,
                email: email || null,
                phone: phone || null,
                app_roles: mergedRoles
            };

            // YENİ: şifre gönderildiyse yalnızca password_hash yazılır — düz metin geçişi
            // TAMAMLANDI, password HER ZAMAN null yazılır (eski satırda düz metin dolu
            // kalmışsa bile bu güncellemeyle temizlenir). Gönderilmediyse ikisine de dokunulmaz.
            const passwordChanged = !!(password && password.trim() !== '');
            if (passwordChanged) {
                // YENİ: kaydedilecek kullanıcı adı (bu istekle yazılan username, DB'deki eski
                // değer değil) referans alınır — "şifre kullanıcı adıyla aynı olamaz" kontrolü.
                const policyCheck = validateStaffPassword(password, { username: username || null });
                if (!policyCheck.ok) throw new Error(policyCheck.message);

                updateData.password = null;
                updateData.password_hash = await hashPassword(password);
            }

            if (classTeacherOfToWrite !== undefined) {
                updateData.class_teacher_of = classTeacherOfToWrite;
            }

            const { error: updateError } = await supabase.from('users')
                .update(updateData)
                .eq('id', id);

            if (updateError) throw updateError;
            return res.json({ status: 'success', message: 'Öğretmen başarıyla güncellendi.', passwordChanged });

        } else {
            // YENİ EKLEME İŞLEMİ
            if (!password) throw new Error("Yeni eklerken şifre belirlemek zorunludur.");

            const policyCheck = validateStaffPassword(password, { username: username || null });
            if (!policyCheck.ok) throw new Error(policyCheck.message);

            const insertData = {
                school_id: auth.id,
                role: 'teacher',
                full_name: fullName,
                username: username || null,
                email: email || null,
                phone: phone || null,
                password: null,
                password_hash: await hashPassword(password),
                app_roles: appRolesPayload
            };

            if (classTeacherOfToWrite !== undefined) {
                insertData.class_teacher_of = classTeacherOfToWrite;
            }

            const { error: insertError } = await supabase.from('users')
                .insert([insertData]);

            if (insertError) {
                if (insertError.code === '23505') throw new Error("Bu kullanıcı bilgisi sistemde zaten kayıtlı.");
                throw insertError;
            }

            return res.json({ status: 'success', message: 'Öğretmen başarıyla eklendi.' });
        }

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: KİTAP ARAMA
// ==========================================
exports.searchBooks = async (req, res) => {
    try {
        const { schoolCode, schoolPass, query } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!query || query.trim().length < 1) {
            return res.json({ status: 'error', message: 'Arama terimi gereklidir.' });
        }

        // Arama terimini al ve Supabase OR sintaksını (virgüllerle çalışır) bozmaması için kelime içindeki olası virgülleri temizle
        const baseQuery = query.trim().replace(/,/g, '');

        // --- VARYASYON TEKNİĞİ BAŞLANGICI ---
        const variations = new Set(); // Set kullanıyoruz ki aynı kelimeler tekrar eklenmesin

        // 1. Orijinal hali
        variations.add(baseQuery);
        // 2. Tamamen küçük harf (Türkçe - ı, i vb. destekli)
        variations.add(baseQuery.toLocaleLowerCase('tr-TR'));
        // 3. Tamamen büyük harf (Türkçe - I, İ vb. destekli)
        variations.add(baseQuery.toLocaleUpperCase('tr-TR'));
        // 4. Standart İngilizce dönüşümler (Supabase ILIKE için güvenlik ağı)
        variations.add(baseQuery.toLowerCase());
        variations.add(baseQuery.toUpperCase());

        // 5. Çok sık yapılan I/i/ı hataları için çapraz dönüşümler
        // Örn: "bir" yazıldıysa "bır" da aransın, "BİR" yazıldıysa "BIR" da aransın.
        variations.add(baseQuery.replace(/i/g, 'ı').replace(/İ/g, 'I'));
        variations.add(baseQuery.replace(/ı/g, 'i').replace(/I/g, 'İ'));
        variations.add(baseQuery.toLocaleUpperCase('tr-TR').replace(/İ/g, 'I'));

        // Set'i standart bir Array'e çevir ve boş olanları temizle
        const validVariations = Array.from(variations).filter(v => v);

        // Supabase için dinamik OR sorgusu oluştur
        // Çıktı Örneği: barcode.ilike.%bir%,book_name.ilike.%bir%,barcode.ilike.%BİR%,book_name.ilike.%BİR%
        const orQueryString = validVariations
            .map(v => `barcode.ilike.%${v}%,book_name.ilike.%${v}%`)
            .join(',');
        // --- VARYASYON TEKNİĞİ BİTİŞİ ---

        const { data: books, error } = await supabase.from('books')
            .select('id, barcode, book_name, author, publisher, shelf, category, page_count, condition, status')
            .eq('school_id', auth.id)
            .eq('is_active', true)
            .or(orQueryString)
            .limit(20);

        if (error) throw error;

        // status alanını kullanıcı dostu hale getir
        const mapped = (books || []).map(b => ({
            ...b,
            status: b.status === 'borrowed' ? 'Emanette' : 'Rafta'
        }));

        res.json({ status: 'success', data: mapped });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
// ==========================================
// YENİ: KİTAP GÜNCELLEME
// ==========================================
exports.updateBook = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id, barcode, book_name, author, publisher, shelf, category, page_count, condition } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!id) throw new Error('Güncellenecek kitap ID\'si belirtilmedi.');
        if (!book_name || !barcode) throw new Error('Kitap Adı ve Barkod zorunludur.');

        const updateData = {
            barcode,
            book_name,
            author: author || null,
            publisher: publisher || null,
            shelf: shelf || null,
            category: category || null,
            page_count: page_count ? parseInt(page_count) : null,
            condition: condition || 'Yeni'
        };

        const { error } = await supabase.from('books')
            .update(updateData)
            .eq('id', id)
            .eq('school_id', auth.id);

        if (error) throw error;

        res.json({ status: 'success', message: 'Kitap başarıyla güncellendi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: KİTAP SİLME (SADECE ADMİN)
// ==========================================
exports.deleteBook = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);

        if (!auth || auth.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Yetkisiz erişim. Sadece yöneticiler kitap silebilir.' });
        }

        if (!id) throw new Error('Silinecek kitap ID\'si belirtilmedi.');

        const { error } = await supabase.from('books')
            .delete()
            .eq('id', id)
            .eq('school_id', auth.id);

        if (error) throw error;

        res.json({ status: 'success', message: 'Kitap sistemden tamamen silindi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: ÖĞRETMEN SİLME (SADECE ADMİN)
// ==========================================
exports.deleteTeacher = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);

        if (!auth || auth.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Yetkisiz erişim. Sadece yöneticiler öğretmen silebilir.' });
        }

        if (!id) throw new Error("Silinecek öğretmen ID\'si belirtilmedi.");

        const { error } = await supabase.from('users')
            .delete()
            .eq('id', id)
            .eq('school_id', auth.id);

        if (error) throw error;

        res.json({ status: 'success', message: 'Öğretmen başarıyla silindi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// 🎫 SİHİRLİ BİLET İLE VIP GİRİŞ (GÜNCELLENDİ)
// ==========================================
exports.magicLogin = async (req, res) => {
    try {
        const { bilet } = req.body;
        if (!bilet) return res.json({ status: 'error', message: 'Bilet bulunamadı.' });

        // YENİ: hesap kavramı YOK (istek schoolCode taşımıyor) — yalnızca IP. IP
        // çözülemezse (getTrustedClientIp null döner) bu uç nokta için geriye düşülecek
        // bir hesap-geneli katman YOKTUR — fail-open, sınırlama tamamen devre dışı kalır.
        const magicIp = getTrustedClientIp(req);
        const magicIpKey = magicIp ? `magic:ip:${magicIp}` : null;

        try {
            const magicLockCheck = rateLimiter.checkAnyLocked([magicIpKey]);
            if (magicLockCheck.locked) return res.json(_rateLimitedResponse(magicLockCheck.retryAfterSeconds));
        } catch (rlErr) {
            console.error('Hız sınırlayıcı hatası (magic-login kontrol):', rlErr.message);
        }

        const { data: schools, error } = await supabase
            .from('schools')
            .select('id, school_code, school_name, kt_settings')
            .contains('kt_settings', { magic_token: bilet });

        if (error || !schools || schools.length === 0) {
            try {
                rateLimiter.recordFailures([magicIpKey && { key: magicIpKey, ...MAGIC_LOGIN_RL.ipWide }].filter(Boolean));
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (magic-login kayıt):', rlErr.message);
            }
            return res.json({ status: 'error', message: 'Geçersiz veya kullanılmış bilet.' });
        }

        const school = schools[0];
        const settings = school.kt_settings || {};

        if (Date.now() > settings.magic_token_expires) {
            try {
                rateLimiter.recordFailures([magicIpKey && { key: magicIpKey, ...MAGIC_LOGIN_RL.ipWide }].filter(Boolean));
            } catch (rlErr) {
                console.error('Hız sınırlayıcı hatası (magic-login kayıt):', rlErr.message);
            }
            return res.json({ status: 'error', message: 'Biletin süresi dolmuş.' });
        }

        delete settings.magic_token;
        delete settings.magic_token_expires;
        await supabase.from('schools').update({ kt_settings: settings }).eq('id', school.id);

        // 🎫 YENİ: Artık hiçbir şifreye (kt_pass / ilk adminin düz metin şifresi) bakılmıyor
        // ve hiçbiri döndürülmüyor — uid'siz, okul-düzeyi sabit bir "magic_school" bileti
        // veriliyor. pv doğrudan okul id'sine bağlı (computeDutyPv), YENİLENMEZ (shouldRefresh),
        // ömrü sabit MAGIC_TTL_SECONDS (varsayılan 4 saat, hardExp=exp).
        let ktToken = null;
        if (isTokenAuthAvailable()) {
            try {
                const pv = computeDutyPv(settings, 'magic_school', school.id);
                const nowSec = Math.floor(Date.now() / 1000);
                ktToken = signToken(
                    { sid: school.id, uid: null, role: 'admin', ktRole: 'admin', ktClasses: ['ALL'], pv, dutyVariant: 'magic_school' },
                    { ttlSeconds: MAGIC_TTL_SECONDS, hardExp: nowSec + MAGIC_TTL_SECONDS }
                );
            } catch (ticketErr) {
                console.error('Bilet üretilemedi (magic):', ticketErr.message);
            }
        } else {
            _warnSessionSecretMissingOnce();
        }

        return res.json({
            status: 'success',
            schoolCode: school.school_code,
            schoolName: school.school_name,
            userName: 'Süper Admin',
            role: 'admin',
            kt_role: 'admin',
            kt_classes: ['ALL'],
            ktToken
        });

    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Bilet sistemi sunucu hatası.' });
    }
};

// ==========================================
// YENİ: EĞİTİM-ÖĞRETİM YILI GÜNCELLEME
// ==========================================
exports.updateAcademicYear = async (req, res) => {
    try {
        const { schoolCode, schoolPass, academicYear } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        // Yetki kontrolü: Sadece admin güncelleyebilir
        if (auth.role !== 'admin') {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }

        // Format kontrolü: "2024-2025" biçiminde olmalı
        const yearRegex = /^\d{4}-\d{4}$/;
        if (academicYear && !yearRegex.test(academicYear)) {
            return res.json({ status: 'error', message: 'Geçersiz yıl formatı. "2024-2025" biçiminde girin.' });
        }

        const { error } = await supabase
            .from('schools')
            .update({ active_academic_year: academicYear || null })
            .eq('id', auth.id);

        if (error) throw error;

        res.json({ status: 'success', message: `Eğitim-öğretim yılı "${academicYear || 'boşaltıldı'}" olarak güncellendi.` });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: SINIF ATLATMA (YIL SONU TOPLU TERFİ/MEZUNİYET)
// ==========================================
exports.promoteAllStudents = async (req, res) => {
    try {
        const { schoolCode, schoolPass, force } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!(auth.role === 'admin' || auth.app_roles?.kutuphanemiz?.role === 'admin')) {
            return res.json({ success: false, message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }

        const { data: school, error: schoolError } = await supabase
            .from('schools')
            .select('active_academic_year, last_promotion_academic_year')
            .eq('id', auth.id)
            .single();
        if (schoolError) throw schoolError;

        const activeYear = school?.active_academic_year;
        if (!activeYear) {
            return res.json({ success: false, message: 'Önce Ayarlar sayfasından Aktif Akademik Yıl seçilmeli.' });
        }

        if (school.last_promotion_academic_year === activeYear && force !== true) {
            return res.json({
                success: false,
                requiresConfirmation: true,
                message: `Bu okul ${activeYear} akademik yılı için sınıf atlatma işlemini zaten yapmış görünüyor. Yine de devam etmek istiyor musunuz?`
            });
        }

        // Okuldaki tüm AKTİF öğrencileri sayfalı çek (PostgREST varsayılan satır limitini aşmamak için)
        const allStudents = [];
        const PAGE_SIZE = 1000;
        let from = 0;
        while (true) {
            const { data: page, error: pageError } = await supabase
                .from('students')
                .select('id, student_no, grade')
                .eq('school_id', auth.id)
                .eq('is_active', true)
                .range(from, from + PAGE_SIZE - 1);
            if (pageError) throw pageError;
            if (!page || page.length === 0) break;
            allStudents.push(...page);
            if (page.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }

        const toGraduate = [];
        const toPromote = [];

        allStudents.forEach(student => {
            const gradeNum = parseInt(student.grade, 10);
            if (Number.isNaN(gradeNum)) return; // Geçersiz/eksik sınıf bilgisi olan öğrenciye dokunma

            if (gradeNum === 4 || gradeNum === 8 || gradeNum === 12) {
                toGraduate.push({ id: student.id, student_no: buildGraduatedStudentNo(student.student_no, activeYear) });
            } else {
                toPromote.push({ id: student.id, grade: String(gradeNum + 1) });
            }
        });

        if (toGraduate.length > 0) {
            const graduateResults = await Promise.all(toGraduate.map(item =>
                supabase.from('students').update({ is_active: false, student_no: item.student_no }).eq('id', item.id)
            ));
            const graduateError = graduateResults.find(r => r.error);
            if (graduateError) throw graduateError.error;
        }

        if (toPromote.length > 0) {
            const promoteResults = await Promise.all(toPromote.map(item =>
                supabase.from('students').update({ grade: item.grade }).eq('id', item.id)
            ));
            const promoteError = promoteResults.find(r => r.error);
            if (promoteError) throw promoteError.error;
        }

        // Ana işlem tamamlandı; bu güncelleme başarısız olsa bile yanıtı "başarısız" göstermeyeceğiz
        try {
            const { error: markError } = await supabase
                .from('schools')
                .update({ last_promotion_academic_year: activeYear })
                .eq('id', auth.id);
            if (markError) console.error('last_promotion_academic_year güncellenemedi:', markError);
        } catch (markCatchError) {
            console.error('last_promotion_academic_year güncellenemedi:', markCatchError);
        }

        return res.json({
            success: true,
            promotedCount: toPromote.length,
            graduatedCount: toGraduate.length,
            message: `İşlem tamamlandı: ${toPromote.length} öğrenci üst sınıfa geçirildi, ${toGraduate.length} öğrenci mezun/arşiv edildi.`
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};