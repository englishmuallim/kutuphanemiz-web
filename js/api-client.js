// ==========================================
// 🎫 SİHİRLİ BİLET ERKEN YAKALAMA — bu script DEĞERLENDİRİLİR değerlendirilmez (henüz
// DOMContentLoaded beklemeden) hem #bilet= (fragment, sunucuya/loglara/Referer'a HİÇ
// gitmez) hem de ?bilet= (eski biçim, geçiş dönemi için) okunur ve AĞ İSTEĞİ ATILMADAN
// ÖNCE history.replaceState ile adres çubuğundan silinir. Diğer hash/query parametreleri
// korunur. window.__ktMagicPending, ui.js'in window.onload'ının (bu dosyadan SONRA
// çalışır, çünkü script sırayla senkron değerlendirilir ve onload en son tetiklenir)
// normal oturum akışıyla yarışmasını önler — URL artık bilet içermediği için ui.js
// doğrudan URL'ye bakamaz, bu bayrağa bakar.
// ==========================================
var __ktMagicTicket = (function () {
    try {
        var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        var searchParams = new URLSearchParams(window.location.search);
        var fromHash = hashParams.get('bilet');
        var fromSearch = searchParams.get('bilet');
        var ticket = fromHash || fromSearch;

        if (ticket) {
            if (fromHash) hashParams.delete('bilet');
            if (fromSearch) searchParams.delete('bilet');

            var newSearch = searchParams.toString();
            var newHash = hashParams.toString();
            var newUrl = window.location.pathname +
                (newSearch ? '?' + newSearch : '') +
                (newHash ? '#' + newHash : '');

            window.history.replaceState({}, document.title, newUrl);
        }

        return ticket;
    } catch (e) {
        return null;
    }
})();
window.__ktMagicPending = !!__ktMagicTicket;

// --- VERİ ÇEKME & İŞLEMLER ---

// YENİ: kt_settings.require_photo_confirm önbelleği. Bilerek SADECE bu tek boole değeri
// tutuluyor (getSettings'in döndürdüğü TÜM kt_settings nesnesi değil) — getSettings
// nöbetçi şifreleri gibi yönetici-yetkili alanları da döndürüyor; bunları devtools'tan
// kolayca okunabilecek bir global değişkende tekrar tutup sızıntıyı büyütmemek için.
let requirePhotoConfirmEnabled = true;

async function loadClasses() {
    try {
        const res = await fetch('/api/getClasses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ktAuthFields() }) });
        const r = await res.json();
        if (r.status === 'success' && r.data) {
            const setDatalistOptions = (selector, values) => {
                const datalist = document.getElementById(selector);
                if (!datalist) return;
                datalist.innerHTML = (values || []).map(value => `<option value="${value}"></option>`).join('');
            };

            setDatalistOptions('newOgrSubeList', r.data.classes);
            setDatalistOptions('newOgrKademeList', r.data.grades);

            document.querySelectorAll(".class-selector").forEach(sel => {
                if (sel.tagName === 'INPUT') return;
                const defaultOpt = sel.firstElementChild ? sel.firstElementChild.outerHTML : '<option value="">Şube</option>';
                let options = defaultOpt;
                if (r.data.classes) r.data.classes.forEach(cls => { options += `<option value="${cls}">${cls}</option>`; });
                sel.innerHTML = options;
            });
            document.querySelectorAll(".grade-selector").forEach(sel => {
                if (sel.tagName === 'INPUT') return;
                const defaultOpt = sel.firstElementChild ? sel.firstElementChild.outerHTML : '<option value="">Kademe</option>';
                let options = defaultOpt;
                if (r.data.grades) r.data.grades.forEach(g => { options += `<option value="${g}">${typeof window.ktGradeLabel === 'function' ? window.ktGradeLabel(g) : (g + '. Sınıf')}</option>`; });
                sel.innerHTML = options;
            });

            // YENİ: Sınıf listesi doldurulduktan sonra applyPermissions çalışsın ki filtreleri uygulasın
            if (typeof applyPermissions === 'function') applyPermissions();
        }
    } catch (error) { console.error("Sınıflar yüklenirken hata oluştu:", error); }
}

// setupDashboardUI: başarılı girişten (login() veya açılıştaki /api/session doğrulamasından)
// sonra ortak arayüz kurulumu. result: { schoolName, role, kt_role, kt_classes }.
function setupDashboardUI(result) {
    localStorage.setItem("okul_ismi", result.schoolName);
    if (result.userName !== undefined) localStorage.setItem("kutuphane_user", result.userName);
    localStorage.setItem("user_role", result.role);
    localStorage.setItem("kt_role", result.kt_role || result.role);
    localStorage.setItem("kutuphane_classes", JSON.stringify(result.kt_classes || ['ALL']));
    document.getElementById("headerTitle").innerText = result.schoolName;

    if (typeof applyPermissions === 'function') applyPermissions();

    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    getStats(); getOverdueBooks(); loadClasses(); getLeaderboard();
    loadBookSuggestions();
    if (typeof loadSettings === 'function') loadSettings(); // Header'daki okul logosunu erkenden yükle
}

// YENİ: login()'in BAŞARI yanıtını (hem normal girişten hem de zorunlu şifre
// değişiminin ardından gelen "ikinci" başarıdan) uygulayan tek ortak nokta — ikisi
// birbirinden sapmasın diye login()'den çıkarıldı.
function _applyLoginSuccess(result, ctx) {
    if (typeof setKtToken === 'function') setKtToken(result.ktToken);

    localStorage.setItem("kutuphane_code", ctx.code);
    if (ctx.remember) {
        localStorage.setItem("beni_hatirla", "true");
        if (ctx.loginType === 'staff') localStorage.setItem("kutuphane_identity", ctx.identity.trim());
        localStorage.setItem("kutuphane_login_type", ctx.loginType);
    } else {
        localStorage.removeItem("beni_hatirla");
        localStorage.removeItem("kutuphane_identity");
        localStorage.removeItem("kutuphane_login_type");
    }

    localStorage.removeItem("kutuphane_auth_mode");
    localStorage.removeItem("kutuphane_pass");
    window.__ktSessionExpiredShown = false;
    document.getElementById("schoolPass").value = "";

    setupDashboardUI(result);

    if (!ctx.silent) {
        Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true }).fire({ icon: 'success', title: 'Giriş Başarılı' });
    }
}

// =========================================================================
// 🔑 YENİ: ZORUNLU ŞİFRE DEĞİŞİMİ (STAFF_PASSWORD_POLICY_ENFORCE_FROM) — login()'in
// password_change_required yanıtından sonra çağrılır. passwordChangeToken SADECE bu
// fonksiyonun closure'ında (bellekte) tutulur, localStorage'a HİÇ yazılmaz — sayfa
// yenilenirse kullanıcı normal giriş ekranına döner (bilerek). Modal KAPATILAMAZ
// (allowOutsideClick/Escape kapalı); "Vazgeç" girişe geri döner. Döndürdüğü değer:
// başarıda /api/changeStaffPassword'un tam başarı yanıtı (login başarı yanıtıyla AYNI
// biçim), vazgeçildiyse/başarısızsa null.
// =========================================================================
async function promptForcedPasswordChange(passwordChangeToken, initialMessage) {
    for (;;) {
        const { value: pass1, isDismissed } = await Swal.fire({
            title: 'Şifre Değişimi Gerekli',
            html: `
                <p style="font-size:0.9rem; color:#666; margin-bottom:10px;">${initialMessage || 'Güvenlik kuralları gereği şifrenizi güncellemeniz gerekiyor.'}</p>
                <p style="font-size:0.85rem; color:#999; margin-bottom:15px;">En az 8 karakter, en az bir harf ve bir rakam; kullanıcı adınızla aynı olamaz.</p>
                <input type="password" id="swal-pwchange-pass1" class="swal2-input" placeholder="Yeni Şifre" style="margin-bottom: 10px;">
                <input type="password" id="swal-pwchange-pass2" class="swal2-input" placeholder="Yeni Şifre (Tekrar)">
            `,
            allowOutsideClick: false,
            allowEscapeKey: false,
            showCancelButton: true,
            confirmButtonText: 'Şifreyi Güncelle',
            cancelButtonText: 'Vazgeç',
            confirmButtonColor: '#4CAF50',
            focusConfirm: false,
            preConfirm: () => {
                const p1 = document.getElementById('swal-pwchange-pass1').value;
                const p2 = document.getElementById('swal-pwchange-pass2').value;
                const policyCheck = validateStaffPasswordClient(p1);
                if (!policyCheck.ok) {
                    Swal.showValidationMessage(policyCheck.message);
                    return false;
                }
                if (p1 !== p2) {
                    Swal.showValidationMessage('Şifreler birbiriyle uyuşmuyor! Lütfen kontrol edin.');
                    return false;
                }
                return p1;
            }
        });

        if (isDismissed) return null; // "Vazgeç" -> giriş ekranına dön

        Swal.fire({ title: 'Şifreniz Güncelleniyor...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        let data;
        try {
            const res = await fetch('/api/changeStaffPassword', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passwordChangeToken, newPassword: pass1 })
            });
            data = await res.json();
        } catch (e) {
            await Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuyla iletişim kurulamadı. Lütfen tekrar deneyin.' });
            continue; // yeni şifreyi tekrar sor
        }

        if (data.status === 'success') return data;

        // YENİ: isRateLimited dahil, diğer uçlarla (login/forgotPassword) AYNI
        // showApiErrorAlert gösterimi.
        await showApiErrorAlert(data, 'Şifre Güncellenemedi');
        if (data.isRateLimited) return null; // kilitliyken tekrar denemenin anlamı yok

        // Kural ihlali veya geçersiz/süresi dolmuş bilet gibi diğer hatalarda kullanıcı
        // modalı tekrar görür (bilet süresi dolmuşsa "Vazgeç" ile girişe dönmesi gerekir).
    }
}

// =========================================================================
// 🙋 YENİ: "HESABIM" — admin/öğretmen kendi ad soyad/e-posta/telefon/şifresini düzenler.
// Kimlik sunucuda SADECE ktToken'dan çözülür (bkz. updateMyAccount) — burada hiçbir id
// gönderilmez, role/kt_role gibi yetki alanları bu formda hiç YOK. Sunucu isteği BİLEREK
// preConfirm İÇİNDE yapılır (showLoaderOnConfirm:true) — SweetAlert2'nin "AJAX doğrulama"
// deseni: sunucu hata döndürürse Swal.showValidationMessage ile AYNI pencere açık kalır,
// girilen değerler kaybolmaz (başka bir Swal.fire ile üzerine yazılmaz). Şifre değişirse
// sunucu yeni bir ktToken döner (setKtToken ile değiştirilir, oturum açık kalır); sadece
// ad/e-posta/telefon değişirse ktToken'a dokunulmaz, sadece localStorage.kutuphane_user
// tazelenir.
// =========================================================================

// YENİ: Swal'ın varsayılan .swal2-input/etiket davranışına güvenmiyoruz (etiket+alan yan
// yana kayabiliyor, alan genişlikleri tutarsız oluyor) — bu modale ÖZEL, kendi kapsamlı
// sınıflarımızla tek sütun/tam genişlik bir düzen kuruyoruz. <style> bu modalin html'i
// içinde taşındığı için Swal popup'ı kapanınca DOM'dan kalkar, başka hiçbir pencereyi
// etkilemez.
const HESABIM_FORM_STYLE = `
    <style>
        .hesabim-form { display: flex; flex-direction: column; width: 100%; box-sizing: border-box; text-align: left; font-size: 0.85rem; color: #374151; }
        .hesabim-field { display: flex; flex-direction: column; align-items: stretch; width: 100%; margin: 0 0 12px 0; }
        .hesabim-field label.hesabim-label { display: block; font-weight: bold; margin: 0 0 4px 0; }
        .hesabim-field label.hesabim-label small { font-weight: normal; color: #9ca3af; }
        .hesabim-form input.hesabim-input { display: block; width: 100%; max-width: 100%; box-sizing: border-box; margin: 0; }
        .hesabim-form input.hesabim-input:disabled { background: #f3f4f6; }
        .hesabim-divider { width: 100%; border: 0; border-top: 1px solid #e5e7eb; margin: 6px 0 14px 0; }
        .hesabim-section-title { font-weight: bold; margin: 0 0 10px 0; }
        .hesabim-section-title small { font-weight: normal; color: #9ca3af; }
        .hesabim-note { font-size: 0.75rem; color: #9ca3af; margin: 10px 0 0 0; }
    </style>
`;

async function openMyAccountModal() {
    let current;
    try {
        const res = await fetch('/api/getMyAccount', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields() })
        });
        current = await res.json();
    } catch (e) {
        return Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Hesap bilgileri alınamadı.' });
    }
    if (current.status !== 'success') {
        return showApiErrorAlert(current, 'Hesap Bilgileri Alınamadı');
    }

    const { value: result, isConfirmed } = await Swal.fire({
        title: 'Hesabım',
        html: `
            ${HESABIM_FORM_STYLE}
            <div class="hesabim-form">
                <div class="hesabim-field">
                    <label class="hesabim-label" for="swal-acct-username">Kullanıcı Adı</label>
                    <input type="text" id="swal-acct-username" class="swal2-input hesabim-input" disabled>
                </div>
                <div class="hesabim-field">
                    <label class="hesabim-label" for="swal-acct-fullname">Ad Soyad</label>
                    <input type="text" id="swal-acct-fullname" class="swal2-input hesabim-input">
                </div>
                <div class="hesabim-field">
                    <label class="hesabim-label" for="swal-acct-email">E-posta</label>
                    <input type="email" id="swal-acct-email" class="swal2-input hesabim-input">
                </div>
                <div class="hesabim-field">
                    <label class="hesabim-label" for="swal-acct-phone">Telefon</label>
                    <input type="text" id="swal-acct-phone" class="swal2-input hesabim-input">
                </div>

                <hr class="hesabim-divider">
                <div class="hesabim-section-title">Şifre Değiştir <small>(boş bırakılırsa şifre değişmez)</small></div>

                <div class="hesabim-field">
                    <label class="hesabim-label" for="swal-acct-newpass1">Yeni Şifre</label>
                    <input type="password" id="swal-acct-newpass1" class="swal2-input hesabim-input">
                </div>
                <div class="hesabim-field">
                    <label class="hesabim-label" for="swal-acct-newpass2">Yeni Şifre (Tekrar)</label>
                    <input type="password" id="swal-acct-newpass2" class="swal2-input hesabim-input">
                </div>
                <div class="hesabim-field">
                    <label class="hesabim-label" for="swal-acct-curpass">Mevcut Şifre <small>(e-posta veya şifre değiştirirken gerekir)</small></label>
                    <input type="password" id="swal-acct-curpass" class="swal2-input hesabim-input">
                </div>

                <p class="hesabim-note">Bu bilgiler Deneliz ile ortaktır.</p>
            </div>
        `,
        didOpen: () => {
            document.getElementById('swal-acct-username').value = current.username || '';
            document.getElementById('swal-acct-fullname').value = current.fullName || '';
            document.getElementById('swal-acct-email').value = current.email || '';
            document.getElementById('swal-acct-phone').value = current.phone || '';
        },
        showCancelButton: true,
        confirmButtonText: 'Kaydet',
        cancelButtonText: 'Kapat',
        confirmButtonColor: '#4CAF50',
        focusConfirm: false,
        allowOutsideClick: false,
        showLoaderOnConfirm: true,
        preConfirm: async () => {
            const fullName = document.getElementById('swal-acct-fullname').value.trim();
            const email = document.getElementById('swal-acct-email').value.trim();
            const phone = document.getElementById('swal-acct-phone').value.trim();
            const newPass1 = document.getElementById('swal-acct-newpass1').value;
            const newPass2 = document.getElementById('swal-acct-newpass2').value;
            const curPass = document.getElementById('swal-acct-curpass').value;

            if (!fullName) {
                Swal.showValidationMessage('Ad soyad boş olamaz.');
                return false;
            }
            if (newPass1 || newPass2) {
                if (newPass1 !== newPass2) {
                    Swal.showValidationMessage('Yeni şifreler birbiriyle uyuşmuyor!');
                    return false;
                }
                const policyCheck = validateStaffPasswordClient(newPass1, { username: current.username });
                if (!policyCheck.ok) {
                    Swal.showValidationMessage(policyCheck.message);
                    return false;
                }
            }
            const emailChanged = email !== (current.email || '');
            if ((emailChanged || newPass1) && !curPass) {
                Swal.showValidationMessage('E-posta veya şifre değiştirmek için mevcut şifrenizi girmelisiniz.');
                return false;
            }

            // YENİ: sunucu isteği BİLEREK burada (preConfirm içinde) — hata durumunda
            // Swal.showValidationMessage AYNI pencereyi açık tutar, girilenler kaybolmaz.
            // Ayrı bir "Kaydediliyor..." Swal.fire'a GEREK YOK: showLoaderOnConfirm:true
            // zaten Kaydet düğmesinde yükleniyor animasyonu gösterir.
            let data;
            try {
                const res = await fetch('/api/updateMyAccount', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...ktAuthFields(), fullName, email, phone, currentPassword: curPass, newPassword: newPass1 })
                });
                data = await res.json();
            } catch (e) {
                Swal.showValidationMessage('Sunucuyla iletişim kurulamadı. Lütfen tekrar deneyin.');
                return false;
            }

            if (!data || data.status !== 'success') {
                Swal.showValidationMessage((data && data.message) || 'Hesap güncellenemedi.');
                // YENİ: hata sonrası yalnızca Mevcut Şifre alanı temizlenir/odaklanır —
                // diğer alanlar (ad/e-posta/telefon/yeni şifre) kullanıcı tekrar yazmak
                // zorunda kalmasın diye AYNEN kalır.
                const curPassInput = document.getElementById('swal-acct-curpass');
                if (curPassInput) { curPassInput.value = ''; curPassInput.focus(); }
                return false;
            }

            return data;
        }
    });

    if (!isConfirmed || !result) return;

    if (result.userName !== undefined) localStorage.setItem("kutuphane_user", result.userName);
    if (result.ktToken && typeof setKtToken === 'function') setKtToken(result.ktToken);

    Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2500, timerProgressBar: true }).fire({ icon: 'success', title: 'Hesabınız güncellendi' });
}
window.openMyAccountModal = openMyAccountModal;

