// --- BAŞLANGIÇ & AYARLAR ---
// Splash 2.8 saniye (2800ms)
window.addEventListener('load', () => {
    setTimeout(() => {
        document.getElementById('splash-screen').classList.add('hidden-splash');
        document.body.style.overflow = 'auto';
    }, 2800);
});

// --- YENİ: oturum temizliği/ekran sıfırlama, birden fazla akış (logout, sessiz
// yükseltme başarısızlığı, /api/session 401'i, onKtSessionExpired) tarafından
// paylaşılıyor ki tek bir yerde tutarlı kalsın. ---
function clearKtSessionStorage() {
    if (typeof clearKtToken === 'function') clearKtToken(); // bilet
    localStorage.removeItem("kutuphane_code");
    localStorage.removeItem("kutuphane_pass");
    localStorage.removeItem("beni_hatirla");
    localStorage.removeItem("okul_ismi");
    localStorage.removeItem("kutuphane_identity");
    localStorage.removeItem("kutuphane_user");
    localStorage.removeItem("kutuphane_login_type");
    localStorage.removeItem("kutuphane_auth_mode"); // YENİ: magic_legacy bayrağı
}

function showLoginScreen() {
    document.getElementById("dashboard").classList.add("hidden");
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("schoolCode").value = "";
    document.getElementById("schoolPass").value = "";
    document.getElementById("teacherIdentity").value = "";
    document.getElementById("beniHatirla").checked = false;
}

// Onay DIYALOĞU OLMADAN temiz çıkış — sessiz yükseltme başarısız olduğunda veya
// açılıştaki /api/session 401 döndüğünde kullanılır (hiçbir toast göstermez).
function performCleanLogout() {
    clearKtSessionStorage();
    showLoginScreen();
}

function logout() {
    Swal.fire({
        title: 'Çıkış?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Evet',
        cancelButtonText: 'Hayır'
    }).then((res) => {
        if (res.isConfirmed) {
            performCleanLogout();
        }
    });
}

// YENİ: ktAuth.js, bilet EKLENMİŞ bir istek 401 dönerse (login/magic-login zaten
// muaf) bu kancayı çağırır — açılıştaki /api/session kontrolü bu kancayı kendi
// isteğinde bilerek bastırır (__ktSuppressSessionExpired), çünkü kendi 401 yönetimini
// (sessiz, toast'suz) zaten kendisi yapar. Tek seferlik: aynı sayfa yüklemesinde
// tekrar tekrar gösterilmez. ÖNCE bilet/eski anahtarlar silinir (uyarı açıkken yeni
// istekler eski bileti tekrar göndermesin), SONRA bildirim gösterilir.
window.onKtSessionExpired = function () {
    if (window.__ktSessionExpiredShown) return;
    window.__ktSessionExpiredShown = true;

    clearKtSessionStorage();

    Swal.fire({ icon: 'info', title: 'Oturumunuz sona erdi', text: 'Okul kodu veya şifre değişmiş olabilir; lütfen yeniden giriş yapın.' }).then(() => {
        showLoginScreen();
    });
};

// YENİ: eski oturumdan kalma şifre (kutuphane_pass) var ama bilet yoksa, saklı
// kimlik/giriş türüyle login()'i SESSİZCE bir kez çağırıp bilet almayı dener.
// Başarılıysa login() zaten kutuphane_pass'ı silmiştir (burada tekrar silinir,
// savunma amaçlı); başarısızsa (ör. şifre artık geçersiz, kullanıcı pasif) hiçbir
// toast göstermeden temiz çıkış yapılır.
async function silentUpgrade() {
    const loginType = localStorage.getItem("kutuphane_login_type") || 'duty';
    const identity = localStorage.getItem("kutuphane_identity");

    if (loginType === 'staff' && !identity) {
        performCleanLogout();
        return;
    }

    const savedCode = (localStorage.getItem("kutuphane_code") || "").trim();
    const savedPass = localStorage.getItem("kutuphane_pass");

    document.getElementById("schoolCode").value = savedCode || "";
    document.getElementById("schoolPass").value = savedPass || "";
    document.getElementById("beniHatirla").checked = (localStorage.getItem("beni_hatirla") === "true");
    window.currentLoginType = loginType;
    if (loginType === 'staff') {
        if (typeof switchLoginTab === 'function') switchLoginTab('staff');
        document.getElementById("teacherIdentity").value = identity;
    }

    const ok = await login({ silent: true });
    if (ok) {
        localStorage.removeItem("kutuphane_pass");
    } else {
        performCleanLogout();
    }
}

