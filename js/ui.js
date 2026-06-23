// --- BAŞLANGIÇ & AYARLAR ---
// Splash 2.8 saniye (2800ms)
window.addEventListener('load', () => {
    setTimeout(() => {
        document.getElementById('splash-screen').classList.add('hidden-splash');
        document.body.style.overflow = 'auto';
    }, 2800);
});

function logout() {
    Swal.fire({
        title: 'Çıkış?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Evet',
        cancelButtonText: 'Hayır'
    }).then((res) => {
        if (res.isConfirmed) {
            // 1. LocalStorage temizliği
            localStorage.removeItem("kutuphane_code");
            localStorage.removeItem("kutuphane_pass");
            localStorage.removeItem("beni_hatirla");
            localStorage.removeItem("okul_ismi");
            localStorage.removeItem("kutuphane_identity");
            localStorage.removeItem("kutuphane_user");
            localStorage.removeItem("kutuphane_login_type");

            // 2. SPA Mimarisi: Sayfayı yenilemek yerine sadece UI'ı değiştiriyoruz
            document.getElementById("dashboard").classList.add("hidden");
            document.getElementById("login-screen").classList.remove("hidden");

            // 3. Giriş formunu sıfırlama
            document.getElementById("schoolCode").value = "";
            document.getElementById("schoolPass").value = "";
            document.getElementById("teacherIdentity").value = "";
            document.getElementById("beniHatirla").checked = false;
        }
    });
}