// login(options): options.silent true ise (sessiz yükseltme, bkz. js/ui.js) hiçbir
// SweetAlert2 bildirimi göstermez (başarı toastu da, hata toastu da). Geriye başarı
// durumunda true, başarısızlıkta false döner — çağıran taraf buna göre karar verir.
async function login(options) {
    const silent = !!(options && options.silent);
    const code = document.getElementById("schoolCode").value;
    const pass = document.getElementById("schoolPass").value;
    const identity = document.getElementById("teacherIdentity").value;
    const remember = document.getElementById("beniHatirla").checked;
    const btn = document.querySelector(".btn-login");

    const loginType = window.currentLoginType || 'duty';

    if (!code || !pass || (loginType === 'staff' && !identity)) {
        if (!silent) Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Lütfen tüm giriş bilgilerini doldurun' });
        return false;
    }
    if (btn) { btn.innerText = "Giriş yapılıyor.."; btn.disabled = true; }

    try {
        // ÖNEMLİ: login() KENDİSİ giriş anında girilen gerçek şifreyi (form alanından)
        // sunucuya göndermek ZORUNDADIR — bilet almanın tek yolu bu. ktAuthFields()
        // burada KULLANILMAZ (o, oturum KURULDUKTAN SONRAKİ istekler içindir).
        const payload = { schoolCode: code, schoolPass: pass, loginType: loginType };
        if (loginType === 'staff') {
            const identityInput = document.getElementById('teacherIdentity');
            if (identityInput) {
                payload.identity = identityInput.value.trim();
            }
        }

        const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();

        if (result.status === 'success') {
            _applyLoginSuccess(result, { code, identity, remember, loginType, silent });
            return true;

        } else if (result.status === 'password_change_required') {
            // YENİ: STAFF_PASSWORD_POLICY_ENFORCE_FROM açık ve doğrulanmış şifre kurala
            // uymuyor — normal bilet verilmedi. Sessiz yükseltmede (options.silent) bu dal
            // hiç tetiklenmemeli (sessiz çağrılar schoolPass göndermez, backend'de
            // verifyStaffPassword şifre yanlışsa ok döndürmez) ama savunma amaçlı: sessizse
            // modal açmadan başarısız dön, kullanıcı normal giriş ekranında kalsın.
            if (silent) return false;

            const changeResult = await promptForcedPasswordChange(result.passwordChangeToken, result.message);
            if (changeResult && changeResult.status === 'success') {
                _applyLoginSuccess(changeResult, { code, identity, remember, loginType, silent });
                return true;
            }
            return false;

        } else {
            if (!silent) {
                // 🛑 İŞTE BÜYÜNÜN GERÇEKLEŞTİĞİ YER: LİSANS HATASI KONTROLÜ
                if (result.isLicenseError) {
                    Swal.fire({
                        title: 'Lisans Süresi Doldu',
                        html: result.message, // 'text' yerine 'html' kullanıyoruz ki etiketler çalışsın
                        icon: 'warning',
                        confirmButtonText: 'Tamam',
                        confirmButtonColor: '#ea580c',
                        background: '#1e293b',
                        color: '#f8fafc',
                        iconColor: '#f59e0b'
                    });
                } else if (result.isRateLimited) {
                    // YENİ: hız sınırı kilidi — sunucu zaten kalan süreyi result.message'a
                    // Türkçe gömüyor, burada sadece ayrı bir başlık/ikonla gösteriyoruz.
                    Swal.fire({ icon: 'warning', title: 'Çok Fazla Deneme', text: result.message });
                } else {
                    // Normal şifre/kullanıcı hataları için
                    Swal.fire({ icon: 'error', title: 'Giriş Başarısız', text: result.message });
                }
            }
            return false;
        }
    } catch (error) {
        if (!silent) Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuyla iletişim kurulamadı. Lütfen internet bağlantınızı kontrol edin.' });
        return false;
    } finally {
        if (btn) { btn.innerText = "Giriş Yap"; btn.disabled = false; }
    }
}

// =========================================================================
// 🔑 YENİ: PERSONEL ŞİFRE KURALI — TARAYICI TARAFI KOPYASI. Sunucudaki
// src/utils/staffPasswordPolicy.js ile davranış/mesaj BİREBİR aynı olmalı (saf JS
// modülü olmadığından burada ayrı bir fonksiyon olarak tutuluyor — biri değişirse
// diğeri de güncellenmeli). js/ui.js (öğretmen formu) ve bu dosyadaki "şifremi
// unuttum" akışı tarafından paylaşılır.
// =========================================================================
function validateStaffPasswordClient(newPassword, options) {
    var username = options && options.username;

    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
        return { ok: false, message: 'Şifre en az 8 karakter olmalı ve en az bir harf, bir rakam içermelidir.' };
    }
    if (!/[a-zA-ZçÇğĞıİöÖşŞüÜ]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return { ok: false, message: 'Şifre en az 8 karakter olmalı ve en az bir harf, bir rakam içermelidir.' };
    }
    if (username && newPassword.trim().toLowerCase() === String(username).trim().toLowerCase()) {
        return { ok: false, message: 'Şifreniz kullanıcı adınızla aynı olamaz.' };
    }
    return { ok: true };
}
window.validateStaffPasswordClient = validateStaffPasswordClient;

// =========================================================================
// 🔐 KÜTÜPHANEMİZ - BİREYSEL ŞİFRE SIFIRLAMA ZİNCİRİ
// =========================================================================
// YENİ: login()'deki isRateLimited dalıyla AYNI SweetAlert2 gösterimi — şifre
// sıfırlama akışının 3 adımı ve sihirli bilet için ortak kullanılır.
function showApiErrorAlert(data, fallbackTitle) {
    if (data && data.isRateLimited) {
        Swal.fire({ icon: 'warning', title: 'Çok Fazla Deneme', text: data.message });
    } else {
        Swal.fire({ icon: 'error', title: fallbackTitle, text: data && data.message });
    }
}

async function forgotPassword() {
    // 1. ADIM: Kurum Kodu ve Kimlik Bilgisi İsteme
    const { value: formValues } = await Swal.fire({
        title: 'Şifremi Unuttum',
        html: `
            <p style="font-size:14px; color:#666; margin-bottom:15px;">Lütfen kurum kodunuzu ve kimlik bilginizi (Kullanıcı adı, E-posta veya Telefon) girin.</p>
            <input id="swal-code" class="swal2-input" placeholder="Kurum Kodu (Örn: 102030)" style="margin-bottom: 10px;">
            <input id="swal-identity" class="swal2-input" placeholder="Kullanıcı Adı, Tel veya E-posta">
        `,
        showCancelButton: true,
        confirmButtonText: 'Kodu Gönder',
        cancelButtonText: 'İptal',
        confirmButtonColor: '#4CAF50',
        focusConfirm: false,
        preConfirm: () => {
            const schoolCode = document.getElementById('swal-code').value;
            const identity = document.getElementById('swal-identity').value;
            if (!schoolCode || !identity) {
                Swal.showValidationMessage('Lütfen her iki alanı da eksiksiz doldurun!');
                return false;
            }
            return { schoolCode, identity };
        }
    });

    if (!formValues) return;
    const { schoolCode, identity } = formValues;

    Swal.fire({ title: 'Hesabınız Aranıyor...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        // 1. İSTEK: Kodu Gönder
        let res = await fetch('/api/forgotPassword', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode, identity })
        });
        let data = await res.json();

        if (data.status !== 'success') {
            return showApiErrorAlert(data, 'Hata');
        }

        // 2. ADIM: 6 Haneli Kodu İsteme
        // YENİ: "hesap bulunamadı" durumu artık burada da status:'success' dönüyor ama
        // GERÇEK bir maskedEmail OLMADAN (hesap var/yok sızmasın) — bu yüzden metin
        // koşullu: gerçek adres varsa onu, yoksa nötr bir cümleyi göster. Akış (6 haneli
        // kod sorması) HER İKİ durumda da birebir aynı.
        const codeSentText = data.maskedEmail
            ? `<b>${data.maskedEmail}</b> adresine 6 haneli bir doğrulama kodu gönderdik.<br><br>Lütfen kodu aşağıya girin:`
            : 'Bu bilgilerle eşleşen ve e-postası kayıtlı bir hesap varsa bir kod gönderildi.<br><br>Kodunuz geldiyse aşağıya girin:';
        const { value: resetCode } = await Swal.fire({
            title: 'Kod Gönderildi!',
            html: `
                <p style="font-size:14px; color:#333; margin-bottom:15px;">
                    ${codeSentText}
                </p>
                <input id="swal-reset-code" type="text" class="swal2-input" placeholder="123456" maxlength="6" style="text-align:center; font-size:24px; letter-spacing:4px;">
            `,
            showCancelButton: true,
            confirmButtonText: 'Kodu Doğrula',
            cancelButtonText: 'İptal',
            confirmButtonColor: '#4CAF50',
            preConfirm: () => {
                const code = document.getElementById('swal-reset-code').value;
                if (!code || code.length !== 6) {
                    Swal.showValidationMessage('Lütfen 6 haneli kodu eksiksiz girin!');
                    return false;
                }
                return code;
            }
        });

        if (!resetCode) return;

        Swal.fire({ title: 'Kod Doğrulanıyor...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        // 2. İSTEK: Kodu Doğrula
        res = await fetch('/api/verifyResetCode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode, identity, resetCode })
        });
        data = await res.json();

        if (data.status !== 'success') {
            return showApiErrorAlert(data, 'Geçersiz Kod');
        }

        // 3. ADIM: Yeni Şifre İsteme
        const { value: newPassword } = await Swal.fire({
            title: 'Yeni Şifre',
            html: `
                <p style="font-size:0.9rem; color:#666; margin-bottom:15px;">Lütfen yeni şifrenizi belirleyin.<br><small style="color:#999;">En az 8 karakter, en az bir harf ve bir rakam; kullanıcı adınızla aynı olamaz.</small></p>
                <input type="password" id="swal-pass1" class="swal2-input" placeholder="Yeni Şifre" style="margin-bottom: 10px;">
                <input type="password" id="swal-pass2" class="swal2-input" placeholder="Yeni Şifre (Tekrar)">
            `,
            showCancelButton: true,
            confirmButtonText: 'Şifreyi Kaydet',
            cancelButtonText: 'İptal',
            confirmButtonColor: '#4CAF50',
            focusConfirm: false,
            preConfirm: () => {
                const pass1 = document.getElementById('swal-pass1').value;
                const pass2 = document.getElementById('swal-pass2').value;
                // YENİ: kullanıcı adı bu akışta kesin bilinmiyor (identity e-posta/telefon da
                // olabilir) — client-side kontrol yalnızca uzunluk/karakter kuralını uygular,
                // "kullanıcı adıyla aynı olamaz" kontrolü sunucuda (updatePassword, user.username
                // ile) yapılır.
                const policyCheck = validateStaffPasswordClient(pass1);
                if (!policyCheck.ok) {
                    Swal.showValidationMessage(policyCheck.message);
                    return false;
                }
                if (pass1 !== pass2) {
                    Swal.showValidationMessage('Şifreler birbiriyle uyuşmuyor! Lütfen kontrol edin.');
                    return false;
                }
                return pass1;
            }
        });

        if (!newPassword) return;

        Swal.fire({ title: 'Şifreniz Güncelleniyor...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        // 3. İSTEK: Şifreyi Kaydet
        res = await fetch('/api/updatePassword', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode, identity, resetCode, newPassword })
        });
        data = await res.json();

        if (data.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Başarılı!', text: 'Şifreniz başarıyla güncellendi. Yeni şifrenizle giriş yapabilirsiniz.', confirmButtonColor: '#4CAF50' });
        } else {
            showApiErrorAlert(data, 'Hata');
        }

    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuyla iletişim kurulurken bir hata oluştu.' });
    }
}