window.onload = async function () {
    // 1. Sihirli bilet (#bilet= veya ?bilet=) bekleniyorsa hiçbir şey yapma — checkMagicToken
    // kendi akışını yürütür. Bilet artık api-client.js tarafından bu script çalışmadan ÖNCE
    // URL'den okunup silindiği için burada URL'ye değil, o dosyanın erken set ettiği
    // window.__ktMagicPending bayrağına bakılır.
    if (window.__ktMagicPending) {
        return;
    }

    const token = (typeof getKtToken === 'function') ? getKtToken() : null;
    const savedCode = (localStorage.getItem("kutuphane_code") || "").trim();

    // 2. Bilet + okul kodu varsa -> /api/session ile doğrula, arayüzü oradan kur.
    if (token && savedCode) {
        document.getElementById("schoolCode").value = savedCode;

        try {
            const res = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schoolCode: savedCode }),
                __ktSuppressSessionExpired: true // bu istek kendi 401 yönetimini kendisi yapar
            });

            if (res.status === 401) {
                // Bilet geçersiz/süresi dolmuş. Eski şifre hâlâ saklıysa, önce bozuk
                // bileti sil ve sessiz yükseltmeyi dene (silentUpgrade kendi içinde
                // başarısızlıkta zaten temiz çıkış yapar, tekrar denemez). Aksi halde
                // sessiz temiz çıkış, toast YOK (bu "ilk yükleme" senaryosu).
                const legacyPassForRetry = localStorage.getItem("kutuphane_pass");
                if (legacyPassForRetry) {
                    if (typeof clearKtToken === 'function') clearKtToken();
                    await silentUpgrade();
                } else {
                    performCleanLogout();
                }
                return;
            }

            const result = await res.json();

            if (result.status === 'success') {
                // Bilet geçerliliğini doğruladı — artık gereksiz hale gelen eski
                // şifre kalıntısını sil.
                localStorage.removeItem("kutuphane_pass");
                if (localStorage.getItem("okul_ismi")) {
                    document.getElementById("headerTitle").innerText = localStorage.getItem("okul_ismi");
                }
                if (typeof setupDashboardUI === 'function') setupDashboardUI(result);
            } else {
                // 500 vb. (lisans iptali, DB hatası) -> bilet SİLİNMEZ, giriş ekranında kal.
                if (result.isLicenseError) {
                    Swal.fire({
                        title: 'Lisans Süresi Doldu',
                        html: result.message,
                        icon: 'warning',
                        confirmButtonText: 'Tamam',
                        confirmButtonColor: '#ea580c',
                        background: '#1e293b',
                        color: '#f8fafc',
                        iconColor: '#f59e0b'
                    });
                } else {
                    Swal.fire({ icon: 'error', title: 'Hata', text: result.message || 'Oturum doğrulanamadı.' });
                }
            }
        } catch (networkErr) {
            // Ağ hatası -> bileti SİLME, giriş ekranında kal, tek seferlik toast.
            if (!window.__ktNetworkErrorShown) {
                window.__ktNetworkErrorShown = true;
                Swal.fire({ icon: 'warning', title: 'Sunucuya ulaşılamadı', text: 'Sayfayı yenileyin.' });
            }
        }
        return;
    }

    // 3. Bilet yok ama eski oturumdan kalma şifre varsa -> sessiz yükseltme.
    const savedPass = localStorage.getItem("kutuphane_pass");
    if (!token && savedCode && savedPass) {
        await silentUpgrade();
        return;
    }

    // 4. Hiçbiri yok -> giriş ekranında bekle (değişiklik yok).
};

window.currentLoginType = 'duty';

window.switchLoginTab = function (type) {
    window.currentLoginType = type;
    const dutyBtn = document.getElementById('tab-login-duty');
    const staffBtn = document.getElementById('tab-login-staff');
    const teacherGroup = document.getElementById('teacherIdentityGroup');

    if (type === 'duty') {
        dutyBtn.style.color = '#4f46e5';
        dutyBtn.style.borderBottom = '2px solid #4f46e5';
        staffBtn.style.color = '#6b7280';
        staffBtn.style.borderBottom = '2px solid transparent';
        teacherGroup.classList.add('hidden');
    } else {
        staffBtn.style.color = '#4f46e5';
        staffBtn.style.borderBottom = '2px solid #4f46e5';
        dutyBtn.style.color = '#6b7280';
        dutyBtn.style.borderBottom = '2px solid transparent';
        teacherGroup.classList.remove('hidden');
    }
};

