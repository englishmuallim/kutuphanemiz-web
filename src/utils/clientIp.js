'use strict';

const crypto = require('crypto');
const net = require('net');

// =========================================================================
// 🌐 GÜVENİLİR İSTEMCİ IP'Sİ — Cloudflare → Render → uygulama zinciri.
// app.set('trust proxy') AYARINA, req.ip'ye veya x-forwarded-for'a HİÇ GÜVENİLMEZ —
// bunların hepsi, Render'a *.onrender.com üzerinden doğrudan bağlanan biri tarafından
// sahte üretilebilir. Tek güvenilir kaynak: Cloudflare'in edge'de bir Transform Rule
// ile eklediği paylaşılan-sır başlığı (x-kt-edge-secret). Bu başlık doğru değerle
// gelmiyorsa cf-connecting-ip'ye HİÇ bakılmaz.
//
// CF_EDGE_SECRET ortam değişkeni tanımsızsa fonksiyon HER ZAMAN null döner — yani bu
// kod, Cloudflare tarafı henüz kurulmamışken de güvenle yayına çıkabilir (sadece IP
// bazlı katmanlar o ana kadar devre dışı kalır, bkz. çağıran taraftaki "IP null ise
// (a)/(b) atlanır" kuralı).
// =========================================================================
function getTrustedClientIp(req) {
    const secret = process.env.CF_EDGE_SECRET;
    if (!secret) return null;

    const provided = req.headers['x-kt-edge-secret'];
    if (typeof provided !== 'string' || provided === '') return null;

    // Sabit zamanlı karşılaştırma: timingSafeEqual farklı uzunluktaki buffer'larda
    // hata fırlatır, bu yüzden ikisini de önce SABİT uzunluklu bir sha256 özetine
    // çeviriyoruz (uzunluk sızıntısı da böylece ortadan kalkar).
    const expectedHash = crypto.createHash('sha256').update(secret).digest();
    const providedHash = crypto.createHash('sha256').update(provided).digest();

    let matches = false;
    try {
        matches = crypto.timingSafeEqual(expectedHash, providedHash);
    } catch (e) {
        return null;
    }
    if (!matches) return null;

    const candidate = req.headers['cf-connecting-ip'];
    if (typeof candidate !== 'string' || candidate === '') return null;
    if (!net.isIP(candidate)) return null;

    return candidate;
}

module.exports = { getTrustedClientIp };