// YENİ: kt_settings.require_photo_confirm açıkken kitapVer öncesi çağrılır. Yazma yapmayan
// /api/kitapVerPreflight ile doğrulamayı tekrarlamadan öğrenci fotoğrafını gösterir ve
// görevlinin "karşımdaki öğrenci bu" onayını ister. true = onaylandı, false = vazgeçildi/hata.
async function runLendingPhotoConfirmation(data) {
    try {
        // Fiziksel barkod okuyucunun gönderdiği tuş vuruşları henüz kuyrukta olabilir;
        // odağı kaldırarak pencere açıldığında input'a sızmasını önlüyoruz.
        const barkodInput = document.getElementById("verBarkod");
        if (barkodInput) barkodInput.blur();

        const response = await fetch('/api/kitapVerPreflight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode: data.schoolCode, barkod: data.barkod, ogrNo: data.ogrNo })
        });
        const result = await response.json();

        if (result.status !== 'success') {
            Swal.fire({ icon: 'error', title: 'Hata', text: result.message });
            return false;
        }

        const { student, book, photoUrl } = result.data;
        const photoHtml = photoUrl
            ? `<div style="width:min(270px, 80vw); height:min(52vh, 420px); border-radius:12px; border:2px solid #e5e7eb; background:#f3f4f6; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                   <img src="${photoUrl}" alt="Öğrenci fotoğrafı" style="max-width:100%; max-height:100%; object-fit:contain; display:block;">
               </div>`
            : `<div style="width:160px; height:200px; border-radius:12px; border:2px dashed #ef4444; display:flex; align-items:center; justify-content:center; font-size:48px; font-weight:bold; color:#ef4444; background:#fef2f2;">${(student.fullName || '?').charAt(0).toUpperCase()}</div>
               <div style="color:#b91c1c; font-weight:bold; font-size:0.85rem; margin-top:6px;">⚠️ Bu öğrencinin fotoğrafı sistemde yok</div>`;

        const popup = await Swal.fire({
            title: 'Öğrenciyi Doğrulayın',
            html: `
                <div style="display:flex; flex-direction:column; align-items:center; gap:10px;">
                    ${photoHtml}
                    <div style="font-size:1.1rem; font-weight:bold;">${student.fullName}</div>
                    <div style="color:#6b7280; font-size:0.9rem;">${student.studentNo} • ${student.grade || '-'} / ${student.className || '-'}</div>
                    <div style="margin-top:8px; padding-top:8px; border-top:1px solid #e5e7eb; width:100%; text-align:center;">
                        <b>${book.bookName}</b><br>
                        <span style="color:#6b7280; font-size:0.85rem;">${book.barcode}</span>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Evet, karşımdaki öğrenci bu',
            cancelButtonText: 'Vazgeç',
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#ef4444',
            allowOutsideClick: false,
            allowEnterKey: false,
            focusConfirm: false,
            focusCancel: false,
            didOpen: (popupEl) => {
                // Barkod okuyucunun trailing Enter'ı allowEnterKey:false ile etkisiz zaten,
                // ama fare/dokunmatik için de görevliye fotoğrafa bakacak minimum bir süre bırak.
                const confirmBtn = popupEl.querySelector('.swal2-confirm');
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.style.opacity = '0.5';
                    setTimeout(() => {
                        confirmBtn.disabled = false;
                        confirmBtn.style.opacity = '1';
                    }, 700);
                }
            }
        });

        return !!popup.isConfirmed;
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Hata', text: 'Sunucu hatası' });
        return false;
    }
}

// YENİ: kt_settings.track_reading_status açıkken, kitapAl (iade) başarılı olduktan SONRA
// çağrılır. Hiçbir düğme önceden seçili/odaklı olmasın ve Enter/Esc/dışarı tıklama ile
// kapanmasın diye runLendingPhotoConfirmation'daki aynı güvenlik ayarları kullanılır.
// YENİ (Faz A2/B): opsiyonel 3. parametre ile yönetici düzeltme penceresinde de (aynı fonksiyon,
// kod çoğaltmadan) "Durumu Temizle" düğmesi, "mevcut durum" satırı ve ikincil bir kapatma
// düğmesi ("Vazgeç") eklenebilir. İade akışındaki çağrı (promptReadingStatus) showSkipOption
// hiç geçmediği için ikincil düğme hiç render edilmez — pencere yalnızca Okudum/Kısmen
// okudum/Okumadım ile kapanabilir (Enter/Esc/dışarı tıklama zaten kapalı, kapatma X'i de yok).
async function showReadingStatusChoice(bookName, hasPages, options = {}) {
    const { showClearOption = false, currentStatusLabel = null, showSkipOption = false, skipLabel = 'Vazgeç' } = options;
    let chosen = null;
    await Swal.fire({
        title: 'Okuma Durumu',
        html: `
            <div style="font-weight:bold; margin-bottom:4px;">${bookName || ''}</div>
            ${currentStatusLabel ? `<div style="color:#374151; font-size:0.85rem; margin-bottom:8px;">Mevcut durum: <b>${currentStatusLabel}</b></div>` : ''}
            <div style="color:#6b7280; font-size:0.85rem; margin-bottom:12px;">Öğrenci bu kitabı okudu mu?</div>
            <div id="rs-buttons" style="display:flex; flex-direction:column; gap:10px;">
                <button type="button" id="rs-btn-read" style="padding:14px; border-radius:10px; border:none; background:#10b981; color:#fff; font-weight:bold; font-size:1rem; cursor:pointer;">Okudum</button>
                ${hasPages ? `<button type="button" id="rs-btn-partial" style="padding:14px; border-radius:10px; border:none; background:#f59e0b; color:#fff; font-weight:bold; font-size:1rem; cursor:pointer;">Kısmen okudum</button>` : ''}
                <button type="button" id="rs-btn-notread" style="padding:14px; border-radius:10px; border:none; background:#ef4444; color:#fff; font-weight:bold; font-size:1rem; cursor:pointer;">Okumadım</button>
                ${showClearOption ? `<button type="button" id="rs-btn-clear" style="padding:12px; border-radius:10px; border:1px solid #d1d5db; background:#f3f4f6; color:#374151; font-weight:bold; font-size:0.9rem; cursor:pointer;">Durumu Temizle</button>` : ''}
                ${showSkipOption ? `<button type="button" id="rs-btn-skip" style="padding:10px; border-radius:10px; border:1px solid #d1d5db; background:#fff; color:#6b7280; font-weight:bold; font-size:0.85rem; cursor:pointer; margin-top:4px;">${skipLabel}</button>` : ''}
            </div>
        `,
        showConfirmButton: false,
        showCancelButton: false,
        showDenyButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false,
        allowEnterKey: false,
        focusConfirm: false,
        didOpen: (popupEl) => {
            const buttons = Array.from(popupEl.querySelectorAll('#rs-buttons button'));
            // Fiziksel barkod okuyucunun trailing Enter'ı allowEnterKey:false ile etkisiz,
            // fare/dokunmatik için de görevliye seçeneklere bakacak minimum bir süre bırakılıyor.
            buttons.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
            setTimeout(() => buttons.forEach(b => { b.disabled = false; b.style.opacity = '1'; }), 700);

            const map = { 'rs-btn-read': 'read', 'rs-btn-partial': 'partially_read', 'rs-btn-notread': 'not_read', 'rs-btn-clear': 'clear', 'rs-btn-skip': 'skip' };
            buttons.forEach(b => { b.onclick = () => { chosen = map[b.id]; Swal.close(); }; });
        }
    });
    return chosen;
}

// YENİ (Faz A2): okuma durumunu insan-okunur kısa bir etikete çevirir (düzeltme penceresinde
// "mevcut durum" satırı için kullanılır).
function readingStatusLabel(status, pagesRead) {
    if (status === 'read') return 'Okudu';
    if (status === 'partially_read') return `Kısmen okudu (${pagesRead} syf)`;
    if (status === 'not_read') return 'Okumadı';
    return 'Belirtilmedi';
}

// "Kısmen okudum" seçildiğinde okunan sayfa sayısını sorar; "Geri" ile ana seçime dönülebilir.
async function showPagesReadInput(bookName, maxPages) {
    const { value, isConfirmed, isDenied } = await Swal.fire({
        title: 'Kaç Sayfa Okudu?',
        html: `<div style="font-weight:bold; margin-bottom:10px;">${bookName || ''}</div>`,
        input: 'number',
        inputAttributes: { min: 1, max: maxPages, step: 1 },
        inputPlaceholder: `1 - ${maxPages} arası sayfa`,
        showDenyButton: true,
        confirmButtonText: 'Kaydet',
        denyButtonText: '← Geri',
        confirmButtonColor: '#10b981',
        denyButtonColor: '#6b7280',
        allowOutsideClick: false,
        allowEscapeKey: false,
        allowEnterKey: false,
        focusConfirm: false,
        inputValidator: (val) => {
            const n = parseInt(val, 10);
            if (!val || isNaN(n) || n < 1 || n > maxPages) {
                return `Sayfa sayısı 1 ile ${maxPages} arasında bir tam sayı olmalı.`;
            }
        }
    });
    if (isConfirmed) return { action: 'save', pages: parseInt(value, 10) };
    if (isDenied) return { action: 'back' };
    return { action: 'back' };
}

// YENİ (Faz B): bağlantı/sunucu hatasında ("Tekrar Dene" ile aynı isteği yeniden gönderir)
// kimse takılı kalmasın; iş kuralı reddinde (örn. "zaten belirlenmiş") sadece bilgilendirip
// kapatır — tekrar denemek aynı reddi vereceği için anlamsız.
async function submitReadingStatus(transactionId, readingStatus, pagesRead) {
    const handlerName = localStorage.getItem("kutuphane_user") || "Bilinmeyen Görevli";

    while (true) {
        try {
            const res = await fetch('/api/setReadingStatus', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...ktAuthFields(), handlerName, transactionId, readingStatus, pagesRead })
            });
            const result = await res.json();
            if (result.status !== 'success') {
                await Swal.fire({ icon: 'warning', title: 'Okuma Durumu Kaydedilemedi', html: `${result.message}<br><br><small>İade işlemi zaten tamamlandı, bu sadece okuma durumu kaydıyla ilgili.</small>` });
                return false;
            }
            return true;
        } catch (e) {
            const retry = await Swal.fire({
                icon: 'error',
                title: 'Bağlantı Hatası',
                html: 'Okuma durumu kaydedilemedi.<br><br><small>İade işlemi zaten tamamlandı, bu sadece okuma durumu kaydıyla ilgili.</small>',
                showCancelButton: true,
                confirmButtonText: 'Tekrar Dene',
                cancelButtonText: 'Kapat',
                confirmButtonColor: '#10b981',
                cancelButtonColor: '#6b7280'
            });
            if (!retry.isConfirmed) return false;
            // "Tekrar Dene" seçildi -> döngü aynı isteği yeniden gönderir
        }
    }
}

// YENİ (Faz A2/B): geçmiş panelindeki VEYA Rapor Al ekranındaki "düzelt" ikonundan çağrılır
// (yalnızca admin'e gösterilir). promptReadingStatus'taki "Geri" döngüsünü ve Faz A
// pencerelerini (showReadingStatusChoice/showPagesReadInput) kod çoğaltmadan yeniden kullanır;
// farkı "Durumu Temizle" seçeneği, "Vazgeç" düğmesi ve mevcut durumun gösterilmesidir. Hangi
// ekranın nasıl yenileneceği/hangi panellerin açık kalacağı çağırana ait olduğu için, kaydedilirse
// yalnızca verilen onSaved() callback'i çağrılır (sorgula'ya özel bir varsayım içermez).
async function editReadingStatusForHistoryRow(transactionId, bookName, bookPageCount, currentStatus, currentPagesRead, onSaved) {
    const hasPages = !!bookPageCount && bookPageCount > 0;

    let saved = false;
    while (true) {
        const choice = await showReadingStatusChoice(bookName, hasPages, {
            showClearOption: true,
            currentStatusLabel: readingStatusLabel(currentStatus, currentPagesRead),
            showSkipOption: true,
            skipLabel: 'Vazgeç'
        });
        if (!choice || choice === 'skip') break;

        if (choice === 'read' || choice === 'not_read' || choice === 'clear') {
            saved = await submitReadingStatus(transactionId, choice, null);
            break;
        }

        if (choice === 'partially_read') {
            const result = await showPagesReadInput(bookName, bookPageCount);
            if (result.action === 'save') {
                saved = await submitReadingStatus(transactionId, 'partially_read', result.pages);
                break;
            }
            // 'back' -> ana seçime dön
        }
    }

    if (saved && typeof onSaved === 'function') {
        await onSaved();
    }
}

async function promptReadingStatus(transactionId, bookName, bookPageCount) {
    const hasPages = !!bookPageCount && bookPageCount > 0;

    // "Kısmen okudum" seçildiğinde sayfa girişinden "Geri" ile ana seçime dönülebilsin diye döngü
    while (true) {
        const choice = await showReadingStatusChoice(bookName, hasPages);
        if (!choice || choice === 'skip') return;

        if (choice === 'read' || choice === 'not_read') {
            await submitReadingStatus(transactionId, choice, null);
            return;
        }

        if (choice === 'partially_read') {
            const result = await showPagesReadInput(bookName, bookPageCount);
            if (result.action === 'save') {
                await submitReadingStatus(transactionId, 'partially_read', result.pages);
                return;
            }
            // 'back' -> ana seçime dön
        }
    }
}

async function islemYap(actionType) {
    let data = { ...ktAuthFields() };
    // YENİ EKLENEN: İşlemi yapan kişinin ismini de backend'e gönder
    data.handlerName = localStorage.getItem("kutuphane_user") || "Bilinmeyen Görevli";
    let endpoint = actionType === 'kitapVer' ? "/api/kitapVer" : "/api/kitapAl";
    let islemBarkod = "", islemOgrNo = "";

    if (actionType === 'kitapVer') {
        data.ogrNo = document.getElementById("verOgrNo").value;
        data.barkod = document.getElementById("verBarkod").value;
        data.condition = document.getElementById("verKitapDurum").value; // YENİ EKLENDİ
        islemOgrNo = data.ogrNo; islemBarkod = data.barkod;
        if (!data.ogrNo || !data.barkod) { Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Bilgileri giriniz' }); return; }

        // YENİ: Ayar açıksa, gerçek kitapVer çağrısından önce fotoğraflı onay iste
        if (requirePhotoConfirmEnabled) {
            const confirmed = await runLendingPhotoConfirmation(data);
            if (!confirmed) return;
        }
    } else {
        data.barkod = document.getElementById("alBarkod").value;
        data.condition = document.getElementById("alKitapDurum").value; // YENİ EKLENDİ
        islemBarkod = data.barkod;
        if (!data.barkod) { Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Barkod okutunuz' }); return; }
    }

    Swal.fire({ title: 'İşleniyor...', didOpen: () => Swal.showLoading() });
    try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
        const result = await response.json();
        if (result.studentNo) islemOgrNo = result.studentNo;

        if (result.status === 'success') {
            // YENİ EKLENEN: Backend'den gelen ismi tarayıcıya kaydet

            playBeep();
            let msg = result.message;
            if (result.raf) msg += `<br><br><div style="font-size:1.2rem; color:#4f46e5;">Raf No: <b>${result.raf}</b></div>`;
            // YENİ: İade (kitapAl) başarı mesajında, varsa öğrencinin fotoğrafı bilgi amaçlı gösterilir
            if (actionType === 'kitapAl' && requirePhotoConfirmEnabled && result.photoUrl) {
                msg += `<br><br><img src="${result.photoUrl}" alt="Öğrenci fotoğrafı" style="max-width:140px; max-height:180px; border-radius:10px; object-fit:contain;">`;
            }
            const popup = await Swal.fire({ icon: 'success', title: 'Başarılı', html: msg, showConfirmButton: true, confirmButtonText: 'TAMAM', confirmButtonColor: '#10b981', showDenyButton: true, denyButtonText: 'Geri Al', denyButtonColor: '#ef4444', allowOutsideClick: false });
            if (popup.isDenied) {
                Swal.fire({ title: 'Geri Alınıyor...', didOpen: () => Swal.showLoading() });
                try {
                    // YENİ EKLENEN: Geri alma isteği (Agent'ın sildiği fetch kısmı)
                    const undoPayload = {
                        ...ktAuthFields(),
                        type: actionType === 'kitapVer' ? 'ver' : 'al',
                        bookCode: islemBarkod,
                        studentNo: islemOgrNo
                    };

                    const undoReq = await fetch('/api/undo', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(undoPayload)
                    });
                    const undoRes = await undoReq.json();

                    if (undoRes.status === 'success') {
                        Swal.fire('Geri Alındı', undoRes.message, 'info');
                        getStats(); getOverdueBooks(); getLeaderboard();
                    } else {
                        Swal.fire('Hata', undoRes.message, 'error');
                    }
                } catch (err) {
                    Swal.fire('Hata', 'Geri alma isteği gönderilemedi.', 'error');
                }
            } else if (actionType === 'kitapAl' && result.trackReadingStatus) {
                // YENİ: İade geri alınmadıysa ve ayar açıksa, okuma durumu sorulur (iadeyi engellemez)
                await promptReadingStatus(result.transactionId, result.bookName, result.bookPageCount);
            }
            if (document.getElementById("verBarkod")) document.getElementById("verBarkod").value = "";
            if (document.getElementById("alBarkod")) document.getElementById("alBarkod").value = "";
            // YENİ EKLENEN: Kitap durumu seçim kutularını sıfırla (İsteğe Bağlı seçeneğine döndür)
            if (document.getElementById("verKitapDurum")) document.getElementById("verKitapDurum").value = "";
            if (document.getElementById("alKitapDurum")) document.getElementById("alKitapDurum").value = "";
            // YENİ EKLENEN: Popup kapandığı anda öğrenci numarasını temizle
            if (document.getElementById("verOgrNo")) document.getElementById("verOgrNo").value = "";
            getStats(); getOverdueBooks(); getLeaderboard();
        } else { Swal.fire({ icon: 'error', title: 'Hata', text: result.message }); }
    } catch (error) { Swal.fire({ icon: 'error', title: 'Hata', text: error.message }); }
}

async function sorgula(incomingType) {
    const inputEl = document.getElementById("sorguInput");
    const resultArea = document.getElementById("sorguSonucAlani");
    const query = inputEl.value.trim();
    let searchType = incomingType;

    if (!query) { Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Arama yapın.' }); return; }
    if (!searchType) {
        const popup = await Swal.fire({ title: 'Ne arıyorsunuz?', icon: 'question', showDenyButton: true, confirmButtonText: 'Öğrenci', denyButtonText: 'Kitap', confirmButtonColor: '#6366f1', denyButtonColor: '#f59e0b' });
        if (popup.isConfirmed) searchType = 'student'; else if (popup.isDenied) searchType = 'book'; else return;
    }

    resultArea.innerHTML = '<div style="text-align:center; padding:10px;">Aranıyor...</div>';

    try {
        const response = await fetch('/api/sorgula', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ktAuthFields(), query: query, type: searchType }) });
        const res = await response.json();
        if (res.status === 'success') {
            let html = '';
            let std; // YENİ (Faz A2): düzelt ikonlarına listener bağlamak için if/else dışında erişilebilmesi gerekiyor
            if (res.result.type === 'book') {
                if (res.result.data.length === 0) { resultArea.innerHTML = '<div style="color:red; text-align:center;">Bulunamadı.</div>'; return; }

                res.result.data.forEach(book => {
                    const statusText = book.status === 'In' ? `RAF: ${book.shelf || '?'}` : `KİMDE: ${book.holder} (${book.holderNo})`;
                    const badgeClass = book.status === 'In' ? 'badge-raf' : 'badge-out';
                    const condColor = book.condition === 'Hasarlı' || book.condition === 'Yıpranmış' ? '#ef4444' : '#059669';

                    //  YENİ: Kitap emanetteyse (Out) fazladan şık bir Raf etiketi oluştur.
                    const extraShelfBadge = book.status === 'Out' ? `<span class="badge" style="background:#6366f1; color:white;">Raf: ${book.shelf || '?'}</span>` : '';

                    html += `<div class="result-card" style="border-left-color:#f59e0b;">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <div style="font-weight:bold;">${book.name}</div>
                                </div>
                                <div style="font-size:0.9rem; color:#666;">${book.author} | Barkod: ${book.code}</div>
                                <!-- YENİ: flex-wrap:wrap eklendi (Telefonda etiketler alt alta taşabilsin diye) -->
                                <div style="margin-top:5px; display:flex; gap:5px; flex-wrap:wrap;">
                                    <span class="badge ${badgeClass}">${statusText}</span>
                                    ${extraShelfBadge}
                                    <span class="badge" style="background:${condColor}; color:white;">Durum: ${book.condition || 'Yeni'}</span>
                                </div>
                            </div>`;
                });
            } else {
                std = res.result.data;
                html += `<div class="result-card" style="border-left-color:#6366f1;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-weight:bold; color:#4f46e5; font-size:1.1rem;">${std.name}</div>
                    </div>
                    <div style="font-size:0.9rem;">${std.grade}/${std.className} - ${std.no}</div>
                    <div style="display:flex; gap:10px; margin-top:10px; padding:10px; background:#f9fafb; border-radius:8px;">
                        <div style="flex:1; text-align:center;"><div style="font-weight:bold; color:#3730a3;">${std.totalReadPages}</div><div style="font-size:0.7rem;">Toplam Sayfa</div></div>
                        <div style="flex:1; text-align:center;"><div style="font-weight:bold; color:#059669;">${std.totalReadCount}</div><div style="font-size:0.7rem;">Okuduğu</div></div>
                    </div>
                    <hr style="margin:10px 0; border:0; border-top:1px solid #eee;">
                    <div style="font-weight:bold; font-size:0.8rem; margin-bottom:5px;">Elindeki Kitaplar:</div>`;

                if (std.activeBooks.length > 0) std.activeBooks.forEach(b => html += `<div style="font-size:0.85rem; padding:4px 0; color:#b91c1c;">📕 ${b.name} (${b.code}) <br><small>${b.date} - Durum: <b>${b.condition || 'Yeni'}</b></small></div>`);
                else html += '<div style="color:green; font-size:0.8rem;">Temiz.</div>';

                html += `<div style="margin-top:10px; text-align:center;"><button onclick="document.getElementById('history-${std.no}').classList.toggle('hidden')" style="background:none; border:none; color:#6366f1; cursor:pointer; font-weight:bold; font-size:0.8rem;">Geçmişi Göster ▼</button></div>
                <div id="history-${std.no}" class="hidden" style="margin-top:10px; max-height:150px; overflow-y:auto;">`;

                std.history.forEach((h, idx) => {
                    if (h.status === 'Completed') {
                        // YENİ: Okuma durumu rozeti (belirtilmemişse ve "belirtilmedi" koşulu
                        // sunucudan gelmemişse hiçbir rozet gösterilmez)
                        let readingBadge = '';
                        if (h.readingStatus === 'read') readingBadge = '<span style="margin-left:6px; color:#059669; font-weight:bold;">✅ Okudu</span>';
                        else if (h.readingStatus === 'partially_read') readingBadge = `<span style="margin-left:6px; color:#b45309; font-weight:bold;">📖 Kısmen (${h.pagesRead} syf)</span>`;
                        else if (h.readingStatus === 'not_read') readingBadge = '<span style="margin-left:6px; color:#dc2626; font-weight:bold;">❌ Okumadı</span>';
                        else if (h.unspecified) readingBadge = '<span style="margin-left:6px; color:#9ca3af; font-size:0.75rem;">belirtilmedi</span>';

                        // YENİ (Faz A2): Düzelt ikonu yalnızca yönetici için ve sunucu bu satıra
                        // transactionId döndürmüşse (admin olmayanlarda bu alan hiç gelmez).
                        let editIcon = '';
                        if (h.transactionId && localStorage.getItem('kt_role') === 'admin') {
                            editIcon = `<span class="history-edit-icon" data-idx="${idx}" style="margin-left:8px; cursor:pointer;" title="Okuma durumunu düzelt">✏️</span>`;
                        }

                        html += `<div style="font-size:0.8rem; padding:5px 0; border-bottom:1px solid #f3f4f6;">✅ ${h.name} <span style="color:#6b7280;">(${h.pages} syf)</span>${readingBadge}${editIcon}</div>`;
                    }
                });
                html += `</div></div>`;
            }
            resultArea.innerHTML = html;

            // YENİ (Faz A2): Düzelt ikonlarına, kitap adını onclick string'ine gömmeden
            // (tırnak/kaçış riski olmadan) event listener bağlanır.
            if (res.result.type === 'student') {
                resultArea.querySelectorAll('.history-edit-icon').forEach(icon => {
                    const idx = parseInt(icon.dataset.idx, 10);
                    const h = std.history[idx];
                    icon.addEventListener('click', () => {
                        const panelEl = document.getElementById(`history-${std.no}`);
                        const wasOpen = panelEl ? !panelEl.classList.contains('hidden') : false;
                        editReadingStatusForHistoryRow(h.transactionId, h.name, h.pages, h.readingStatus, h.pagesRead, async () => {
                            await sorgula('student');
                            const refreshedPanel = document.getElementById(`history-${std.no}`);
                            if (refreshedPanel && wasOpen) refreshedPanel.classList.remove('hidden');
                        });
                    });
                });
            }
        } else { resultArea.innerHTML = `<div style="color:red; text-align:center;">${res.message}</div>`; }
    } catch (e) { resultArea.innerHTML = 'Hata.'; }
}

async function kaydet(type) {
    let data = { ...ktAuthFields() };
    let endpoint = "";

    if (type === 'student') {
        const studentPayload = buildStudentPayload({
            no: document.getElementById("newOgrNo").value,
            name: document.getElementById("newOgrAd").value,
            grade: document.getElementById("newOgrKademe").value,
            className: document.getElementById("newOgrSube").value
        });
        if (!studentPayload) { Swal.fire('Eksik', 'Bilgileri doldurunuz.', 'warning'); return; }
        Object.assign(data, studentPayload);
        endpoint = "/api/addStudent";
    } else {
        const bName = document.getElementById("newKitapAd").value;
        const auth = document.getElementById("newKitapYazar").value;
        const pg = document.getElementById("newKitapSayfa").value;
        const typ = document.getElementById("newKitapTur").value;
        const shlf = document.getElementById("newKitapRaf").value;
        const qty = document.getElementById("newKitapAdet").value;
        const cond = document.getElementById("newKitapDurum").value;
        const brc = document.getElementById("newKitapBarkod").value.trim();
        const rangeMode = document.getElementById("newKitapBarkodRangeMode")?.checked || false;
        if (!bName) { Swal.fire('Eksik', 'Kitap Adı zorunludur.', 'warning'); return; }
        if (rangeMode && (parseInt(qty) || 1) > 1 && !brc) {
            Swal.fire('Eksik', '"Başlangıç Barkodu Belirle" işaretliyken başlangıç barkodunu giriniz.', 'warning');
            return;
        }
        data.name = bName; data.author = auth; data.page = pg; data.type = typ; data.shelf = shlf; data.quantity = qty; data.condition = cond;
        data.barcode = brc;
        data.customBarcodeRange = rangeMode;
        endpoint = "/api/addBook";
    }

    Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const r = await res.json();
        if (r.status === 'success' || r.status === 'partial') {
            if (type === 'book') {
                let barcodesHtml = r.barcodes && r.barcodes.length > 5 ? `Barkod: ${r.barcodes[0]} - ${r.barcodes[r.barcodes.length - 1]}` : `Barkod: ${r.barcodes.join(', ')}`;
                Swal.fire({ icon: 'success', title: '📚 Kitaplar Eklendi', html: `<div><b>${data.name}</b> (${data.quantity} adet)</div><div style="color:#059669; font-weight:bold;">${barcodesHtml}</div>` });
            } else { Swal.fire('Başarılı', r.message, 'success'); }
            document.querySelectorAll('#yonetim-form-' + type + ' input').forEach(i => {
                if (i.type === 'checkbox') { i.checked = false; }
                else if (i.id !== 'newKitapAdet') { i.value = ''; }
                else { i.value = '1'; }
            });
            if (type === 'book' && typeof updateBookBarcodeFieldState === 'function') updateBookBarcodeFieldState();
        } else {
            const errorMessage = r && r.message ? r.message : 'İşlem başarısız oldu.';
            Swal.fire({ icon: 'error', title: 'Hata', html: errorMessage.replace(/\n/g, '<br>') });
        }
    } catch (e) {
        const fallbackMessage = e && e.message ? e.message : 'Sunucu hatası.';
        Swal.fire({ icon: 'error', title: 'Hata', html: fallbackMessage.replace(/\n/g, '<br>') });
    }
}

// Öğrenciyi Arama
async function searchStudentForEdit() {
    const query = document.getElementById("studentSearchInput").value.trim();
    if (!query) return;

    const resultsArea = document.getElementById("studentSearchResults");
    resultsArea.innerHTML = '<div style="text-align:center; padding:10px;">Aranıyor...</div>';

    try {
        const res = await fetch('/api/searchStudentsAdvanced', { // Backend'e yeni bir endpoint yazdıracağız
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), query: query })
        });
        const r = await res.json();

        if (r.status === 'success' && r.data.length > 0) {
            resultsArea.innerHTML = r.data.map(std => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#f3f4f6; padding:10px; border-radius:8px;">
                    <div><b>${std.full_name}</b> <br><small style="color:#6b7280;">No: ${std.student_no} | ${std.grade}/${std.class_name}</small></div>
                    <button onclick='fillStudentEditForm(${JSON.stringify(std).replace(/'/g, "&apos;")})' style="background:#8b5cf6; color:white; border:none; padding:5px 15px; border-radius:6px; cursor:pointer;">Seç</button>
                </div>
            `).join('');
        } else {
            resultsArea.innerHTML = '<div style="color:red; text-align:center;">Öğrenci bulunamadı.</div>';
        }
    } catch (e) { resultsArea.innerHTML = 'Hata oluştu.'; }
}

