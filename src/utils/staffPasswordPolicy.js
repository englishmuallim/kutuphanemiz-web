'use strict';

// NOT: Bu dosya Deneliz projesindeki aynı adlı dosyayla (staffPasswordPolicy.js)
// davranış olarak BİREBİR aynı olmalı — burada bir değişiklik yaparsan Deneliz'i de
// güncelle (ikisi aynı Supabase `users` tablosunu ve aynı personel şifre kuralını
// paylaşıyor).

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const LETTER_RE = /[a-zA-ZçÇğĞıİöÖşŞüÜ]/;
const DIGIT_RE = /[0-9]/;

const RULE_MESSAGE = 'Şifre en az 8 karakter olmalı ve en az bir harf, bir rakam içermelidir.';
const USERNAME_MESSAGE = 'Şifreniz kullanıcı adınızla aynı olamaz.';

/**
 * @param {string} newPassword
 * @param {{ username?: string|null }} [options]
 * @returns {{ ok: boolean, message?: string }}
 */
function validateStaffPassword(newPassword, options) {
    const username = options && options.username;

    if (typeof newPassword !== 'string' || newPassword.length < MIN_LENGTH || newPassword.length > MAX_LENGTH) {
        return { ok: false, message: RULE_MESSAGE };
    }
    if (!LETTER_RE.test(newPassword) || !DIGIT_RE.test(newPassword)) {
        return { ok: false, message: RULE_MESSAGE };
    }
    if (username && newPassword.trim().toLowerCase() === String(username).trim().toLowerCase()) {
        return { ok: false, message: USERNAME_MESSAGE };
    }
    return { ok: true };
}

module.exports = { validateStaffPassword };