window.applyPermissions = function () {
    const kt_role = localStorage.getItem("kt_role");
    const user_role = localStorage.getItem("user_role");

    // YENİ: her çağrıda sıfırla (SPA içinde farklı bir kullanıcı giriş yapabilir)
    window.__teacherNoClassScope = false;
    window.__noClassWarningShown = false;

    // YENİ: "Rapor Oluştur" / "Emanet Rapor Oluştur" durumu HER çağrıda baştan (idempotent)
    // hesaplanır — SPA'da sayfa yenilenmediği için, önceki bir girişte (örn. hiç sınıfı
    // olmayan bir öğretmenle) disabled kalmış olabilir; burada rol/kapsam ne olursa olsun
    // önce ikisi de normale döndürülür, yalnızca aşağıdaki özel durumda tekrar kapatılır.
    const reportBtn = document.querySelector('button[onclick="getReport()"]');
    const borrowedReportBtn = document.querySelector('button[onclick="getBorrowedReport()"]');
    if (reportBtn) { reportBtn.disabled = false; reportBtn.style.opacity = ''; reportBtn.style.cursor = ''; }
    if (borrowedReportBtn) { borrowedReportBtn.disabled = false; borrowedReportBtn.style.opacity = ''; borrowedReportBtn.style.cursor = ''; }

    try {
        const kt_classes = JSON.parse(localStorage.getItem("kutuphane_classes") || "[]");

        const verTab = document.querySelector(".tab-btn[onclick=\"showTab('ver')\"]");
        const alTab = document.querySelector(".tab-btn[onclick=\"showTab('al')\"]");
        const yonetimTab = document.querySelector(".tab-btn[onclick=\"showTab('yonetim')\"]");

        // Tüm tabları ve yönetim kartlarını başlangıçta görünür yapalım
        if (verTab) verTab.style.display = 'inline-block';
        if (alTab) alTab.style.display = 'inline-block';
        if (yonetimTab) {
            yonetimTab.style.display = 'inline-block';
            yonetimTab.innerHTML = '<span class="material-symbols-rounded">settings</span> Yönetim';
        }
        document.querySelectorAll('.yonetim-card').forEach(c => c.style.display = 'flex');

        if (kt_role === 'teacher') {
            if (verTab) verTab.style.display = 'none';
            if (alTab) alTab.style.display = 'none';

            // Yönetim tabı ismini "Raporlar" yapalım ki öğretmen için anlamlı olsun
            if (yonetimTab) {
                yonetimTab.innerHTML = '<span class="material-symbols-rounded">bar_chart</span> Raporlar';
            }

            // Rapor, Emanet Raporu ve Hesabım dışındaki tüm yönetim menülerini gizle
            document.querySelectorAll('.yonetim-card').forEach(card => {
                const isAlwaysVisibleForTeacher = card.getAttribute('onclick') === "showYonetimForm('report')" ||
                    card.getAttribute('onclick') === "showYonetimForm('borrowed-report')" ||
                    card.getAttribute('onclick') === "openMyAccountModal()";
                if (!isAlwaysVisibleForTeacher) {
                    card.style.display = 'none';
                }
            });

            // Varsayılan olarak Sorgu tabını aç
            showTab('sorgu');

            const reportGrade = document.getElementById('reportGrade');
            const reportClass = document.getElementById('reportClass');
            const borrowedGrade = document.getElementById('borrowedReportGrade'); // YENİ EKLENDİ
            const borrowedClass = document.getElementById('borrowedReportClass'); // YENİ EKLENDİ

            // 'Tüm Okul' gibi "ALL" seçeneklerini gizle/etkisizleştir (Her iki rapor için):
            if (reportGrade) Array.from(reportGrade.options).forEach(o => { if (o.value === 'ALL') o.style.display = 'none'; });
            if (reportClass) Array.from(reportClass.options).forEach(o => { if (o.value === 'ALL') o.style.display = 'none'; });
            if (borrowedGrade) Array.from(borrowedGrade.options).forEach(o => { if (o.value === 'ALL') o.style.display = 'none'; });
            if (borrowedClass) Array.from(borrowedClass.options).forEach(o => { if (o.value === 'ALL') o.style.display = 'none'; });

            // Eğer öğretmenin sadece belirli sınıflara yetkisi varsa, dropdownları filtrele
            if (!kt_classes.includes('ALL')) {
                if (kt_classes.length === 0) {
                    // YENİ: Öğretmenin hiç sınıf yetkisi yok — seçicilerle hiç uğraşma (zaten
                    // içlerinde seçilebilir bir şey olmayacak), sadece rapor oluşturma
                    // düğmelerini kilitle. Uyarı mesajı rapor formuna GİRİLDİĞİNDE (bkz.
                    // showYonetimForm) bir kez gösterilir, burada değil.
                    window.__teacherNoClassScope = true;

                    if (reportBtn) { reportBtn.disabled = true; reportBtn.style.opacity = '0.5'; reportBtn.style.cursor = 'not-allowed'; }
                    if (borrowedReportBtn) { borrowedReportBtn.disabled = true; borrowedReportBtn.style.opacity = '0.5'; borrowedReportBtn.style.cursor = 'not-allowed'; }
                } else {
                    const allowedGrades = [...new Set(kt_classes.map(c => String(c).split('/')[0]))];

                    document.querySelectorAll(".grade-selector").forEach(sel => {
                        if (!sel.options) return;
                        // Kademe filtresi
                        Array.from(sel.options).forEach(opt => {
                            if (opt.value !== "" && opt.value !== "ALL" && !allowedGrades.includes(opt.value)) {
                                opt.style.display = 'none';
                                opt.disabled = true;
                            } else if (opt.value === "ALL") {
                                opt.style.display = 'none';
                                opt.disabled = true;
                            } else {
                                opt.style.display = '';
                                opt.disabled = false;
                            }
                        });

                        // YENİ: Seçili option disabled olduysa sel.value="" atamıyoruz (bu,
                        // hiçbir option'a karşılık gelmediği için selectedIndex'i -1'e düşürüp
                        // seçiciyi tamamen boşaltıyordu). Bunun yerine ilk izinli (disabled
                        // olmayan, değeri boş olmayan) option otomatik seçiliyor — kademe asla
                        // boş değerle kalmıyor.
                        if (sel.options[sel.selectedIndex]?.disabled) {
                            const firstAllowed = Array.from(sel.options).find(o => !o.disabled && o.value !== "");
                            if (firstAllowed) sel.value = firstAllowed.value;
                        }

                        // Şube Filtresi - Change listener
                        sel.addEventListener('change', function () {
                            const selectedGrade = this.value;
                            const row = this.closest('div[style*="display:flex"]');
                            if (!row) return;
                            const targetClassSel = row.querySelector('.class-selector');
                            if (!targetClassSel) return;

                            const allowedClassesForThisGrade = kt_classes.filter(c => c.startsWith(selectedGrade + '/')).map(c => c.split('/')[1]);

                            Array.from(targetClassSel.options).forEach(opt => {
                                if (opt.value !== "" && opt.value !== "ALL" && !allowedClassesForThisGrade.includes(opt.value)) {
                                    opt.style.display = 'none';
                                    opt.disabled = true;
                                } else if (opt.value === "ALL") {
                                    opt.style.display = 'none';
                                    opt.disabled = true;
                                } else {
                                    opt.style.display = '';
                                    opt.disabled = false;
                                }
                            });

                            // YENİ: Kademe değişince/ilk yüklemede şube seçicisi de o kademeye
                            // izinli şubelerden ilkini otomatik seçsin — boş kalmasın.
                            const firstAllowedClass = Array.from(targetClassSel.options).find(o => !o.disabled && o.value !== "");
                            targetClassSel.value = firstAllowedClass ? firstAllowedClass.value : "";
                        });

                        // İlk açılışta tetikle
                        sel.dispatchEvent(new Event('change'));
                    });
                }
            }

        } else if (kt_role === 'duty') {
            // Nöbetçi öğrenci ise sadece yönetimi gizle, Ver tabında başlat
            if (yonetimTab) yonetimTab.style.display = 'none';
            showTab('ver');
        } else {
            // Admin - her şey açık
            showTab('ver');
        }

    } catch (e) {
        console.error("Yetkilendirme sırasında hata:", e);
    }
}

// --- TAB & NAVİGASYON ---
function showTab(tabName, eventObj = null) {
    document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
    if (document.getElementById("tab-" + tabName)) {
        document.getElementById("tab-" + tabName).classList.remove("hidden");
    }

    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));

    const evt = eventObj || window.event;
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add("active");
    } else {
        const btn = document.querySelector(`.tab-btn[onclick*="${tabName}"]`);
        if (btn) btn.classList.add("active");
    }
    if (tabName === 'yonetim') {
        closeYonetimForm();
        if (typeof loadSettings === 'function') loadSettings();
    }
}