// Seçilen Öğrenciyi Forma Doldurma
function fillStudentEditForm(std) {
    document.getElementById("editS_oldNo").value = std.student_no;
    document.getElementById("editS_name").value = std.full_name;
    document.getElementById("editS_no").value = std.student_no;
    document.getElementById("editS_grade").value = std.grade;
    document.getElementById("editS_class").value = std.class_name;
    document.getElementById("studentEditFormArea").style.display = "block";
}

// Bilgileri Kaydetme
async function saveStudentEdit() {
    const payload = {
        ...ktAuthFields(),
        oldNo: document.getElementById("editS_oldNo").value,
        newNo: document.getElementById("editS_no").value,
        newName: document.getElementById("editS_name").value,
        newGrade: document.getElementById("editS_grade").value,
        newClass: document.getElementById("editS_class").value
    };

    Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/updateStudentDetailed', { // Backend'e yeni/güncellenmiş endpoint
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const r = await res.json();
        if (r.status === 'success') {
            Swal.fire('Başarılı', 'Öğrenci bilgileri güncellendi.', 'success');
            closeStudentEditModal();
        } else Swal.fire('Hata', r.message, 'error');
    } catch (e) { Swal.fire('Hata', 'Sunucu hatası', 'error'); }
}

// Güvenli Silme (Zırhlı Buton)
async function deleteStudentEdit() {
    const studentName = document.getElementById("editS_name").value;
    const studentNo = document.getElementById("editS_oldNo").value;

    const confirmed = await Swal.fire({
        title: 'Emin misiniz?',
        html: `<b>${studentName}</b> adlı öğrenciyi sistemden silmek/arşivlemek üzeresiniz.<br><br><i>Not: Üzerinde teslim edilmemiş kitap varsa silinemez.</i>`,
        icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#6b7280', confirmButtonText: 'Evet, Sil!', cancelButtonText: 'İptal'
    });

    if (!confirmed.isConfirmed) return;

    Swal.fire({ title: 'Siliniyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/archive', { // Mevcut arşivleme servisimizi kullanıyoruz
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), code: studentNo, type: 'student' })
        });
        const r = await res.json();
        if (r.status === 'success') {
            Swal.fire('Silindi', 'Öğrenci başarıyla silindi.', 'success');
            closeStudentEditModal();
        } else Swal.fire('Hata', r.message, 'error');
    } catch (e) { Swal.fire('Hata', 'Sunucu hatası', 'error'); }
}
// Öğrenci Düzenleme Modalını Kapat ve Temizle
function closeStudentEditModal() {
    // 1. Modalı gizle
    document.getElementById('studentEditSearchModal').classList.add('hidden');

    // 2. Arama kutusunu ve sonuç listesini sıfırla
    if (document.getElementById('studentSearchInput')) document.getElementById('studentSearchInput').value = '';
    if (document.getElementById('studentSearchResults')) document.getElementById('studentSearchResults').innerHTML = '';

    // 3. Form kutularını sıfırla ve form alanını gizle
    if (document.getElementById('studentEditFormArea')) document.getElementById('studentEditFormArea').style.display = 'none';
    if (document.getElementById('editS_oldNo')) document.getElementById('editS_oldNo').value = '';
    if (document.getElementById('editS_name')) document.getElementById('editS_name').value = '';
    if (document.getElementById('editS_no')) document.getElementById('editS_no').value = '';
    if (document.getElementById('editS_grade')) document.getElementById('editS_grade').value = '';
    if (document.getElementById('editS_class')) document.getElementById('editS_class').value = '';
}

