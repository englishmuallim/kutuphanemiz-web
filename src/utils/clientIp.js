'use strict';

const net = require('net');

// =========================================================================
// 🌐 GÜVENİLİR İSTEMCİ IP'Sİ — Render → uygulama.
// Render, servisin önünde KENDİ Cloudflare'ini kullanıyor; gerçek istemci IP'si
// Cloudflare'in eklediği `cf-connecting-ip` başlığında gelir ve Cloudflare, istemcinin
// göndermiş olabileceği aynı adlı başlığın ÜZERİNE YAZAR (yani bu başlık uygulamaya
// ulaştığında her zaman Cloudflare'in kendi belirlediği değeri taşır).
//
// `x-forwarded-for` kullanılmaz: bu başlık sadece SONUNA ekleme yapılır, önceki
// girdiler silinmez/üzerine yazılmaz — bu yüzden taklit edilebilir, güvenilmez.
// `app.set('trust proxy')` de kasıtlı olarak ayarlanmıyor (server.js'te yok).
//
// Cloudflare hesabı bize ait değil — bu projede Cloudflare tarafında özel bir kural
// (Transform Rule, paylaşılan sır vb.) EKLEYEMİYORUZ. Bu yüzden `cf-ray` başlığının
// varlığı yalnızca basit bir "bu istek muhtemelen Cloudflare'den geçti" sağlık sinyali
// olarak kullanılır — KRİPTOGRAFİK bir güvenlik sınırı DEĞİLDİR, sahte üretilebilir.
// Asıl güvenlik, Render'ın kendi Cloudflare'inin HER isteği (hangi hostname'den gelirse
// gelsin) yakalayıp cf-connecting-ip'yi kendisi yazdığı varsayımına dayanır.
//
// process.env.TRUST_CF_CONNECTING_IP tam olarak (küçük harfle) 'true' değilse fonksiyon
// HER ZAMAN null döner — yani bu kod, bu ortam değişkeni Render'da hiç tanımlanmamışken
// de güvenle yayına çıkabilir (sadece IP bazlı katmanlar o ana kadar devre dışı kalır,
// hesap-geneli sayaç çağıran tarafta — bkz. libraryController.js — çalışmaya devam eder).
// Render panelinde bu değişken tanımlanırken değeri TAM OLARAK küçük harfli `true`
// olmalıdır ('True', 'TRUE', '1' gibi değerler flag'i SESSİZCE kapalı bırakır).
// =========================================================================
function getTrustedClientIp(req) {
    if (process.env.TRUST_CF_CONNECTING_IP !== 'true') return null;
    if (!req.headers['cf-ray']) return null;

    const candidate = req.headers['cf-connecting-ip'];
    if (typeof candidate !== 'string' || candidate === '') return null;
    if (!net.isIP(candidate)) return null;

    return candidate;
}

module.exports = { getTrustedClientIp };