function showYonetimForm(type) {
    document.getElementById("yonetim-menu").classList.add("hidden");
    document.getElementById("yonetim-form-" + type).classList.remove("hidden");

    // YENİ: Hiç sınıf yetkisi olmayan öğretmen, rapor formuna (Rapor Al veya Emanet Raporu)
    // GİRDİĞİNDE bir kez uyarılsın — Raporlar sekmesi her açıldığında değil, spamlanmasın.
    if ((type === 'report' || type === 'borrowed-report') && window.__teacherNoClassScope && !window.__noClassWarningShown) {
        window.__noClassWarningShown = true;
        Swal.fire({
            icon: 'info',
            title: 'Sınıf Yetkisi Yok',
            text: 'Size tanımlı sınıf bulunmuyor, lütfen yöneticinizle iletişime geçin.',
            allowEnterKey: false,
            focusConfirm: false,
            focusCancel: false
        });
    }

    if (type === 'logs') {
        const dateInput = document.getElementById('logDateFilter');
        if (dateInput) dateInput.value = '';
        if (typeof loadLogs === 'function') loadLogs();
    } else if (type === 'teachers') {
        if (typeof loadTeachersList === 'function') loadTeachersList();
    }
}

function closeYonetimForm() {
    document.querySelectorAll("[id^='yonetim-form-']").forEach(el => el.classList.add("hidden"));
    document.getElementById("yonetim-menu").classList.remove("hidden");
    document.getElementById("report-result").innerHTML = "";
}

function toggleStaffGroups() {
    const mode = document.getElementById("setting_staff_pass_mode").value;
    if (mode === "fixed") {
        document.getElementById("fixedStaffGroup").style.display = "block";
        document.getElementById("dailyStaffGroup").style.display = "none";
    } else {
        document.getElementById("fixedStaffGroup").style.display = "none";
        document.getElementById("dailyStaffGroup").style.display = "block";
    }
}

function updateBookBarcodeFieldState() {
    const qtyInput = document.getElementById("newKitapAdet");
    const rangeCheckbox = document.getElementById("newKitapBarkodRangeMode");
    const rangeOptionWrapper = document.getElementById("customBarcodeRangeOption");
    const barkodInput = document.getElementById("newKitapBarkod");
    if (!qtyInput || !rangeCheckbox || !rangeOptionWrapper || !barkodInput) return;

    const qty = parseInt(qtyInput.value) || 1;

    if (qty > 1) {
        rangeOptionWrapper.classList.remove("hidden");
    } else {
        rangeOptionWrapper.classList.add("hidden");
        rangeCheckbox.checked = false;
    }

    if (qty === 1) {
        barkodInput.disabled = false;
        barkodInput.placeholder = "Boş bırakırsanız otomatik verilir";
    } else if (rangeCheckbox.checked) {
        barkodInput.disabled = false;
        barkodInput.placeholder = "Başlangıç barkodu girin";
    } else {
        barkodInput.disabled = true;
        barkodInput.value = "";
        barkodInput.placeholder = "Otomatik atanır";
    }
}

// --- YARDIMCI FONKSİYONLAR ---
function handleEnter(e, type) {
    if (e.key === "Enter") {
        e.preventDefault();
        if (type === 'sorgu') sorgula(null);
        else type === 'ver' ? islemYap('kitapVer') : islemYap('kitapAl');
    }
}

function playBeep() {
    const s = document.getElementById("beepSound");
    s.currentTime = 0;
    s.play().catch(e => { });
}

let html5QrCode;
function startScanner(inputId) {
    document.getElementById("scanner-modal").classList.remove("hidden");
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" },
        {
            fps: 10,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                // EAN-13 gibi barkodların yatay oranına uygun dikdörtgen tarama alanı (~2.5:1)
                const w = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.85);
                return { width: w, height: Math.floor(w * 0.4) };
            }
        },
        (decodedText) => {
            playBeep();
            document.getElementById(inputId).value = decodedText;
            stopScanner();
        },
        (err) => { }
    ).catch(err => {
        Swal.fire('Hata', 'Kamera açılamadı.', 'error');
        stopScanner();
    });
}

function stopScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById("scanner-modal").classList.add("hidden");
            html5QrCode.clear();
        });
        document.getElementById("scanner-modal").classList.add("hidden");
    }
}

// ==========================================
// AŞAMA 6.2 - ÖĞRETMEN İŞLEMLERİ (CRUD)
// ==========================================

// 1. Global Hafıza
window.currentTeachersList = window.currentTeachersList || [];
let tempSelectedClasses = [];
// YENİ: Sınıf öğretmenliği (Deneliz'in class_teacher_of sütunu, "8-A" biçiminde saklanır)
let tempClassTeacherOf = [];
// YENİ: Bu bölümde kullanıcı bilinçli bir ekleme/silme yapmadıysa classTeacherOf payload'a
// HİÇ eklenmez (Deneliz'in verisi üzerine boş dizi yazılmasın diye).
let classTeacherOfDirty = false;