async function getReport() {
    const grdSelect = document.getElementById("reportGrade");
    const clsSelect = document.getElementById("reportClass");
    const monSelect = document.getElementById("reportMonth");

    // YENİ: Bir seçicide hiçbir option seçili değilse (selectedIndex -1 — örn. kısıtlı sınıf
    // yetkili bir öğretmende seçenekler henüz filtrelenmemişse) .text erişimi çökerdi.
    if (grdSelect.selectedIndex < 0 || clsSelect.selectedIndex < 0 || monSelect.selectedIndex < 0) {
        Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Lütfen kademe ve şube seçin.', allowEnterKey: false, focusConfirm: false, focusCancel: false });
        return;
    }

    const grd = grdSelect.value;
    const cls = clsSelect.value;
    const mon = monSelect.value;

    const resDiv = document.getElementById("report-result");
    const printBtn = document.getElementById("printBtn"); // YENİ EKLENDİ

    // YENİ (Faz B): Yeniden çekmeden önce hangi öğrenci kartlarının "Detay"ı açıksa not al,
    // render bittikten sonra aynı kartları tekrar açık yap (örn. ✏️ ile düzeltme sonrası).
    const openStudentNos = Array.from(resDiv.querySelectorAll('.report-item.active')).map(el => el.dataset.studentNo);

    // Rapor çekilmeye başlarken veya yeni sorguda butonu pasif et
    if (printBtn) { printBtn.disabled = true; printBtn.style.opacity = "0.5"; printBtn.style.cursor = "not-allowed"; }

    resDiv.innerHTML = '<div style="text-align:center;">Hesaplanıyor...</div>';
    try {
        const res = await fetch('/api/getReport', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), filterGrade: grd, filterClass: cls, filterMonth: mon })
        });
        const r = await res.json();
        if (r.status === 'success') {
            if (r.data.length === 0) { resDiv.innerHTML = '<div style="text-align:center; color:red;">Kayıt yok.</div>'; return; }

            const grdText = grdSelect.options[grdSelect.selectedIndex]?.text || '';
            const clsText = clsSelect.options[clsSelect.selectedIndex]?.text || '';
            const monText = monSelect.options[monSelect.selectedIndex]?.text || '';

            let titleClass = '';
            const gradeMatch = grdText.match(/\d+/);
            const gradeNum = gradeMatch ? gradeMatch[0] : grdText;

            if (grd === 'ALL' && cls === 'ALL') {
                titleClass = 'TÜM OKUL';
            } else if (grd !== 'ALL' && cls === 'ALL') {
                titleClass = `${gradeNum}. SINIFLAR`;
            } else if (grd === 'ALL' && cls !== 'ALL') {
                titleClass = `${clsText} ŞUBELERİ`;
            } else {
                titleClass = `${gradeNum}/${clsText} SINIFI`;
            }

            let titleMonth = mon === 'ALL' ? 'TÜM ZAMANLAR' :
                (mon === 'TERM1' || mon === 'TERM2') ? monText.toLocaleUpperCase('tr-TR') :
                    `${monText.toLocaleUpperCase('tr-TR')} AYI`;
            let reportTitle = `${titleClass} ${titleMonth} OKUMA RAPORU`;


            let html = `
            <div style="text-align:center; margin-bottom:20px; padding-bottom:10px; border-bottom:2px solid #274ae4; page-break-after: avoid;">
                <h2 style="margin:0; font-size:1.3rem; color:#1f2937;">${reportTitle}</h2>
            </div>
            <div style="font-weight:bold; margin-bottom:10px;">Sonuçlar (${r.data.length} Öğrenci): <span style="font-size:0.8rem; font-weight:normal; color:#6b7280; display:inline-block;" class="hide-on-print">(Detaylar için tıklayın)</span></div>`;

            // YENİ (Faz B): 50 sınırı aşılırsa not — yazdırma çıktısında da görünsün (hide-on-print YOK)
            if (r.data.length > 50) {
                html += `<div style="text-align:center; color:#9ca3af; font-size:0.8rem; margin-bottom:10px;">İlk 50 öğrenci gösteriliyor (toplam ${r.data.length}).</div>`;
            }

            const slicedData = r.data.slice(0, 50);

            slicedData.forEach((item, index) => {
                let booksHtml = "";
                if (item.books && item.books.length > 0) {
                    item.books.forEach((b, bookIndex) => {
                        // YENİ (Faz B): durum rozeti + sayfa biçimi (ayar kapalıyken b.readingStatus
                        // hiç gelmediği için bu bloklar hiç tetiklenmez, eski görünüm aynen kalır).
                        let badge = '';
                        let pageText = `${b.page} syf`;
                        let rowStyle = '';

                        if (b.readingStatus === 'read') {
                            badge = '<span style="margin-left:6px; color:#059669; font-weight:bold; font-size:0.75rem;">✅ Okudu</span>';
                        } else if (b.readingStatus === 'partially_read') {
                            badge = '<span style="margin-left:6px; color:#b45309; font-weight:bold; font-size:0.75rem;">📖 Kısmen</span>';
                            pageText = `${b.pagesRead} / ${b.pageCount} syf`;
                        } else if (b.readingStatus === 'not_read') {
                            badge = '<span style="margin-left:6px; color:#dc2626; font-weight:bold; font-size:0.75rem;">❌ Okumadı</span>';
                            rowStyle = 'opacity:0.6;';
                        } else if (b.unspecified) {
                            badge = '<span style="margin-left:6px; color:#9ca3af; font-size:0.7rem;">belirtilmedi</span>';
                            rowStyle = 'color:#9ca3af;';
                        }

                        // Yalnızca yönetici (sunucu transactionId'yi sadece admin'e döndürür) ve
                        // kitap adını onclick string'ine gömmeden (tırnak/kaçış riski olmadan)
                        // render sonrası event listener ile bağlanacak ✏️ ikonu.
                        let editIcon = '';
                        if (b.transactionId && localStorage.getItem('kt_role') === 'admin') {
                            editIcon = `<span class="report-edit-icon hide-on-print" data-item-idx="${index}" data-book-idx="${bookIndex}" style="margin-left:8px; cursor:pointer;" title="Okuma durumunu düzelt">✏️</span>`;
                        }

                        booksHtml += `<div style="padding: 4px 0; border-bottom: 1px dashed #e5e7eb; ${rowStyle}">📕 ${b.name}${badge}${editIcon} <span style="color:#6b7280; float:right;">${pageText}</span></div>`;
                    });
                } else {
                    booksHtml = `<div style="color:#9ca3af;">Veri yok.</div>`;
                }

                // YENİ (Faz B): ayar açıkken (item.readCount tanımlıysa) özet satırı
                let summaryLine = '';
                if (item.readCount !== undefined) {
                    summaryLine = `<div style="font-size:0.75rem; color:#6b7280; margin-top:2px;">✅ ${item.readCount} · 📖 ${item.partialCount} · ❌ ${item.notReadCount} · <span style="color:#9ca3af;">belirtilmedi ${item.unspecifiedCount}</span></div>`;
                }

                html += `<div class="report-item" data-student-no="${item.no}" onclick="this.classList.toggle('active')">
                    <div class="report-header-row">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div class="rank-circle">${index + 1}</div>
                            <div><div style="font-weight:bold; color:#1f2937;">${item.name}</div><div style="font-size:0.8rem; color:#6b7280;">${item.className} • No: ${item.no}</div></div>
                        </div>
                        <div style="font-weight:bold; color:#4f46e5; text-align:right;">${item.totalPage} syf <br><span style="font-size:0.7rem; color:#9ca3af;">▼ Detay</span>${summaryLine}</div>
                    </div>
                    <div class="book-details">
                        <div style="font-weight:bold; margin-bottom:5px; color:#374151;">Kitaplar:</div>
                        ${booksHtml}
                    </div>
                </div>`;
            });

            resDiv.innerHTML = html;

            // YENİ (Faz B): önceden açık olan kartları tekrar aç
            openStudentNos.forEach(no => {
                const card = resDiv.querySelector(`.report-item[data-student-no="${no}"]`);
                if (card) card.classList.add('active');
            });

            // YENİ (Faz B): ✏️ ikonlarına, kitap adını onclick string'ine gömmeden event listener bağla
            resDiv.querySelectorAll('.report-edit-icon').forEach(icon => {
                const itemIdx = parseInt(icon.dataset.itemIdx, 10);
                const bookIdx = parseInt(icon.dataset.bookIdx, 10);
                const b = slicedData[itemIdx].books[bookIdx];
                icon.addEventListener('click', (ev) => {
                    ev.stopPropagation(); // kartın açılıp/kapanmasını tetiklemesin
                    editReadingStatusForHistoryRow(b.transactionId, b.name, b.pageCount, b.readingStatus, b.pagesRead, async () => {
                        await getReport(); // aynı filtrelerle yeniden çek; açık kartlar yukarıdaki mantıkla korunur
                    });
                });
            });

            // Rapor başarıyla basıldı, PDF butonunu aktif et
            if (printBtn) { printBtn.disabled = false; printBtn.style.opacity = "1"; printBtn.style.cursor = "pointer"; }

        } else resDiv.innerHTML = 'Hata.';
    } catch (e) {
        resDiv.innerHTML = 'Sistem Hatası: ' + e.message;
        console.error("Detaylı Hata:", e);
    }
}

// YENİ (Faz B): "Rapor Al" ekranını printBorrowedReport'taki gizli iframe deseniyle yazdırır.
// .book-details normalde yalnızca .active kartlarda görünür; yazdırma çıktısında TÜMÜ açık
// gösterilsin diye zorla görünür yapılır. ✏️ ikonları (ve diğer .hide-on-print ögeleri) basılmaz.
function printReadingReport() {
    const reportContent = document.getElementById('report-result').innerHTML;

    let oldFrame = document.getElementById('kutuphanePrintFrame');
    if (oldFrame) oldFrame.remove();

    const iframe = document.createElement('iframe');
    iframe.setAttribute('id', 'kutuphanePrintFrame');
    iframe.style.visibility = 'hidden';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.write('<html><head><title>Okuma Raporu</title>');
    doc.write('<style>body{font-family:sans-serif; color:#1f2937; padding:20px;} .hide-on-print{display:none !important;} .report-item{margin-bottom:15px; border-bottom:1px solid #e5e7eb; padding-bottom:10px; page-break-inside: avoid;} .rank-circle{display:inline-block; width:24px; height:24px; background:#f59e0b; color:#fff; border-radius:50%; text-align:center; line-height:24px; font-size:12px; font-weight:bold; margin-right:10px;} .report-header-row{display:flex; align-items:center; justify-content:space-between;} .book-details{display:block !important;}</style>');
    doc.write('</head><body>');
    doc.write(reportContent);
    doc.write('</body></html>');
    doc.close();

    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 500);
}

// --- YENİ EKLENEN: Emanet Raporunu Çeken Fonksiyon ---
async function getBorrowedReport() {
    const grdSelect = document.getElementById("borrowedReportGrade");
    const clsSelect = document.getElementById("borrowedReportClass");
    const statSelect = document.getElementById("borrowedReportStatus");

    // YENİ: Bir seçicide hiçbir option seçili değilse (selectedIndex -1) .text erişimi çökerdi.
    if (grdSelect.selectedIndex < 0 || clsSelect.selectedIndex < 0) {
        Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Lütfen kademe ve şube seçin.', allowEnterKey: false, focusConfirm: false, focusCancel: false });
        return;
    }

    const grd = grdSelect.value;
    const cls = clsSelect.value;
    const stat = statSelect.value;

    const resDiv = document.getElementById("borrowed-report-result");
    const printBtn = document.getElementById("borrowedPrintBtn");

    if (printBtn) { printBtn.disabled = true; printBtn.style.opacity = "0.5"; printBtn.style.cursor = "not-allowed"; }

    resDiv.innerHTML = '<div style="text-align:center;">Hesaplanıyor...</div>';

    try {
        const res = await fetch('/api/getBorrowedReport', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), filterGrade: grd, filterClass: cls, filterStatus: stat })
        });
        const r = await res.json();

        if (r.status === 'success') {
            if (r.data.length === 0) { resDiv.innerHTML = '<div style="text-align:center; color:red;">Kayıt yok.</div>'; return; }

            const grdText = grdSelect.options[grdSelect.selectedIndex]?.text || '';
            const clsText = clsSelect.options[clsSelect.selectedIndex]?.text || '';

            let titleClass = '';
            const gradeMatch = grdText.match(/\d+/);
            const gradeNum = gradeMatch ? gradeMatch[0] : grdText;

            if (grd === 'ALL' && cls === 'ALL') titleClass = 'TÜM OKUL';
            else if (grd !== 'ALL' && cls === 'ALL') titleClass = `${gradeNum}. SINIFLAR`;
            else if (grd === 'ALL' && cls !== 'ALL') titleClass = `${clsText} ŞUBELERİ`;
            else titleClass = `${gradeNum}/${clsText} SINIFI`;

            let reportTitle = `${titleClass} EMANETTEKİ KİTAPLAR RAPORU`;
            if (stat === 'OVERDUE') reportTitle = `${titleClass} GECİKEN KİTAPLAR RAPORU`;

            let html = `
            <div style="text-align:center; margin-bottom:20px; padding-bottom:10px; border-bottom:2px solid #f59e0b; page-break-after: avoid;">
                <h2 style="margin:0; font-size:1.3rem; color:#1f2937;">${reportTitle}</h2>
            </div>
            <div style="font-weight:bold; margin-bottom:10px;">Sonuçlar (${r.data.length} Öğrenci): <span style="font-size:0.8rem; font-weight:normal; color:#6b7280; display:inline-block;" class="hide-on-print">(Detaylar için tıklayın)</span></div>`;

            r.data.forEach((item, index) => {
                let booksHtml = "";
                if (item.books && item.books.length > 0) {
                    item.books.forEach(b => {
                        const statusBadge = `<span style="color: ${b.statusColor}; font-size: 0.8rem; font-weight: bold; float:right;">${b.statusText}</span>`;
                        booksHtml += `<div style="padding: 4px 0; border-bottom: 1px dashed #e5e7eb;">📕 ${b.name} <span style="color:#6b7280; font-size:0.75rem;">#${b.barcode || '-'}</span> ${statusBadge}</div>`;
                    });
                }

                // Deneliz'deki gecikme görseli uyarısı (Kırmızı satır ve Ünlem)
                const isOverdue = item.hasOverdue;
                const activeBorder = isOverdue ? 'border: 1px solid #fca5a5;' : '';
                const activeBg = isOverdue ? 'background: #fef2f2;' : '';
                const warningIcon = isOverdue ? '<span title="Gecikmiş Kitap!" style="margin-left:5px;">⚠️</span>' : '';

                html += `<div class="report-item" style="${activeBorder} ${activeBg}" onclick="this.classList.toggle('active')">
                    <div class="report-header-row">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div class="rank-circle" style="background:#f59e0b;">${index + 1}</div>
                            <div><div style="font-weight:bold; color:#1f2937;">${item.name}${warningIcon}</div><div style="font-size:0.8rem; color:#6b7280;">${item.className} • No: ${item.no}</div></div>
                        </div>
                        <div style="font-weight:bold; color:#f59e0b; text-align:right;">${item.books.length} Kitap <br><span style="font-size:0.7rem; color:#9ca3af;">▼ Detay</span></div>
                    </div>
                    <div class="book-details">
                        <div style="font-weight:bold; margin-bottom:5px; color:#374151;">Emanetteki Kitaplar:</div>
                        ${booksHtml}
                    </div>
                </div>`;
            });

            resDiv.innerHTML = html;
            if (printBtn) { printBtn.disabled = false; printBtn.style.opacity = "1"; printBtn.style.cursor = "pointer"; }

        } else resDiv.innerHTML = 'Hata: ' + r.message;
    } catch (e) { resDiv.innerHTML = 'Sunucu Hatası.'; }
}

// --- YENİ EKLENEN: Emanet Raporunu PDF Olarak Yazdırma ---
function printBorrowedReport() {
    const reportContent = document.getElementById('borrowed-report-result').innerHTML;

    // Varsa eski gizli iframe'i temizle
    let oldFrame = document.getElementById('kutuphanePrintFrame');
    if (oldFrame) oldFrame.remove();

    // Yeni gizli iframe oluştur
    const iframe = document.createElement('iframe');
    iframe.setAttribute('id', 'kutuphanePrintFrame');
    iframe.style.visibility = 'hidden';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    // Iframe'in içine HTML ve CSS bas
    const doc = iframe.contentWindow.document;
    doc.write('<html><head><title>Emanet Raporu</title>');
    doc.write('<style>body{font-family:sans-serif; color:#1f2937; padding:20px;} .hide-on-print{display:none !important;} .report-item{margin-bottom:15px; border-bottom:1px solid #e5e7eb; padding-bottom:10px; page-break-inside: avoid;} .rank-circle{display:inline-block; width:24px; height:24px; background:#f59e0b; color:#fff; border-radius:50%; text-align:center; line-height:24px; font-size:12px; font-weight:bold; margin-right:10px;} .report-header-row{display:flex; align-items:center; justify-content:space-between;}</style>');
    doc.write('</head><body>');
    doc.write(reportContent);
    doc.write('</body></html>');
    doc.close();

    // İçeriğin DOM'a yüklenmesi için ufak bir gecikme ve ardından tetikleme
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 500);
}

async function getStats() {
    try {
        const response = await fetch('/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ktAuthFields() }) });
        const res = await response.json();
        if (res.status === 'success') { document.getElementById("stat-kitap").innerText = res.data.kitap; document.getElementById("stat-ogrenci").innerText = res.data.ogrenci; document.getElementById("stat-emanet").innerText = res.data.emanet; }
    } catch (error) { }
}

async function showStatDetails(type) {
    let title = type === 'emanet' ? 'Emanetteki Kitaplar' : (type === 'kitap' ? 'Tüm Kitaplar' : 'Kayıtlı Öğrenciler');

    Swal.fire({ title: 'Yükleniyor...', didOpen: () => Swal.showLoading() });

    try {
        const response = await fetch('/api/statDetails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), type: type })
        });
        const res = await response.json();

        if (res.status === 'success') {
            if (res.data.length === 0) {
                return Swal.fire({ icon: 'info', title, text: 'Gösterilecek kayıt bulunamadı.' });
            }

            let html = `<div style="max-height: 400px; overflow-y: auto; text-align: left; padding-right: 5px;">`;

            if (type === 'emanet') {
                res.data.forEach((item, index) => {
                    let dateStr = new Date(item.borrow_date).toLocaleDateString("tr-TR");
                    // Kademe ve Şubeyi akıllıca birleştir
                    let sinifBilgisi = (item.students?.grade ? item.students.grade + '/' : '') + (item.students?.class_name || '-');

                    html += `<div style="padding: 10px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'}; border-radius: 8px; margin-bottom: 5px;">
                        <div style="font-weight: bold; color: #b91c1c; font-size: 0.95rem;">📖 ${item.books?.book_name || 'Bilinmeyen'} <span style="font-size: 0.75rem; color: #6b7280; font-weight: normal;">(#${item.books?.barcode || '-'})</span></div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                            <div style="font-size: 0.85rem; color: #1f2937;"><span class="material-symbols-rounded" style="font-size: 14px; vertical-align: middle;">person</span> ${item.students?.full_name || 'Bilinmeyen'} <span style="color: #6b7280;">(${sinifBilgisi} | No: ${item.students?.student_no || '-'})</span></div>
                            <div style="font-size: 0.75rem; color: #4f46e5; font-weight: bold;">${dateStr}</div>
                        </div>
                    </div>`;
                });
            } else if (type === 'kitap') {
                res.data.forEach((item, index) => {
                    html += `<div style="padding: 8px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'};">
                        <div style="font-weight: bold; color: #1f2937;">${item.book_name}
                            ${item.category ? `<span style="margin-left: 8px; font-size: 0.72rem; font-weight: 600; color: #6d28d9; background: #ede9fe; border-radius: 999px; padding: 2px 9px;">${item.category}</span>` : ''}
                        </div>
                        <div style="font-size: 0.8rem; color: #6b7280;">
                            Barkod: ${item.barcode} | Raf: ${item.shelf || '?'} | Durum: ${item.condition || 'Yeni'}
                            ${item.page_count ? `&nbsp;|&nbsp;<span style="color: #0369a1; font-weight: 600;">${item.page_count} syf</span>` : ''}
                        </div>
                    </div>`;
                });
            } else if (type === 'ogrenci') {
                res.data.forEach((item, index) => {
                    // Kademe ve Şubeyi akıllıca birleştir
                    let sinifBilgisi = (item.grade ? item.grade + '/' : '') + (item.class_name || '-');

                    html += `<div style="padding: 8px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'};">
                        <div style="font-weight: bold; color: #1f2937;">${item.full_name}</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Sınıf: ${sinifBilgisi} | No: ${item.student_no}</div>
                    </div>`;
                });
            }
            html += `</div>`;

            Swal.fire({
                title: title + ` (${res.data.length})`,
                html: html,
                width: 500,
                showCloseButton: true,
                confirmButtonText: 'Kapat',
                confirmButtonColor: '#4f46e5'
            });
        } else {
            Swal.fire('Hata', res.message, 'error');
        }
    } catch (error) {
        Swal.fire('Hata', 'Bağlantı sorunu oluştu.', 'error');
    }
}