window.onload = function () {
    const savedCode = localStorage.getItem("kutuphane_code");
    const savedPass = localStorage.getItem("kutuphane_pass");
    const savedIdentity = localStorage.getItem("kutuphane_identity");
    const savedLoginType = localStorage.getItem("kutuphane_login_type");

    if (savedCode && savedPass) {
        document.getElementById("schoolCode").value = savedCode;
        document.getElementById("schoolPass").value = savedPass;
        document.getElementById("beniHatirla").checked = (localStorage.getItem("beni_hatirla") === "true");

        if (savedLoginType === 'staff') {
            if (typeof switchLoginTab === 'function') switchLoginTab('staff');
            if (savedIdentity) document.getElementById("teacherIdentity").value = savedIdentity;
        }

        if (localStorage.getItem("okul_ismi")) {
            document.getElementById("headerTitle").innerText = localStorage.getItem("okul_ismi");
        }

        login();
    }
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

            // Rapor ve Emanet Raporu dışındaki tüm yönetim menülerini gizle
            document.querySelectorAll('.yonetim-card').forEach(card => {
                const isReport = card.getAttribute('onclick') === "showYonetimForm('report')" || card.getAttribute('onclick') === "showYonetimForm('borrowed-report')";
                if (!isReport) {
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
                const allowedGrades = [...new Set(kt_classes.map(c => String(c).split('/')[0]))];

                document.querySelectorAll(".grade-selector").forEach(sel => {
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

                    if (sel.options[sel.selectedIndex]?.disabled) { sel.value = ""; }

                    // Şube Filtresi - Change listener
                    sel.addEventListener('change', function () {
                        const selectedGrade = this.value;
                        const row = this.closest('div[style*="display:flex"]');
                        if (!row) return;
                        const targetClassSel = row.querySelector('.class-selector');
                        if (!targetClassSel) return;
                        targetClassSel.value = "";

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
                    });

                    // İlk açılışta tetikle
                    sel.dispatchEvent(new Event('change'));
                });
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
        { fps: 10, qrbox: { width: 250, height: 250 } },
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

// 2. Öğretmenleri Getir ve Tabloya Çiz
async function loadTeachersList() {
    const codeEl = document.getElementById('schoolCode');
    const passEl = document.getElementById('schoolPass');

    const codeValue = codeEl ? codeEl.value : "";
    const passValue = passEl ? passEl.value : "";

    if (!codeValue || !passValue) return;

    const res = await fetchTeachers(codeValue, passValue);
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

            let classesText = '';
            if (ktRole === 'admin') {
                classesText = '<span style="background:#10b981; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.8rem;">Tam Yetki (Admin)</span>';
            } else if (ktClasses.includes('ALL')) {
                classesText = '<span style="background:#3b82f6; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.8rem;">Tüm Okul</span>';
            } else {
                classesText = ktClasses.join(', ');
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
    }

    if (typeof toggleTeacherRoleSelect === 'function') toggleTeacherRoleSelect();
    if (typeof renderSelectedClasses === 'function') renderSelectedClasses();
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

function populateGradeAndClassSelects() {
    const gradeSelect = document.getElementById('teacherFormGrade');
    const classSelect = document.getElementById('teacherFormClass');
    const grades = ['5', '6', '7', '8', '9', '10', '11', '12', 'Hazırlık'];
    const subeler = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    if (gradeSelect) {
        gradeSelect.innerHTML = '<option value="">Kademe</option>';
        grades.forEach(g => gradeSelect.innerHTML += `<option value="${g}">${g}. Sınıf</option>`);
    }
    if (classSelect) {
        classSelect.innerHTML = '<option value="">Şube</option>';
        subeler.forEach(s => classSelect.innerHTML += `<option value="${s}">${s}</option>`);
    }
}

function addClassToTeacherForm() {
    const g = document.getElementById('teacherFormGrade').value;
    const c = document.getElementById('teacherFormClass').value;
    if (!g || !c) return alert("Lütfen Kademe ve Şube seçin!");
    const combo = `${g}/${c}`;
    if (!tempSelectedClasses.includes(combo)) {
        tempSelectedClasses.push(combo);
        renderSelectedClasses();
    }
}

function removeClassFromTeacherForm(combo) {
    tempSelectedClasses = tempSelectedClasses.filter(c => c !== combo);
    renderSelectedClasses();
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
    if (!fullName) return alert("Ad Soyad alanı zorunludur.");
    if (!username && !email && !phone) {
        return alert("İletişim için 'Kullanıcı Adı', 'E-Posta' veya 'Telefon' bilgilerinden en az BİRİNİ doldurmalısınız.");
    }
    if (!id && !password) return alert("Yeni öğretmen eklerken şifre belirlemek zorunludur.");

    let finalClasses = [];
    if (ktRole === 'admin' || isAll) finalClasses = ['ALL'];
    else finalClasses = tempSelectedClasses;

    const payload = {
        schoolCode: getVal('schoolCode'),
        schoolPass: getVal('schoolPass'),
        id: id || null,
        fullName,
        username, // Payload'a eklendi
        email,
        phone,
        password,
        ktRole,
        ktClasses: finalClasses
    };

    const res = await saveTeacher(payload); // api-client.js'deki fonksiyon
    if (res.status === 'success') {
        alert(res.message || "İşlem başarılı.");
        if (typeof closeTeacherFormModal === 'function') closeTeacherFormModal();
        loadTeachersList();
    } else {
        alert("Hata: " + res.message);
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
        schoolCode: document.getElementById('schoolCode').value,
        schoolPass: document.getElementById('schoolPass').value,
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

    const code = document.getElementById('schoolCode').value;
    const pass = document.getElementById('schoolPass').value;

    const resultsArea = document.getElementById('bookSearchResults');
    resultsArea.innerHTML = '<div style="padding:10px; color:#6b7280; text-align:center;">Arama yapılıyor...</div>';

    // Bu fonksiyonu Agent api-client.js içine yazacak
    const res = await searchBooksAPI({ schoolCode: code, schoolPass: pass, query: query });

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
        schoolCode: document.getElementById('schoolCode').value,
        schoolPass: document.getElementById('schoolPass').value,
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
        schoolCode: document.getElementById('schoolCode').value,
        schoolPass: document.getElementById('schoolPass').value,
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