// 2. Öğretmenleri Getir ve Tabloya Çiz
async function loadTeachersList() {
    // YENİ: şifre artık ne #schoolPass alanında ne localStorage'da duruyor — oturum
    // bileti x-kt-token başlığıyla (ktAuth.js sarmalayıcısı) zaten taşınıyor. Tek
    // gereken, okul kodunun (kimlik bilgisi değil) mevcut olması.
    const codeValue = localStorage.getItem('kutuphane_code');
    if (!codeValue) return;

    const res = await fetchTeachers();
    if (res.status === 'success') {
        window.currentTeachersList = res.data;

        const tbody = document.getElementById('teachersList');
        if (!tbody) return;
        tbody.innerHTML = '';

        window.currentTeachersList.forEach(t => {
            let rolesObj = t.app_roles;
            if (typeof rolesObj === 'string') {
                try { rolesObj = JSON.parse(rolesObj); } catch (e) { rolesObj = {}; }
            }
            rolesObj = rolesObj || {};

            const ktRole = rolesObj.kutuphanemiz?.role || 'teacher';
            const ktClasses = rolesObj.kutuphanemiz?.classes || [];
            const classTeacherOf = Array.isArray(t.class_teacher_of) ? t.class_teacher_of : [];

            let classesText = '';
            if (ktRole === 'admin') {
                classesText = '<span style="background:#10b981; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.8rem;">Tam Yetki (Admin)</span>';
            } else if (ktClasses.includes('ALL')) {
                classesText = '<span style="background:#3b82f6; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.8rem;">Tüm Okul</span>';
            } else {
                classesText = ktClasses.join(', ');
            }

            // YENİ: Sınıf öğretmenliği rozeti (varsa), mevcut rozetin yanına eklenir.
            if (classTeacherOf.length > 0) {
                const ctoDisplay = classTeacherOf.map(c => c.replace('-', '/')).join(', ');
                classesText += (classesText ? ' ' : '') + `<span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:12px; font-size:0.8rem;">Sınıf öğr.: ${ctoDisplay}</span>`;
            }

            const tr = document.createElement('tr');
            // DİKKAT: İletişim sütunu silindi. Sadece 4 sütun (Ad, Rol, Sınıflar, İşlem)
            tr.innerHTML = `
                <td style="padding:10px 5px; border-bottom:1px solid #f3f4f6;">${t.full_name}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #f3f4f6;">${ktRole === 'admin' ? 'Yönetici' : 'Öğretmen'}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #f3f4f6;">${classesText}</td>
                <td style="padding:10px 5px; border-bottom:1px solid #f3f4f6; text-align:right;">
                    <button onclick="window.openTeacherFormModal('${t.id}')" style="background:#f3f4f6; border:1px solid #d1d5db; padding:5px 10px; border-radius:6px; cursor:pointer; font-weight:bold; color:#374151;">Düzenle</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// 3. Modalı Aç (Yeni veya Düzenle)
window.openTeacherFormModal = function (teacherId = null) {
    const modalEl = document.getElementById('teacherFormModal');
    if (!modalEl) return;
    modalEl.classList.remove('hidden');

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    const allCheckbox = document.getElementById('teacherFormAll');
    const delBtn = document.getElementById('teacherFormDeleteBtn');

    if (typeof populateGradeAndClassSelects === 'function') populateGradeAndClassSelects();

    // YENİ: Önceki düzenlemeden kalan seçim sızmasın — her açılışta her iki bölümün kademe/şube
    // seçicileri de varsayılan (boş) değere döner.
    setVal('teacherFormGrade', ''); setVal('teacherFormClass', '');
    setVal('teacherFormCtoGrade', ''); setVal('teacherFormCtoClass', '');

    // YENİ: Her modal açılışı yeni bir düzenleme oturumu — "kirli" bayrağı sıfırlanır.
    classTeacherOfDirty = false;

    if (teacherId) {
        // --- DÜZENLEME MODU ---
        const titleEl = document.getElementById('teacherModalTitle');
        if (titleEl) titleEl.innerText = "Öğretmen Düzenle";
        if (delBtn) delBtn.style.display = 'block';

        const t = window.currentTeachersList.find(x => String(x.id) === String(teacherId));
        if (!t) return alert("Öğretmen verisi hafızada bulunamadı, sayfayı yenileyin.");

        let rolesObj = t.app_roles;
        if (typeof rolesObj === 'string') {
            try { rolesObj = JSON.parse(rolesObj); } catch (e) { rolesObj = {}; }
        }
        rolesObj = rolesObj || {};

        setVal('teacherFormId', t.id);
        setVal('teacherFormName', t.full_name);
        setVal('teacherFormUsername', t.username || ''); // Yeni eklenen
        setVal('teacherFormEmail', t.email || '');
        setVal('teacherFormPhone', t.phone || '');
        setVal('teacherFormPassword', '');

        const role = rolesObj.kutuphanemiz?.role || 'teacher';
        const classes = rolesObj.kutuphanemiz?.classes || [];

        setVal('teacherFormKtRole', role);

        if (allCheckbox) {
            if (classes.includes('ALL')) {
                allCheckbox.checked = true;
                tempSelectedClasses = [];
            } else {
                allCheckbox.checked = false;
                tempSelectedClasses = classes;
            }
        }

        // YENİ: Sınıf öğretmenliği (Deneliz'in class_teacher_of'u) formda gösterilir.
        tempClassTeacherOf = Array.isArray(t.class_teacher_of) ? t.class_teacher_of.slice() : [];
    } else {
        // --- YENİ EKLEME MODU ---
        const titleEl = document.getElementById('teacherModalTitle');
        if (titleEl) titleEl.innerText = "Yeni Öğretmen Ekle";
        if (delBtn) delBtn.style.display = 'none';

        setVal('teacherFormId', '');
        setVal('teacherFormName', '');
        setVal('teacherFormUsername', ''); // Yeni eklenen
        setVal('teacherFormEmail', '');
        setVal('teacherFormPhone', '');
        setVal('teacherFormPassword', '');
        setVal('teacherFormKtRole', 'teacher');

        if (allCheckbox) allCheckbox.checked = false;
        tempSelectedClasses = [];
        tempClassTeacherOf = [];
    }

    if (typeof toggleTeacherRoleSelect === 'function') toggleTeacherRoleSelect();
    if (typeof renderSelectedClasses === 'function') renderSelectedClasses();
    if (typeof renderClassTeacherOfChips === 'function') renderClassTeacherOfChips();
};

function closeTeacherFormModal() {
    document.getElementById('teacherFormModal').classList.add('hidden');
}

// 4. Arayüz ve Dropdown Kontrolleri
function toggleTeacherRoleSelect() {
    const role = document.getElementById('teacherFormKtRole').value;
    const isAll = document.getElementById('teacherFormAll').checked;
    const addArea = document.getElementById('teacherClassAddArea');
    const chipsArea = document.getElementById('selectedClassesList');

    if (role === 'admin' || isAll) {
        addArea.style.opacity = '0.4';
        addArea.style.pointerEvents = 'none';
        chipsArea.style.opacity = '0.4';
    } else {
        addArea.style.opacity = '1';
        addArea.style.pointerEvents = 'auto';
        chipsArea.style.opacity = '1';
    }
}

// YENİ: Kademe listesi artık sabit "5-12 + Hazırlık" değil — /api/getGradeOptions'tan,
// okulun GERÇEK türüne göre gelir (örn. ilkokul'da 1-4, dershane-lise'de 9-12 + Mezun).
// "Hazırlık" kaldırıldı: hiçbir öğrencinin grade'i bu değeri almıyor (salt-okunur kontrol
// edildi), bu yüzden bir öğretmeni "Hazırlık" sınıfına atamak hiçbir zaman bir öğrenciyle
// eşleşmiyordu — kullanılmayan bir seçenekti.
async function populateGradeAndClassSelects() {
    const gradeSelect = document.getElementById('teacherFormGrade');
    const classSelect = document.getElementById('teacherFormClass');
    // Sınıf öğretmenliği bölümünün seçicileri de AYNI listeden doldurulur.
    const ctoGradeSelect = document.getElementById('teacherFormCtoGrade');
    const ctoClassSelect = document.getElementById('teacherFormCtoClass');
    const subeler = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    const fillClass = (sel) => {
        if (!sel) return;
        sel.innerHTML = '<option value="">Şube</option>';
        subeler.forEach(s => sel.innerHTML += `<option value="${s}">${s}</option>`);
    };
    fillClass(classSelect);
    fillClass(ctoClassSelect);

    const resetGrade = (sel) => { if (sel) sel.innerHTML = '<option value="">Kademe</option>'; };
    resetGrade(gradeSelect);
    resetGrade(ctoGradeSelect);

    try {
        const res = await fetch('/api/getGradeOptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ktAuthFields())
        });
        const r = await res.json();
        if (r.status !== 'success') {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'Kademe listesi alınamadı.' });
            return;
        }

        const grades = (r.data && r.data.grades) || [];
        const labelFor = (g) => (typeof window.ktGradeLabel === 'function' ? window.ktGradeLabel(g) : `${g}. Sınıf`);
        const fillGrade = (sel) => {
            if (!sel) return;
            sel.innerHTML = '<option value="">Kademe</option>';
            grades.forEach(g => sel.innerHTML += `<option value="${g}">${labelFor(g)}</option>`);
        };
        fillGrade(gradeSelect);
        fillGrade(ctoGradeSelect);
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Kademe listesi yüklenemedi.' });
    }
}

function addClassToTeacherForm() {
    const gradeEl = document.getElementById('teacherFormGrade');
    const classEl = document.getElementById('teacherFormClass');
    const g = gradeEl.value;
    const c = classEl.value;
    if (!g || !c) return alert("Lütfen Kademe ve Şube seçin!");
    const combo = `${g}/${c}`;
    if (!tempSelectedClasses.includes(combo)) {
        tempSelectedClasses.push(combo);
        renderSelectedClasses();
    }
    // YENİ: Ekledikten sonra seçiciler varsayılana döner — Kaydet'te "eklenmemiş seçim" diye
    // tekrar sorulmasın (seçiciler zaten boşsa confirmPendingClassSelection hiç sormuyor).
    gradeEl.value = '';
    classEl.value = '';
}

function removeClassFromTeacherForm(combo) {
    tempSelectedClasses = tempSelectedClasses.filter(c => c !== combo);
    renderSelectedClasses();
}

// YENİ: Sınıf öğretmenliği (class_teacher_of, Deneliz biçimi "8-A" olarak saklanır,
// chip'te okunaklı "8/A" gösterilir). Her ekleme/silme "kirli" bayrağını işaretler —
// bu sayede kullanıcı dokunmadıysa saveTeacherForm bu alanı payload'a hiç koymaz.
function addClassTeacherOf() {
    const gradeEl = document.getElementById('teacherFormCtoGrade');
    const classEl = document.getElementById('teacherFormCtoClass');
    const g = gradeEl.value;
    const c = classEl.value;
    if (!g || !c) return alert("Lütfen Kademe ve Şube seçin!");
    const combo = `${g}-${c}`;
    if (!tempClassTeacherOf.includes(combo)) {
        tempClassTeacherOf.push(combo);
        classTeacherOfDirty = true;
        renderClassTeacherOfChips();
    }
    // YENİ: Ekledikten sonra seçiciler varsayılana döner (bkz. addClassToTeacherForm).
    gradeEl.value = '';
    classEl.value = '';
}

function removeClassTeacherOf(combo) {
    tempClassTeacherOf = tempClassTeacherOf.filter(c => c !== combo);
    classTeacherOfDirty = true;
    renderClassTeacherOfChips();
}

function renderClassTeacherOfChips() {
    const container = document.getElementById('selectedCtoClassesList');
    if (!container) return;
    container.innerHTML = '';
    tempClassTeacherOf.forEach(c => {
        const display = c.replace('-', '/'); // Depolanan biçim ("8-A") yerine okunaklı gösterim
        container.innerHTML += `
            <div style="background:#fef3c7; color:#92400e; padding:5px 10px; border-radius:16px; font-size:0.85rem; font-weight:bold; display:flex; align-items:center; gap:5px;">
                ${display}
                <span onclick="removeClassTeacherOf('${c}')" style="cursor:pointer; color:#ef4444; font-size:1.1rem; line-height:1;">&times;</span>
            </div>
        `;
    });
}

// YENİ: "Ekle"ye basmadan "Kaydet"e basılırsa (kademe VE şube seçili ama eklenmemiş),
// kaydetmeden önce sorar. addFn başarıyla eklerse ilgili dizi/kirli bayrağı da güncellenir
// (addClassToTeacherForm / addClassTeacherOf zaten bunu kendi içinde yapıyor).
// alreadyAddedFn(g, c): seçili kombinasyon ilgili bölümün listesinde ZATEN varsa true döner
// — bu durumda hiç sorulmaz (addClassToTeacherForm/addClassTeacherOf zaten Ekle'den sonra
// seçicileri sıfırlıyor, ama kullanıcı aynı kombinasyonu tekrar seçip Ekle'ye basmazsa bu
// kontrol yine de yanlış uyarıyı önler).
async function confirmPendingClassSelection(gradeSelectId, classSelectId, addFn, alreadyAddedFn) {
    const gradeEl = document.getElementById(gradeSelectId);
    const classEl = document.getElementById(classSelectId);
    const g = gradeEl ? gradeEl.value : '';
    const c = classEl ? classEl.value : '';
    if (!g || !c) return 'none'; // seçili değilse hiç sorma
    if (alreadyAddedFn && alreadyAddedFn(g, c)) return 'none'; // zaten eklenmiş, sorma

    const combo = `${g}/${c}`;
    const result = await Swal.fire({
        title: 'Eklenmemiş Seçim',
        html: `Seçtiğiniz <b>${combo}</b> sınıfı henüz eklenmedi. Eklensin mi?`,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Eklenip kaydet',
        denyButtonText: 'Eklemeden kaydet',
        cancelButtonText: 'Vazgeç',
        confirmButtonColor: '#10b981',
        denyButtonColor: '#6b7280',
        cancelButtonColor: '#ef4444',
        allowOutsideClick: false,
        allowEnterKey: false,
        focusConfirm: false,
        focusCancel: false
    });

    if (result.isConfirmed) { addFn(); return 'added'; }
    if (result.isDenied) return 'skip';
    return 'cancel';
}

function renderSelectedClasses() {
    const container = document.getElementById('selectedClassesList');
    if (!container) return;
    container.innerHTML = '';
    tempSelectedClasses.forEach(c => {
        container.innerHTML += `
            <div style="background:#e0e7ff; color:#4f46e5; padding:5px 10px; border-radius:16px; font-size:0.85rem; font-weight:bold; display:flex; align-items:center; gap:5px;">
                ${c}
                <span onclick="removeClassFromTeacherForm('${c}')" style="cursor:pointer; color:#ef4444; font-size:1.1rem; line-height:1;">&times;</span>
            </div>
        `;
    });
}

// 5. Veriyi Kaydet (API'ye Gönder)
window.saveTeacherForm = async function () {
    const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value.trim() : "";

    const id = getVal('teacherFormId');
    const fullName = getVal('teacherFormName');
    const username = getVal('teacherFormUsername'); // Yeni eklenen
    const email = getVal('teacherFormEmail');
    const phone = getVal('teacherFormPhone');
    const password = getVal('teacherFormPassword');
    const ktRole = getVal('teacherFormKtRole');

    const allCb = document.getElementById('teacherFormAll');
    const isAll = allCb ? allCb.checked : false;

    // 🚀 AKILLI DOĞRULAMA (Senin İstediğin Mantık)
    if (!fullName) {
        await Swal.fire({ icon: 'warning', title: 'Eksik Bilgi', text: 'Ad Soyad alanı zorunludur.' });
        return;
    }
    if (!username && !email && !phone) {
        await Swal.fire({ icon: 'warning', title: 'Eksik Bilgi', text: "İletişim için 'Kullanıcı Adı', 'E-Posta' veya 'Telefon' bilgilerinden en az BİRİNİ doldurmalısınız." });
        return;
    }
    if (!id && !password) {
        await Swal.fire({ icon: 'warning', title: 'Eksik Bilgi', text: 'Yeni öğretmen eklerken şifre belirlemek zorunludur.' });
        return;
    }
    // YENİ: şifre alanı doluysa (yeni ekleme her zaman, düzenlemede yalnız değiştirildiyse)
    // aynı kural sunucuyla AYNI — kullanıcı adı olarak kaydedilecek değer verilir.
    if (password) {
        const policyCheck = validateStaffPasswordClient(password, { username });
        if (!policyCheck.ok) {
            await Swal.fire({ icon: 'warning', title: 'Geçersiz Şifre', text: policyCheck.message });
            return;
        }
    }

    // YENİ: "Ekle"ye basılmadan "Kaydet"e basılırsa, kaydetmeden önce sor (her iki bölüm için).
    // "Ek sınıflar" bölümü admin/ALL'da zaten pasif olduğundan o durumda sorulmaz.
    if (!(ktRole === 'admin' || isAll)) {
        const ekSonuc = await confirmPendingClassSelection('teacherFormGrade', 'teacherFormClass', addClassToTeacherForm, (g, c) => tempSelectedClasses.includes(`${g}/${c}`));
        if (ekSonuc === 'cancel') return;
    }
    const ctoSonuc = await confirmPendingClassSelection('teacherFormCtoGrade', 'teacherFormCtoClass', addClassTeacherOf, (g, c) => tempClassTeacherOf.includes(`${g}-${c}`));
    if (ctoSonuc === 'cancel') return;

    let finalClasses = [];
    if (ktRole === 'admin' || isAll) finalClasses = ['ALL'];
    else finalClasses = tempSelectedClasses;

    const payload = {
        ...ktAuthFields(),
        id: id || null,
        fullName,
        username, // Payload'a eklendi
        email,
        phone,
        password,
        ktRole,
        ktClasses: finalClasses
    };

    // YENİ: classTeacherOf yalnızca kullanıcı bu bölümde bilinçli bir değişiklik yaptıysa
    // (dirty) payload'a eklenir — dokunmadıysa hiç gönderilmez, Deneliz'in verisi korunur.
    if (classTeacherOfDirty) {
        payload.classTeacherOf = tempClassTeacherOf;
    }

    const res = await saveTeacher(payload); // api-client.js'deki fonksiyon
    if (res.status === 'success') {
        // YENİ: şifre de değiştirildiyse (sunucu bunu passwordChanged ile bildirir), admini
        // bu kullanıcının oturumunun düşeceği konusunda bilgilendir (SweetAlert2, native alert yok).
        let successText = res.message || "İşlem başarılı.";
        if (res.passwordChanged) {
            successText += " Bu kullanıcının açık oturumu bir sonraki istekte sona erecek.";
        }
        await Swal.fire({ icon: 'success', title: 'Başarılı', text: successText });
        if (typeof closeTeacherFormModal === 'function') closeTeacherFormModal();
        tempSelectedClasses = [];
        tempClassTeacherOf = [];
        classTeacherOfDirty = false;
        loadTeachersList();
    } else {
        await Swal.fire({ icon: 'error', title: 'Hata', text: res.message });
    }
};

// 6. YENİ: Öğretmeni Sil
window.deleteTeacherForm = async function () {
    const id = document.getElementById('teacherFormId').value;
    const name = document.getElementById('teacherFormName').value;

    if (!id) return;

    if (!confirm(`⚠️ DİKKAT: ${name} adlı öğretmeni sistemden tamamen silmek istediğinize emin misiniz?`)) {
        return;
    }

    const payload = {
        ...ktAuthFields(),
        id: id
    };

    // Bu fonksiyonu birazdan Agent ile api-client.js ve backend'e ekleyeceğiz
    const res = await deleteTeacherAPI(payload);

    if (res.status === 'success') {
        alert("Öğretmen başarıyla silindi.");
        if (typeof closeTeacherFormModal === 'function') closeTeacherFormModal();
        loadTeachersList();
    } else {
        alert("Silme hatası: " + res.message);
    }
};

// ==========================================
// KİTAP DÜZENLEME VE SİLME MODÜLÜ
// ==========================================

window.foundBooksList = []; // Arama sonuçlarını hafızada tutar

window.openBookSearchModal = function () {
    document.getElementById('bookEditSearchModal').classList.remove('hidden');
    document.getElementById('bookSearchInput').value = '';
    document.getElementById('bookSearchResults').innerHTML = '';
    document.getElementById('bookEditFormArea').style.display = 'none';
};

window.closeBookSearchModal = function () {
    document.getElementById('bookEditSearchModal').classList.add('hidden');
};

// 1. Kitapları API'den Ara
window.searchBookForEdit = async function () {
    const query = document.getElementById('bookSearchInput').value.trim();
    if (query.length < 2) return alert("Aramak için en az 2 karakter girmelisiniz.");

    const resultsArea = document.getElementById('bookSearchResults');
    resultsArea.innerHTML = '<div style="padding:10px; color:#6b7280; text-align:center;">Arama yapılıyor...</div>';

    // Bu fonksiyonu Agent api-client.js içine yazacak
    const res = await searchBooksAPI({ ...ktAuthFields(), query: query });

    if (res.status === 'success') {
        window.foundBooksList = res.data;
        if (window.foundBooksList.length === 0) {
            resultsArea.innerHTML = '<div style="padding:10px; color:#ef4444; text-align:center;">Sonuç bulunamadı.</div>';
            return;
        }

        resultsArea.innerHTML = '';
        window.foundBooksList.forEach(book => {
            const statusColor = (book.status === 'Emanette') ? '#ef4444' : '#10b981';
            resultsArea.innerHTML += `
                <div onclick="selectBookForEdit('${book.id}')" 
                     style="padding:10px; background:#f3f4f6; border:1px solid #e5e7eb; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color:#1f2937;">${book.book_name}</strong><br>
                        <small style="color:#6b7280;">Barkod: ${book.barcode} | Yazar: ${book.author || '-'}</small>
                    </div>
                    <span style="background:${statusColor}; color:white; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:bold;">${book.status || 'Rafta'}</span>
                </div>
            `;
        });
    } else {
        resultsArea.innerHTML = `<div style="padding:10px; color:#ef4444; text-align:center;">Hata: ${res.message}</div>`;
    }
};

// 2. Tıklanan Kitabı Forma Doldur
window.selectBookForEdit = function (id) {
    const book = window.foundBooksList.find(b => String(b.id) === String(id));
    if (!book) return;

    document.getElementById('editB_id').value = book.id;
    document.getElementById('editB_status').value = book.status || 'Rafta'; // Güvenlik için
    document.getElementById('editB_barcode').value = book.barcode || '';
    document.getElementById('editB_name').value = book.book_name || '';
    document.getElementById('editB_author').value = book.author || '';
    document.getElementById('editB_publisher').value = book.publisher || '';
    document.getElementById('editB_shelf').value = book.shelf || '';
    document.getElementById('editB_category').value = book.category || '';
    document.getElementById('editB_pages').value = book.page_count || '';
    document.getElementById('editB_condition').value = book.condition || 'Yeni';

    document.getElementById('bookEditFormArea').style.display = 'block';
};

// 3. Değişiklikleri Kaydet
window.saveBookEdit = async function () {
    const payload = {
        ...ktAuthFields(),
        id: document.getElementById('editB_id').value,
        barcode: document.getElementById('editB_barcode').value.trim(),
        book_name: document.getElementById('editB_name').value.trim(),
        author: document.getElementById('editB_author').value.trim(),
        publisher: document.getElementById('editB_publisher').value.trim(),
        shelf: document.getElementById('editB_shelf').value.trim(),
        category: document.getElementById('editB_category').value.trim(),
        page_count: parseInt(document.getElementById('editB_pages').value) || null,
        condition: document.getElementById('editB_condition').value
    };

    if (!payload.book_name || !payload.barcode) return alert("Kitap Adı ve Barkod zorunludur.");

    // Bu fonksiyonu Agent yazacak
    const res = await updateBookAPI(payload);
    if (res.status === 'success') {
        alert("Kitap başarıyla güncellendi!");
        closeBookSearchModal();
    } else {
        alert("Hata: " + res.message);
    }
};

// 4. Kitabı Sil (Güvenlik Kilitli)
window.deleteBookEdit = async function () {
    const status = document.getElementById('editB_status').value;
    const name = document.getElementById('editB_name').value;

    // GÜVENLİK KİLİDİ
    if (status === 'Emanette') {
        return alert(`⛔ DİKKAT: "${name}" isimli kitap şu an bir öğrencide EMANETTE görünmektedir.\n\nEmanette olan bir kitabı silemezsiniz. Lütfen önce kitabı sistemden iade alın!`);
    }

    if (!confirm(`⚠️ "${name}" isimli kitabı kütüphaneden TAMAMEN silmek istediğinize emin misiniz?`)) return;

    const payload = {
        ...ktAuthFields(),
        id: document.getElementById('editB_id').value
    };

    // Bu fonksiyonu Agent yazacak
    const res = await deleteBookAPI(payload);
    if (res.status === 'success') {
        alert("Kitap sistemden silindi.");
        closeBookSearchModal();
    } else {
        alert("Silme hatası: " + res.message);
    }
};

// ==========================================
// ARAYÜZ YARDIMCI FONKSİYONLARI
// ==========================================
window.togglePasswordVisibility = function (inputId, iconElement) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        iconElement.innerText = 'visibility_off';
    } else {
        input.type = 'password';
        iconElement.innerText = 'visibility';
    }
};