async function getLeaderboard() {
    const listEl = document.getElementById("leaderboard-list");
    const sectionEl = document.getElementById("leaderboard-section");

    // YENİ: Nöbetçi rolünde bölüm hiç yüklenmeden gizlenir, sunucuya istek bile atılmaz.
    if (localStorage.getItem("kt_role") === 'duty') {
        if (sectionEl) sectionEl.style.display = 'none';
        return;
    }

    try {
        const response = await fetch('/api/getReport', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), filterGrade: 'ALL', filterClass: 'ALL', filterMonth: 'ALL' })
        });
        const result = await response.json();
        if (result.status === 'success') {
            // YENİ: Sunucu nöbetçi için hidden:true dönerse (ikinci savunma hattı) bölümü gizle
            if (result.hidden) {
                if (sectionEl) sectionEl.style.display = 'none';
                return;
            }
            if (sectionEl) sectionEl.style.display = '';

            const top3 = result.data.slice(0, 3);
            const medals = ['🥇', '🥈', '🥉'];

            // Sıralama değişimi tespiti için önceki listeyi DOM'da güvenle saklıyoruz
            const prevTopNames = listEl.dataset.prevList ? JSON.parse(listEl.dataset.prevList) : null;
            listEl.dataset.prevList = JSON.stringify(top3.map(i => i.name));

            if (top3.length === 0) {
                listEl.innerHTML = `<div style="text-align:center; color:#9ca3af; font-size:0.9rem; padding:10px;">Henüz veri yok. İlk kitabı sen oku!</div>`;
                return;
            }

            // Animasyon stilini dinamik olarak inject ediyoruz
            const styleTag = `<style>@keyframes flashHighlight { 0% { background-color: #fef08a; transform: scale(1.02); } 100% { background-color: #f9fafb; transform: scale(1); } }</style>`;

            listEl.innerHTML = styleTag + top3.map((item, index) => {
                // Öğrenci önceden yoksa veya daha düşük sıradaysa animasyon stilini ekle
                const prevRank = prevTopNames ? prevTopNames.indexOf(item.name) : index;
                const isRankUp = prevTopNames !== null && (prevRank === -1 || prevRank > index);
                const animStyle = isRankUp ? "animation: flashHighlight 2.5s ease-out;" : "";

                return `
                <div style="display: flex; align-items: center; justify-content: space-between; background: #f9fafb; padding: 10px 15px; border-radius: 12px; border: 1px solid #f3f4f6; transition: all 0.3s; ${animStyle}">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.4rem;">${medals[index] || '🏅'}</span>
                        <div>
                            <div style="font-weight: bold; color: #1f2937; font-size: 0.95rem;">${item.name}</div>
                            <div style="font-size: 0.8rem; color: #6b7280;">${item.className}</div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: bold; color: #4f46e5; font-size: 1.1rem;">${item.totalPage}</div>
                        <div style="font-size: 0.7rem; color: #9ca3af; font-weight: bold;">SAYFA</div>
                    </div>
                </div>`;
            }).join('');
        }
    } catch (err) {
        listEl.innerHTML = `<div style="color:red; text-align:center; font-size:0.8rem;">Yüklenemedi.</div>`;
    }
}

async function getOverdueBooks() {
    const listArea = document.getElementById("overdue-list");
    try {
        const response = await fetch('/api/overdue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ktAuthFields() }) });
        const res = await response.json();
        if (res.status === 'success' && res.data.length > 0) {

            listArea.innerHTML = res.data.map(item => `
                <div style="display:flex; gap:10px; padding:8px 0; border-bottom:1px solid #fee2e2;">
                    <span class="material-symbols-rounded" style="color:#ef4444;">warning</span>
                    <div>
                        <div style="font-weight:bold; font-size:0.9rem; color:#991b1b;">${item.student}</div>
                        <div style="font-size:0.8rem; color:#b91c1c;">
                            <span style="font-weight:bold;">#${item.code}</span> - ${item.book} (${item.date})
                        </div>
                    </div>
                </div>
            `).join('');

        } else { listArea.innerHTML = '<div style="text-align:center; color:#059669; padding:10px;">Geciken yok! 👍</div>'; }
    } catch (e) { }
}

let suggestionTimeout;

async function loadBookSuggestions(query) {
    // Kullanıcı en az 2 harf yazmadan arama yapma
    if (!query || query.length < 2) {
        document.getElementById("bookSuggestions").innerHTML = "";
        return;
    }

    // Debounce: Kullanıcı hızlı hızlı yazarken her harfte sunucuya istek atmasını engeller.
    // Yazmayı bıraktıktan 300ms sonra tek bir istek atar.
    clearTimeout(suggestionTimeout);
    suggestionTimeout = setTimeout(async () => {
        try {
            // Arama terimini backend'e parametre olarak gönderiyoruz
            const res = await fetch(`/api/globalBooks?q=${encodeURIComponent(query)}`);
            const r = await res.json();

            if (r.status === 'success') {
                const datalist = document.getElementById("bookSuggestions");
                let options = "";
                r.data.forEach(book => {
                    options += `<option value="${book}">`;
                });
                datalist.innerHTML = options;
            }
        } catch (error) {
            console.error("Öneriler yüklenemedi", error);
        }
    }, 300);
}



async function loadSettings() {
    try {
        const response = await fetch('/api/getSettings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ktAuthFields() }) });
        const res = await response.json();
        if (res.status === 'success') {
            const s = res.data || {};

            // YENİ: Okul logosu (header + Ayarlar sayfasındaki önizleme)
            const logoPreviewEl = document.getElementById("setting_logo_preview");
            if (logoPreviewEl) {
                logoPreviewEl.innerHTML = s.logo_url
                    ? `<img src="${s.logo_url}" alt="Okul Logosu" style="width:100%; height:100%; object-fit:cover; border-radius:10px;">`
                    : '🏫';
            }
            const headerLogoEl = document.getElementById("appHeaderLogo");
            if (headerLogoEl) headerLogoEl.src = s.logo_url || 'app_logo.png';

            document.getElementById("setting_max_borrow_limit").value = s.max_borrow_limit || '';

            // YENİ: Dinamik Kuralları Yükleme Mantığı (Eski sabit atamaların yerine)
            const ruleContainer = document.getElementById('dynamic-rules-container');
            if (ruleContainer) {
                ruleContainer.innerHTML = ''; // Önce temizle
                if (s.dynamic_rules && s.dynamic_rules.length > 0) {
                    s.dynamic_rules.forEach(rule => addDynamicRuleRow(rule.max_pages, rule.min_days, rule.max_days));
                } else {
                    addDynamicRuleRow('', '', ''); // Kural yoksa boş bir tane aç
                }
            }

            document.getElementById("setting_lib_open_time").value = s.lib_open_time || '';
            document.getElementById("setting_lib_close_time").value = s.lib_close_time || '';

            const allowLendingArchivedEl = document.getElementById("setting_allow_lending_to_archived");
            if (allowLendingArchivedEl) allowLendingArchivedEl.checked = !!s.allow_lending_to_archived;

            // YENİ: require_photo_confirm — alan tanımsızsa varsayılan true kabul edilir
            requirePhotoConfirmEnabled = (s.require_photo_confirm !== false);
            const requirePhotoConfirmEl = document.getElementById("setting_require_photo_confirm");
            if (requirePhotoConfirmEl) requirePhotoConfirmEl.checked = requirePhotoConfirmEnabled;

            // YENİ: track_reading_status — alan tanımsızsa varsayılan KAPALI kabul edilir
            const trackReadingStatusEl = document.getElementById("setting_track_reading_status");
            if (trackReadingStatusEl) trackReadingStatusEl.checked = (s.track_reading_status === true);

            document.getElementById("setting_staff_pass_mode").value = s.staff_pass_mode || 'fixed';
            if (s.staff_pass_mode === 'fixed') {
                document.getElementById("setting_fixed_staff_name").value = s.fixed_staff_name || s.staff_names || '';
                document.getElementById("setting_staff_password").value = s.fixed_staff_password || s.staff_password || '';
                currentStaffNames = [];
            } else if (s.staff_pass_mode === 'hybrid') {
                document.getElementById("setting_fixed_staff_name").value = s.fixed_staff_name || '';
                document.getElementById("setting_staff_password").value = s.fixed_staff_password || '';
                currentStaffNames = s.daily_staff_names ? s.daily_staff_names.split(',').map(n => n.trim()).filter(Boolean) : [];
            } else {
                document.getElementById("setting_fixed_staff_name").value = '';
                document.getElementById("setting_staff_password").value = '';
                currentStaffNames = s.daily_staff_names ? s.daily_staff_names.split(',').map(n => n.trim()).filter(Boolean) : (s.staff_names ? s.staff_names.split(',').map(n => n.trim()).filter(Boolean) : []);
            }
            renderStaffList();
            if (typeof toggleStaffGroups === 'function') toggleStaffGroups();
            // YENİ: Eğitim yılı dropdown'ını mevcut değerle doldur
            const yearSelect = document.getElementById('setting_academic_year');
            if (yearSelect && s.active_academic_year) {
                yearSelect.value = s.active_academic_year;
            }
        }
    } catch (e) { console.error("Ayarlar yüklenemedi", e); }
}

// YENİ: Okul Logosu Seçimi ve Yüklemesi
let pendingLogoFile = null;

function handleLogoFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const MAX_SIZE = 1 * 1024 * 1024; // 1 MB
    if (file.size > MAX_SIZE) {
        Swal.fire({ icon: 'error', title: 'Dosya Çok Büyük', text: "Dosya 1 MB'dan büyük olamaz, lütfen daha küçük bir görsel seçin." });
        event.target.value = '';
        pendingLogoFile = null;
        return;
    }

    pendingLogoFile = file;

    // Kaydetmeden önce anlık yerel önizleme (ağ isteği yok)
    const reader = new FileReader();
    reader.onload = (e) => {
        const previewEl = document.getElementById('setting_logo_preview');
        if (previewEl) {
            previewEl.innerHTML = `<img src="${e.target.result}" alt="Okul Logosu" style="width:100%; height:100%; object-fit:cover; border-radius:10px;">`;
        }
    };
    reader.readAsDataURL(file);
}

async function uploadPendingLogo() {
    if (!pendingLogoFile) return true; // Yüklenecek bir şey yoksa "başarılı" say

    const file = pendingLogoFile;
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();

    try {
        const res = await fetch('/api/uploadSchoolLogo', {
            method: 'POST',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                ...ktAuthHeaderFields(),
                'X-File-Ext': ext
            },
            body: file
        });
        const r = await res.json();

        if (r.success) {
            pendingLogoFile = null;
            const headerLogoEl = document.getElementById("appHeaderLogo");
            if (headerLogoEl) headerLogoEl.src = r.logo_url;
            return true;
        }

        Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'Logo yüklenemedi.' });
        return false;
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
        return false;
    }
}

// YENİ: Eğitim-Öğretim Yılı Kaydetme
async function saveAcademicYear() {
    const yearSelect = document.getElementById("setting_academic_year");
    const academicYear = yearSelect ? yearSelect.value : "";

    if (!academicYear) {
        Swal.fire({ icon: 'warning', title: 'Seçim Yapılmadı', text: 'Lütfen bir eğitim-öğretim yılı seçin.' });
        return;
    }

    Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/updateAcademicYear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), academicYear })
        });
        const result = await res.json();

        if (result.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Güncellendi', text: result.message });
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: result.message });
        }
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

// YENİ: Sınıf Atlatma (Yıl Sonu Toplu Terfi/Mezuniyet)
async function startClassPromotion() {
    const { value: confirmationText, isConfirmed } = await Swal.fire({
        icon: 'warning',
        title: 'Sınıfları Atlat',
        html: `
            <div style="text-align:left; font-size:0.9rem; color:#374151;">
                <p>Bu işlem <b>geri alınamaz</b>:</p>
                <ul style="margin:8px 0; padding-left:20px;">
                    <li>Okul türünüzün en üst kademesindeki tüm aktif öğrenciler <b>mezun/arşiv</b> edilecek (varsa önce Mezun kademesine geçecek, sonraki atlatmada Mezun'dan arşivlenecek).</li>
                    <li>Diğer tüm aktif öğrencilerin sınıfı <b>bir üst sınıfa</b> geçirilecek.</li>
                </ul>
                <p>Devam etmek için aşağıya büyük harflerle <b>ONAYLIYORUM</b> yazın.</p>
            </div>
        `,
        input: 'text',
        inputPlaceholder: 'ONAYLIYORUM',
        showCancelButton: true,
        confirmButtonText: 'Devam Et',
        cancelButtonText: 'Vazgeç',
        confirmButtonColor: '#dc2626',
        inputValidator: (value) => {
            if (value !== 'ONAYLIYORUM') {
                return 'Devam etmek için büyük harflerle tam olarak "ONAYLIYORUM" yazmalısınız.';
            }
        }
    });

    if (!isConfirmed || confirmationText !== 'ONAYLIYORUM') return;

    requestClassPromotion(false);
}

async function requestClassPromotion(force) {
    Swal.fire({ title: 'İşleniyor...', html: 'Öğrenciler güncelleniyor, lütfen bekleyin...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

    try {
        const res = await fetch('/api/promoteAllStudents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), force: !!force })
        });
        const result = await res.json();

        if (result.success) {
            Swal.fire({
                icon: 'success',
                title: 'Sınıflar Atlatıldı',
                html: `<div><b>${result.promotedCount}</b> öğrenci üst sınıfa geçirildi.</div><div><b>${result.graduatedCount}</b> öğrenci mezun/arşiv edildi.</div>` +
                    (result.skippedCount > 0 ? `<div style="color:#b45309; margin-top:6px;"><b>${result.skippedCount}</b> öğrencinin sınıf bilgisi okul türü için geçersiz olduğundan dokunulmadı.</div>` : '')
            });
            if (typeof getStats === 'function') getStats();
            return;
        }

        if (result.requiresConfirmation) {
            const confirmAgain = await Swal.fire({
                icon: 'question',
                title: 'Emin misiniz?',
                text: result.message,
                showCancelButton: true,
                confirmButtonText: 'Evet, yine de devam et',
                cancelButtonText: 'Vazgeç',
                confirmButtonColor: '#dc2626'
            });
            if (confirmAgain.isConfirmed) {
                requestClassPromotion(true);
            }
            return;
        }

        Swal.fire({ icon: 'error', title: 'Hata', text: result.message || 'İşlem başarısız oldu.' });
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

// --- YENİ EKLENEN: Dinamik Kural Satırı Oluşturma Fonksiyonu ---
if (typeof window !== 'undefined') {
    window.addDynamicRuleRow = function (pages = '', min = '', max = '') {
        const container = document.getElementById('dynamic-rules-container');
        const row = document.createElement('div');
        row.className = 'dynamic-rule-row';
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.alignItems = 'center';

        row.innerHTML = `
            <div style="flex:1;"><input type="number" placeholder="Max Syf (Örn:100)" value="${pages}" style="width:100%; padding:8px; border:1px solid #d1d5db; border-radius:4px; font-size:0.8rem;"></div>
            <div style="flex:1;"><input type="number" placeholder="Min Gün (Örn:1)" value="${min}" style="width:100%; padding:8px; border:1px solid #d1d5db; border-radius:4px; font-size:0.8rem;"></div>
            <div style="flex:1;"><input type="number" placeholder="Max Gün (Örn:7)" value="${max}" style="width:100%; padding:8px; border:1px solid #d1d5db; border-radius:4px; font-size:0.8rem;"></div>
            <button onclick="this.parentElement.remove()" type="button" style="background:#ef4444; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; display:flex; align-items:center; justify-content:center;" title="Sil"><span class="material-symbols-rounded" style="font-size:16px;">delete</span></button>
        `;
        container.appendChild(row);
    };
}

async function saveSettings(type) {
    let settingsPayload = {};
    if (type === 'general') {
        // YENİ: Ekrandaki Kural Satırlarını JSON Dizisine Çevirme Mantığı
        let dynamicRules = [];
        document.querySelectorAll('#dynamic-rules-container .dynamic-rule-row').forEach(row => {
            const inputs = row.querySelectorAll('input');
            const pages = parseInt(inputs[0].value);
            const min = parseInt(inputs[1].value);
            const max = parseInt(inputs[2].value);
            // Sadece üç kutu da sayısal olarak doluysa listeye al (boşları süz)
            if (!isNaN(pages) && !isNaN(min) && !isNaN(max)) {
                dynamicRules.push({ max_pages: pages, min_days: min, max_days: max });
            }
        });

        // Eğer kullanıcı kural listesini çok karıştırırsa düzgün çalışması için max_pages'e göre küçükten büyüğe sıralayalım
        dynamicRules.sort((a, b) => a.max_pages - b.max_pages);

        settingsPayload = {
            max_borrow_limit: document.getElementById("setting_max_borrow_limit").value ? parseInt(document.getElementById("setting_max_borrow_limit").value) : null,
            dynamic_rules: dynamicRules.length > 0 ? dynamicRules : null, // Sabit günler JSON'dan tamamen çıkarıldı
            lib_open_time: document.getElementById("setting_lib_open_time").value || null,
            lib_close_time: document.getElementById("setting_lib_close_time").value || null,
            allow_lending_to_archived: document.getElementById("setting_allow_lending_to_archived").checked,
            require_photo_confirm: document.getElementById("setting_require_photo_confirm").checked,
            track_reading_status: document.getElementById("setting_track_reading_status").checked
        };
    } else if (type === 'staff') {
        const mode = document.getElementById("setting_staff_pass_mode").value;
        const randomPass = Math.floor(100000 + Math.random() * 900000).toString();
        const d = new Date();
        const todayStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

        // Yeni Veritabanı Yapısı: Verileri "Sabit" ve "Günlük" olarak ayırıyoruz
        if (mode === 'daily') {
            settingsPayload = {
                staff_pass_mode: mode,
                daily_staff_names: currentStaffNames.join(', ') || null,
                daily_staff_password: randomPass,
                daily_pass_date: todayStr
            };
        } else if (mode === 'fixed') {
            settingsPayload = {
                staff_pass_mode: mode,
                fixed_staff_name: document.getElementById("setting_fixed_staff_name").value || null,
                fixed_staff_password: document.getElementById("setting_staff_password").value || null
            };
        } else if (mode === 'hybrid') {
            settingsPayload = {
                staff_pass_mode: mode,
                fixed_staff_name: document.getElementById("setting_fixed_staff_name").value || null,
                fixed_staff_password: document.getElementById("setting_staff_password").value || null,
                daily_staff_names: currentStaffNames.join(', ') || null,
                daily_staff_password: randomPass,
                daily_pass_date: todayStr
            };
        }
    }

    Swal.fire({ title: '⏳ Kaydediliyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/updateSettings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), settings: settingsPayload })
        });
        const result = await res.json();

        if (result.status === 'success') {
            if (type === 'staff') {
                const mode = document.getElementById("setting_staff_pass_mode").value;
                if (mode === 'daily') {
                    Swal.fire({
                        icon: 'success',
                        title: 'Nöbetçiler Kaydedildi',
                        html: `Günün nöbetçileri: <b>${currentStaffNames.join(', ')}</b><br><br><div style="font-size:1.5rem; color:#4f46e5; padding:10px; background:#f3f4f6; border-radius:8px; display:inline-block; font-weight:bold; letter-spacing:2px;">Günlük Şifre: ${settingsPayload.daily_staff_password}</div>`
                    });
                } else if (mode === 'hybrid') {
                    Swal.fire({
                        icon: 'success',
                        title: 'Hibrit Sistem Aktif',
                        html: `Sabit Görevli korundu.<br><br>Günün Nöbetçileri: <b>${currentStaffNames.join(', ')}</b><br><br><div style="font-size:1.5rem; color:#4f46e5; padding:10px; background:#f3f4f6; border-radius:8px; display:inline-block; font-weight:bold; letter-spacing:2px;">Nöbetçi Şifresi: ${settingsPayload.daily_staff_password}</div>`
                    });
                } else {
                    Swal.fire('Başarılı', 'Sabit görevli ayarları kaydedildi.', 'success');
                }
            } else {
                // YENİ: require_photo_confirm önbelleğini bu oturum için anında güncelle
                // (sunucu tarafı zaten güncel; yeniden giriş yapılmadan bu sekmede de etkili olsun)
                if (type === 'general') requirePhotoConfirmEnabled = settingsPayload.require_photo_confirm;

                // YENİ: Genel ayarlar kaydedildikten sonra, bekleyen bir logo seçimi varsa onu da yükle
                const logoOk = type === 'general' ? await uploadPendingLogo() : true;
                if (logoOk) {
                    Swal.fire({ icon: 'success', title: '✅ Kaydedildi!' });
                }
            }
        } else {
            Swal.fire('Hata', result.message, 'error');
        }
    } catch (error) {
        Swal.fire('Hata', 'Sunucu hatası', 'error');
    }
}

// Global dizi
let currentStaffNames = [];

async function addStaffStudent() {
    const no = document.getElementById("setting_staff_add_no").value.trim();
    if (!no) return;

    Swal.fire({ title: 'Aranıyor...', didOpen: () => Swal.showLoading() });

    try {
        const response = await fetch('/api/getStudentByNo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), studentNo: no })
        });
        const res = await response.json();

        if (res.status === 'success' && res.data) {
            Swal.close();
            const fullName = res.data.full_name;
            if (!currentStaffNames.includes(fullName)) {
                currentStaffNames.push(fullName);
                renderStaffList();
            } else {
                Swal.fire('Bilgi', 'Öğrenci zaten listede.', 'info');
            }
            document.getElementById("setting_staff_add_no").value = '';
        } else {
            Swal.fire('Hata', 'Öğrenci bulunamadı', 'error');
        }
    } catch (e) {
        Swal.fire('Hata', 'Sunucu Hatası', 'error');
    }
}

function removeStaffStudent(index) {
    currentStaffNames.splice(index, 1);
    renderStaffList();
}

function renderStaffList() {
    const listEl = document.getElementById("setting_staff_list");
    if (!listEl) return;

    if (currentStaffNames.length === 0) {
        listEl.innerHTML = '<li style="text-align:center; color:#9ca3af; font-size:0.8rem; padding:10px;">Henüz görevli eklenmedi.</li>';
        return;
    }

    listEl.innerHTML = currentStaffNames.map((name, idx) => `
        <li style="display:flex; justify-content:space-between; align-items:center; background:#f9fafb; padding:10px 15px; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:5px;">
            <span style="font-weight:600; color:#1f2937;">${name}</span>
            <button onclick="removeStaffStudent(${idx})" style="background:none; border:none; cursor:pointer; color:#ef4444;"><span class="material-symbols-rounded" style="font-size:20px;">close</span></button>
        </li>
    `).join('');
}

function toggleStaffGroups() {
    const mode = document.getElementById("setting_staff_pass_mode").value;
    const fixedGroup = document.getElementById("fixedStaffGroup");
    const dailyGroup = document.getElementById("dailyStaffGroup");

    if (mode === 'fixed') {
        fixedGroup.style.display = 'block';
        dailyGroup.style.display = 'none';
    } else if (mode === 'daily') {
        fixedGroup.style.display = 'none';
        dailyGroup.style.display = 'block';
    } else if (mode === 'hybrid') {
        fixedGroup.style.display = 'block';
        dailyGroup.style.display = 'block';
    }
}
// ==========================================
// İŞLEM GEÇMİŞİ (LOGS) & OMNI-SEARCH
// ==========================================
let allLogs = [];

async function loadLogs() {
    const listArea = document.getElementById("logs-list");
    listArea.innerHTML = '<div style="text-align:center;">Yükleniyor...</div>';

    const filterDate = document.getElementById("logDateFilter")?.value || null;

    try {
        const response = await fetch('/api/getLogs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), filterDate: filterDate })
        });
        const res = await response.json();

        if (res.status === 'success') {
            allLogs = res.data || [];
            renderLogs(allLogs);
        } else {
            listArea.innerHTML = `<div style="text-align:center; color:red;">${res.message}</div>`;
        }
    } catch (e) {
        listArea.innerHTML = `<div style="text-align:center; color:red;">Bağlantı hatası</div>`;
    }
}

function renderLogs(logs) {
    const listArea = document.getElementById("logs-list");
    if (logs.length === 0) {
        listArea.innerHTML = '<div style="text-align:center; padding:10px; color:#6b7280;">Kayıt bulunamadı.</div>';
        return;
    }

    listArea.innerHTML = logs.map((log, idx) => {
        const isCompleted = log.status === 'returned';
        const borderColor = isCompleted ? '#10b981' : '#ef4444';

        const formatDate = (dateString) => {
            if (!dateString) return '-';
            const d = new Date(dateString);
            return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        };

        // 🚀 MİMARIN DOKUNUŞU: Duruma göre renkli rozet (badge) üreten yardımcı fonksiyon
        const getConditionBadge = (cond) => {
            if (!cond) return ''; // Durum seçilmemişse boş döner
            let bg = '#f3f4f6', col = '#4b5563'; // Varsayılan (Gri)
            if (cond === 'Yeni') { bg = '#dcfce7'; col = '#166534'; } // Yeşil
            else if (cond === 'İyi') { bg = '#e0f2fe'; col = '#075985'; } // Mavi
            else if (cond === 'Yıpranmış') { bg = '#ffedd5'; col = '#9a3412'; } // Turuncu
            else if (cond === 'Hasarlı') { bg = '#fee2e2'; col = '#991b1b'; } // Kırmızı

            return `<span style="background:${bg}; color:${col}; font-size:0.65rem; padding:2px 6px; border-radius:10px; margin-left:4px; font-weight:bold; vertical-align:middle; display:inline-block;">${cond}</span>`;
        };

        // Tarihler ve Durum Rozetleri bir arada
        let dateHTML = `<div style="color:#dc2626; margin-bottom:4px;">⬆ Veriliş: ${formatDate(log.borrow_date)} ${getConditionBadge(log.borrow_condition)}</div>`;
        if (isCompleted && log.return_date) {
            dateHTML += `<div style="color:#16a34a;">⬇ İade: ${formatDate(log.return_date)} ${getConditionBadge(log.return_condition)}</div>`;
        }

        let handlerText = `Veren: <b style="color:#1f2937;">${log.handed_by || '-'}</b>`;
        if (isCompleted) {
            handlerText += ` | Alan: <b style="color:#1f2937;">${log.received_by || '-'}</b>`;
        }

        const g = log.students?.grade || '';
        const c = log.students?.class_name || '';
        const gradeClass = (g && c) ? `${g}/${c}` : 'Sınıf Yok';
        const fullName = log.students?.full_name || 'Bilinmeyen Öğrenci';
        const studentNo = log.students?.student_no || '?';
        const stText = `${fullName} (${gradeClass} - No: ${studentNo})`;

        return `
        <div style="background:#f9fafb; border:1px solid #e5e7eb; border-left:4px solid ${borderColor}; padding:10px 15px; border-radius:8px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                <div style="font-weight:bold; color:#1f2937;">${stText}</div>
                <div style="font-size:0.8rem; color:#6b7280; text-align:right;">${dateHTML}</div>
            </div>
            <div style="font-size:0.85rem; color:#4f46e5; margin-bottom:5px; font-weight:600;">
                📕 ${log.books?.book_name || '?'} <span style="font-size:0.75rem; color:#6b7280;">[${log.books?.barcode || '?'}]</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#6b7280; align-items:center;">
                <div>Durum: <b style="color:${borderColor}">${isCompleted ? 'Alındı' : 'Verildi'}</b></div>
                <div style="background:#e5e7eb; padding:2px 8px; border-radius:12px; color:#374151;">${handlerText}</div>
            </div>
        </div>`;
    }).join('');
}

function filterLogs() {
    const searchTerm = document.getElementById("logSearchInput").value.trim();
    if (!searchTerm) {
        renderLogs(allLogs);
        return;
    }
    const q = searchTerm.toLocaleLowerCase('tr-TR');

    const filtered = allLogs.filter(log => {
        return (log.students?.full_name || '').toLocaleLowerCase('tr-TR').includes(q) ||
            (log.students?.student_no?.toString() || '').includes(q) ||
            ((log.students?.grade || '') + '/' + (log.students?.class_name || '')).toLocaleLowerCase('tr-TR').includes(q) ||
            (log.books?.book_name || '').toLocaleLowerCase('tr-TR').includes(q) ||
            (log.books?.barcode?.toString() || '').includes(q) ||
            (log.handed_by || '').toLocaleLowerCase('tr-TR').includes(q) ||
            (log.received_by || '').toLocaleLowerCase('tr-TR').includes(q);
    });

    renderLogs(filtered);
}

function downloadExcelTemplate(type) {
    let headers = [];
    let filename = "";
    if (type === 'student') {
        headers = [["Öğrenci No", "Ad Soyad", "Kademe", "Şube"]];
        filename = "Ogrenci_Sablonu.xlsx";
    } else {
        headers = [["Barkod", "Kitap Adı", "Yazar(İsteğe Bağlı)", "Yayınevi(İsteğe Bağlı)", "Tür(İsteğe Bağlı)", "Sayfa Sayısı", "Raf", "Durum (Yeni/Yıpranmış)"]];
        filename = "Kitap_Sablonu.xlsx";
    }

    if (typeof XLSX === 'undefined') {
        Swal.fire('Hata', 'Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyiniz.', 'error');
        return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(headers);
    XLSX.utils.book_append_sheet(wb, ws, "Şablon");
    XLSX.writeFile(wb, filename);
}

function buildBulkStudentImportSummaryHtml(result) {
    const insertedCount = Number(result.insertedCount || 0);
    const updatedCount = Number(result.updatedCount || 0);
    const duplicateCount = Number(result.duplicateCount || 0);
    const nameMismatchCount = Number(result.nameMismatchCount || 0);
    const updated = Array.isArray(result.updated) ? result.updated : [];
    const duplicates = Array.isArray(result.duplicates) ? result.duplicates : [];
    const nameMismatches = Array.isArray(result.nameMismatches) ? result.nameMismatches : [];

    const lines = [`<div><b>${insertedCount}</b> yeni öğrenci eklendi.</div>`];

    if (updatedCount > 0) {
        const list = updated.map(item => `<div style="margin-top:4px;">• ${item.full_name || item.student_no} (${item.student_no})</div>`).join('');
        lines.push(`
            <div style="margin-top:10px;"><b>${updatedCount}</b> öğrencinin sınıfı güncellendi.</div>
            <div style="margin-top:4px; max-height:120px; overflow-y:auto;">${list}</div>
        `);
    }

    if (duplicateCount > 0) {
        const list = duplicates.map(item => `<div style="margin-top:4px;">• ${item.full_name || item.student_no} (${item.student_no})</div>`).join('');
        lines.push(`
            <div style="margin-top:10px;"><b>${duplicateCount}</b> öğrenci mükerrer olduğu için atlandı.</div>
            <div style="margin-top:4px; max-height:120px; overflow-y:auto;">${list}</div>
        `);
    }

    if (nameMismatchCount > 0) {
        const list = nameMismatches.map(item => `<div style="margin-top:4px;">• No: ${item.student_no} — Sistemde: "${item.existing_name}", Dosyada: "${item.file_name}"</div>`).join('');
        lines.push(`
            <div style="margin-top:10px; color:#b91c1c;"><b>${nameMismatchCount}</b> öğrenci isim uyuşmazlığı nedeniyle atlandı.</div>
            <div style="margin-top:4px; max-height:120px; overflow-y:auto;">${list}</div>
        `);
    }

    return `<div style="text-align:left;">${lines.join('')}</div>`;
}

function handleExcelUpload(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        Swal.fire('Hata', 'Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyiniz.', 'error');
        return;
    }

    // Kitap yüklemesi: mükerrer barkod kontrolü + parçalı (chunk) yükleme + geri alma gerektiğinden
    // ayrı bir akışta yönetiliyor (bkz. handleBookExcelUpload). Öğrenci akışı değişmedi.
    if (type === 'book') {
        handleBookExcelUpload(file, event);
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const firstSheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet);

            if (!jsonData || jsonData.length === 0) {
                Swal.fire('Hata', 'Excel dosyası boş veya biçimi hatalı.', 'error');
                return;
            }

            const mappedData = jsonData.map(row => ({
                student_no: row["Öğrenci No"] || '',
                full_name: row["Ad Soyad"] || '',
                grade: row["Kademe"] ? String(row["Kademe"]) : '',
                class_name: row["Şube"] || ''
            })).filter(item => item.student_no && item.full_name);

            if (mappedData.length === 0) {
                Swal.fire('Hata', 'Geçerli veri bulunamadı. Sütun başlıklarının şablonla tam eşleştiğinden emin olun.', 'error');
                return;
            }

            const payload = {
                ...ktAuthFields(),
                data: mappedData,
                updateExistingClass: !!document.getElementById('bulkImportUpdateClass')?.checked
            };

            Swal.fire({ title: 'Yükleniyor...', html: '<b>' + mappedData.length + '</b> kayıt işleniyor...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

            const res = await fetch('/api/students/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();

            if (result.status === 'success') {
                Swal.fire({ icon: 'success', title: 'İçe Aktarım Tamamlandı', html: buildBulkStudentImportSummaryHtml(result), confirmButtonText: 'Tamam' });
                if (typeof getStats === 'function') getStats();
            } else {
                Swal.fire('Hata', result.message || 'Yükleme başarısız', 'error');
            }
        } catch (error) {
            Swal.fire('Hata', 'Dosya okunurken bir hata oluştu.', 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==========================================
// KİTAP EXCEL YÜKLEME (mükerrer barkod kontrolü + parçalı yükleme)
// ==========================================

// Barkod temizliği: sayısal barkodları bilimsel gösterime (1E+12 gibi) düşürmeden metne çevirir,
// baştaki/sondaki boşlukları ve görünmez karakterleri (nbsp, zero-width vb.) temizler.
// Backend'deki (src/controllers/libraryController.js) cleanBarcode fonksiyonuyla aynı mantığı izler.
function cleanBarcode(raw) {
    if (raw === null || raw === undefined) return '';
    let str;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        str = BigInt(Math.round(raw)).toString();
    } else {
        str = String(raw);
    }
    str = str.replace(/[ ​‌‍⁠﻿]/g, '');
    return str.trim();
}

// fetch yanıtını res.json() ile parse etmeden önce gerçekten JSON olup olmadığına bakar.
// Sunucudan HTML/boş bir hata sayfası dönerse ham SyntaxError kullanıcıya gitmesin.
async function safeParseJsonResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    try {
        return await res.json();
    } catch (e) {
        return null;
    }
}

// Mükerrer barkod uyarısını SweetAlert2 ile, hangi Excel satırının hangi barkodla çakıştığını
// gösteren kaydırılabilir bir liste olarak gösterir.
function showDuplicateBarcodeAlert(reasonText, groups) {
    const body = groups.map(g => {
        const lines = g.entries.map(e => {
            const existingPart = e.existingName ? ` — sistemde zaten kayıtlı: "${e.existingName}"` : '';
            return `<div style="margin-top:2px;">Excel satırı ${e.row}: ${e.name || '(kitap adı yok)'}${existingPart}</div>`;
        }).join('');
        return `<div style="margin-top:10px;"><b>Barkod: ${g.barcode}</b>${lines}</div>`;
    }).join('');

    Swal.fire({
        icon: 'warning',
        title: 'Mükerrer Barkod Bulundu',
        html: `
            <div style="text-align:left;">
                <div>Aşağıdaki barkodlar ${reasonText}. Hiçbir kitap eklenmedi; lütfen Excel dosyasını düzeltip tekrar deneyin.</div>
                <div style="margin-top:10px; max-height:220px; overflow-y:auto; border-top:1px solid #eee; padding-top:8px;">${body}</div>
            </div>
        `,
        confirmButtonText: 'Tamam'
    });
}

function handleBookExcelUpload(file, event) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const firstSheet = workbook.Sheets[firstSheetName];
            // header:1 + blankrows:true ile satırlar ham dizi halinde ve Excel'deki satır
            // numarasıyla hizalı kalır (rows[0] = başlık = Excel satır 1).
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: true, defval: '', blankrows: true });

            if (!rows || rows.length < 2) {
                Swal.fire('Hata', 'Excel dosyası boş veya biçimi hatalı.', 'error');
                return;
            }

            const headerRow = (rows[0] || []).map(h => String(h ?? '').trim());
            const findCol = (...candidates) => {
                for (const c of candidates) {
                    const idx = headerRow.indexOf(c);
                    if (idx !== -1) return idx;
                }
                return -1;
            };
            const colIndex = {
                barcode: findCol('Barkod'),
                book_name: findCol('Kitap Adı'),
                author: findCol('Yazar(İsteğe Bağlı)', 'Yazar'),
                publisher: findCol('Yayınevi(İsteğe Bağlı)', 'Yayınevi'),
                category: findCol('Tür(İsteğe Bağlı)', 'Tür'),
                page_count: findCol('Sayfa Sayısı'),
                shelf: findCol('Raf'),
                condition: findCol('Durum (Yeni/Yıpranmış)')
            };

            const cell = (row, idx) => (idx >= 0 ? row[idx] : '');
            const items = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i] || [];
                const excelRow = i + 1; // rows[0] Excel satır 1 (başlık) olduğundan, i. satır Excel'de (i+1)
                const barcode = cleanBarcode(cell(row, colIndex.barcode));
                const book_name = String(cell(row, colIndex.book_name) ?? '').trim();
                if (!barcode || !book_name) continue;

                items.push({
                    excelRow,
                    barcode,
                    book_name,
                    author: String(cell(row, colIndex.author) ?? '').trim(),
                    publisher: String(cell(row, colIndex.publisher) ?? '').trim(),
                    category: String(cell(row, colIndex.category) ?? '').trim(),
                    page_count: parseInt(cell(row, colIndex.page_count)) || 0,
                    shelf: String(cell(row, colIndex.shelf) ?? '').trim(),
                    condition: String(cell(row, colIndex.condition) ?? '').trim() || 'Yeni'
                });
            }

            if (items.length === 0) {
                Swal.fire('Hata', 'Geçerli veri bulunamadı. Sütun başlıklarının şablonla tam eşleştiğinden emin olun.', 'error');
                return;
            }

            // 1) Dosya içi mükerrer barkod kontrolü — parçalamadan/sunucuya göndermeden ÖNCE.
            const byBarcode = new Map();
            items.forEach(item => {
                if (!byBarcode.has(item.barcode)) byBarcode.set(item.barcode, []);
                byBarcode.get(item.barcode).push(item);
            });
            const fileDuplicates = [...byBarcode.entries()].filter(([, list]) => list.length > 1);
            if (fileDuplicates.length > 0) {
                showDuplicateBarcodeAlert(
                    'Excel dosyasının içinde birden fazla satırda geçiyor',
                    fileDuplicates.map(([barcode, list]) => ({
                        barcode,
                        entries: list.map(it => ({ row: it.excelRow, name: it.book_name }))
                    }))
                );
                return;
            }

            // 2) Bu okulda (school_id) veritabanında zaten kayıtlı barkod var mı?
            Swal.fire({ title: 'Kontrol ediliyor...', html: 'Barkodlar kontrol ediliyor...', didOpen: () => Swal.showLoading(), allowOutsideClick: false, allowEscapeKey: false });

            const allBarcodes = items.map(it => it.barcode);
            let checkRes;
            try {
                checkRes = await fetch('/api/books/check-barcodes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...ktAuthFields(), barcodes: allBarcodes })
                });
            } catch (networkError) {
                Swal.fire({ icon: 'error', title: 'Hata', text: 'Sunucuya bağlanırken bir hata oluştu. Hiçbir kitap eklenmedi.' });
                return;
            }
            const checkResult = await safeParseJsonResponse(checkRes);
            if (!checkResult || checkResult.status !== 'success') {
                Swal.fire({ icon: 'error', title: 'Hata', text: (checkResult && checkResult.message) || 'Barkod kontrolü yapılırken sunucudan geçersiz bir yanıt alındı. Hiçbir kitap eklenmedi.' });
                return;
            }

            const existingList = Array.isArray(checkResult.existing) ? checkResult.existing : [];
            if (existingList.length > 0) {
                const existingNameByBarcode = new Map(existingList.map(m => [m.barcode, m.book_name]));
                const conflictingItems = items.filter(it => existingNameByBarcode.has(it.barcode));
                const groups = [...new Set(conflictingItems.map(it => it.barcode))].map(barcode => ({
                    barcode,
                    entries: conflictingItems
                        .filter(it => it.barcode === barcode)
                        .map(it => ({ row: it.excelRow, name: it.book_name, existingName: existingNameByBarcode.get(barcode) }))
                }));
                Swal.close();
                showDuplicateBarcodeAlert('bu okulda veritabanında zaten kayıtlı', groups);
                return;
            }

            // 3) Kontroller temiz: 500'lük parçalar halinde yükle.
            await uploadBooksInChunks(items);
        } catch (error) {
            Swal.fire({ icon: 'error', title: 'Hata', text: 'Excel dosyası okunurken bir hata oluştu.' });
        } finally {
            if (event && event.target) event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function uploadBooksInChunks(items) {
    const CHUNK_SIZE = 500;
    const totalCount = items.length;
    const insertedIds = [];
    let uploadedCount = 0;

    Swal.fire({
        title: 'Yükleniyor...',
        html: `<b>0 / ${totalCount}</b> kitap yüklendi.`,
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
    });

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunkItems = items.slice(i, i + CHUNK_SIZE);
        // excelRow sadece frontend takibi için var; sunucuya gönderilecek kitap alanlarına dahil değil.
        const payloadItems = chunkItems.map(({ excelRow, ...rest }) => rest);

        let res;
        try {
            res = await fetch('/api/books/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...ktAuthFields(), data: payloadItems })
            });
        } catch (networkError) {
            await finishFailedBookUpload(insertedIds, 'Sunucuya bağlanırken bir hata oluştu.');
            return;
        }

        const result = await safeParseJsonResponse(res);
        if (!result || result.status !== 'success') {
            const failureMessage = (result && result.message) || 'Kitap yüklenirken bir hata oluştu.';
            await finishFailedBookUpload(insertedIds, failureMessage);
            return;
        }

        if (Array.isArray(result.ids)) insertedIds.push(...result.ids);
        uploadedCount += chunkItems.length;
        Swal.update({ html: `<b>${uploadedCount} / ${totalCount}</b> kitap yüklendi.` });
    }

    Swal.fire('Başarılı', `${totalCount} kitap başarıyla eklendi!`, 'success');
    if (typeof getStats === 'function') getStats();
}

// Bir chunk başarısız olduğunda, bu yükleme sırasında önceden eklenmiş kitapları geri alır
// ve kullanıcıya SweetAlert2 ile sonucu bildirir.
async function finishFailedBookUpload(insertedIds, failureMessage) {
    if (insertedIds.length === 0) {
        Swal.fire({ icon: 'error', title: 'Yükleme Başarısız', html: `${failureMessage}<br><br>Hiçbir kitap eklenmedi.` });
        return;
    }

    const rollbackOk = await rollbackInsertedBooks(insertedIds);
    if (rollbackOk) {
        Swal.fire({ icon: 'error', title: 'Yükleme Başarısız', html: `${failureMessage}<br><br>Yükleme tamamlanamadı, hiçbir kitap eklenmedi.` });
    } else {
        Swal.fire({
            icon: 'error',
            title: 'Yükleme Başarısız',
            html: `${failureMessage}<br><br><b>Önemli:</b> Geri alma işlemi başarısız oldu. Bu yükleme sırasında eklenmiş olan <b>${insertedIds.length}</b> kitap sistemde kalmış olabilir. Lütfen Kitap Düzenle ekranından barkodları kontrol edin.`
        });
    }
}

async function rollbackInsertedBooks(ids) {
    if (!ids || ids.length === 0) return true;
    try {
        const res = await fetch('/api/books/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields(), ids })
        });
        const result = await safeParseJsonResponse(res);
        return !!(result && result.status === 'success');
    } catch (e) {
        return false;
    }
}

function parseEokulStudentRows(rows, grade, className) {
    if (!Array.isArray(rows) || rows.length < 2) {
        return [];
    }

    const mappedData = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const studentNo = String(row[1] ?? '').trim();
        const namePart = String(row[4] ?? '').trim();
        const surnamePart = String(row[9] ?? '').trim();

        if (!studentNo) continue;

        const fullName = [namePart, surnamePart].filter(Boolean).join(' ');
        if (!fullName) continue;

        mappedData.push({
            student_no: studentNo,
            full_name: fullName,
            grade,
            class_name: className
        });
    }

    return mappedData;
}

function buildStudentPayload({ no, name, grade, className }) {
    if (!no || !name || !grade || !className) return null;
    return { no, name, grade, className };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseEokulStudentRows, buildStudentPayload, cleanBarcode };
}

function triggerEokulStudentImport() {
    const grade = document.getElementById('newOgrKademe')?.value;
    const className = document.getElementById('newOgrSube')?.value;

    if (!grade || !className) {
        Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Lütfen önce Kademe ve Şube seçin.' });
        return;
    }

    const fileInput = document.getElementById('eOkulStudentUpload');
    if (fileInput) {
        fileInput.value = '';
        fileInput.click();
    }
}

async function handleEOkulStudentUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const grade = document.getElementById('newOgrKademe')?.value;
    const className = document.getElementById('newOgrSube')?.value;

    if (!grade || !className) {
        Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Lütfen önce Kademe ve Şube seçin.' });
        event.target.value = '';
        return;
    }

    if (typeof XLSX === 'undefined') {
        Swal.fire('Hata', 'Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyiniz.', 'error');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const firstSheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, blankrows: false });

            if (!rows || rows.length < 2) {
                Swal.fire('Hata', 'Excel dosyası boş veya formatı hatalı.', 'error');
                return;
            }

            const mappedData = parseEokulStudentRows(rows, grade, className);

            if (mappedData.length === 0) {
                Swal.fire('Hata', 'Dosyada kullanılabilir öğrenci verisi bulunamadı. B sütununda öğrenci no, E sütununda ad, J sütununda soyad olmalıdır.', 'error');
                return;
            }

            const updateExistingClass = !!document.getElementById('bulkImportUpdateClass')?.checked;

            Swal.fire({ title: 'Yükleniyor...', html: '<b>' + mappedData.length + '</b> öğrenci işleniyor...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

            const response = await fetch('/api/students/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...ktAuthFields(), data: mappedData, updateExistingClass })
            });
            const result = await response.json();

            if (result.status === 'success') {
                Swal.fire({ icon: 'success', title: 'İçe Aktarım Tamamlandı', html: buildBulkStudentImportSummaryHtml(result), confirmButtonText: 'Tamam' });
                if (typeof getStats === 'function') getStats();
            } else {
                Swal.fire({ icon: 'error', title: 'Hata', text: result.message || 'İçe aktarma başarısız oldu.' });
            }
        } catch (error) {
            Swal.fire({ icon: 'error', title: 'Hata', text: 'Excel dosyası okunurken bir hata oluştu.' });
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- ÖĞRETMEN YETKİ İŞLEMLERİ ---
async function fetchTeachers() {
    try {
        const res = await fetch('/api/getTeachers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ktAuthFields() })
        });
        return await res.json();
    } catch (e) {
        console.error("fetchTeachers error:", e);
        return { status: 'error', message: 'Sunucu hatası' };
    }
}

async function saveTeacher(payload) {
    try {
        const res = await fetch('/api/saveTeacher', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (e) {
        console.error("saveTeacher error:", e);
        return { status: 'error', message: 'Sunucu hatası' };
    }
}

async function deleteTeacherAPI(payload) {
    try {
        const res = await fetch('/api/deleteTeacher', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (e) {
        console.error("deleteTeacherAPI error:", e);
        return { status: 'error', message: 'Sunucu hatası' };
    }
}

// --- KİTAP ARAMA / GÜNCELLEME / SİLME API'LERİ ---

async function searchBooksAPI(payload) {
    try {
        const res = await fetch('/api/searchBooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (e) {
        console.error("searchBooksAPI error:", e);
        return { status: 'error', message: 'Sunucu hatası' };
    }
}

async function updateBookAPI(payload) {
    try {
        const res = await fetch('/api/updateBook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (e) {
        console.error("updateBookAPI error:", e);
        return { status: 'error', message: 'Sunucu hatası' };
    }
}

async function deleteBookAPI(payload) {
    try {
        const res = await fetch('/api/deleteBook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (e) {
        console.error("deleteBookAPI error:", e);
        return { status: 'error', message: 'Sunucu hatası' };
    }
}

// ==========================================
// 🎫 SİHİRLİ BİLET (MAGIC TOKEN) YAKALAYICI
// ==========================================
async function checkMagicToken() {
    // Bilet artık bu dosyanın en üstünde (script değerlendirilir değerlendirilmez, ağ
    // isteğinden önce) okunup URL'den silindi — burada tekrar URL'ye bakılmaz.
    const bilet = __ktMagicTicket;

    if (bilet) {
        console.log("🎫 Bilet tespit edildi, kapılar Süper Admin için zorlanıyor...");

        // Ekrana geçici bir yükleniyor mesajı verebiliriz
        Swal.fire({
            title: 'Süper Admin Girişi...',
            text: 'Biletiniz doğrulanıyor, lütfen bekleyin.',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        try {
            // 2. Bileti arka plana yolla
            const response = await fetch('/api/magic-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bilet: bilet })
            });
            const result = await response.json();

            if (result.status === 'success') {
                // YENİ: artık şifre dönmüyor — bilet (ktToken) saklanır, kutuphane_pass/
                // kutuphane_auth_mode HİÇ yazılmaz (magic_legacy köprüsü kalktı).
                if (typeof setKtToken === 'function') setKtToken(result.ktToken);

                localStorage.setItem("kutuphane_code", result.schoolCode);
                localStorage.setItem("okul_ismi", result.schoolName);
                localStorage.setItem("kutuphane_user", result.userName);
                localStorage.setItem("user_role", result.role);
                localStorage.setItem("kt_role", result.kt_role || result.role);
                localStorage.setItem("kutuphane_classes", JSON.stringify(result.kt_classes || ['ALL']));
                localStorage.setItem("kutuphane_login_type", "staff");

                // Ekran geçişi + dashboard kurulumu: normal login()'le aynı ortak yardımcı.
                if (typeof setupDashboardUI === 'function') setupDashboardUI(result);

                Swal.fire({ icon: 'success', title: 'Sızma Başarılı!', text: 'Süper Admin olarak giriş yapıldı.', timer: 2000, showConfirmButton: false });
            } else {
                showApiErrorAlert(result, 'Sızma Başarısız');
            }
        } catch (error) {
            console.error(error);
            Swal.fire({ icon: 'error', title: 'Hata', text: 'Sihirli bilet sunucuya iletilemedi.' });
        }
    }
}

// Dosya yüklendiğinde bilet yakalayıcıyı otomatik çalıştır
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        checkMagicToken();
    });
}