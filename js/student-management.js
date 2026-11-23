// Öğrenci İşlemleri (Geniş Ekran) sayfası - bağımsız script.
// index.html'in js/api-client.js ve js/ui.js dosyalarına kasıtlı olarak bağımlı DEĞİL
// (onlar o sayfaya özel DOM id'lerine sıkı bağlı). js/ktAuth.js'e (bağımsız, paylaşılan
// yardımcı) bağımlı — kimlik doğrulama oturum bileti (kutuphane_token) ile yapılıyor.

let currentStudentsById = new Map();
let lastSearchParams = null;

// --- Başlangıç / Kimlik Doğrulama ---
document.addEventListener('DOMContentLoaded', async () => {
    const code = localStorage.getItem('kutuphane_code');
    const hasToken = typeof getKtToken === 'function' && !!getKtToken();

    if (!code || !hasToken) {
        redirectToLogin();
        return;
    }

    // YENİ: Bu sayfa sadece yöneticiye açık. Kozmetik bir kontrol — gerçek sınır sunucuda
    // (her uç nokta kendi isAdmin kontrolünü yapıyor); burada amaç, yönetici olmayan bir
    // kullanıcıya anlaşılır bir mesaj gösterip index.html'e yönlendirmek. kt_role eski bir
    // oturumdan dolayı hiç yoksa da yönetici sayılmaz, aynı şekilde yönlendirilir.
    const ktRole = localStorage.getItem('kt_role');
    if (ktRole !== 'admin') {
        await Swal.fire({
            icon: 'warning',
            title: 'Yetkisiz Erişim',
            text: 'Bu sayfaya yalnızca yöneticiler erişebilir.',
            allowEnterKey: false,
            focusConfirm: false,
            focusCancel: false,
            allowOutsideClick: false
        });
        redirectToLogin();
        return;
    }

    await Promise.all([loadGradeOptions(), loadClassOptions()]);
    refreshPhotoCounter();
});

function redirectToLogin() {
    window.location.href = 'index.html';
}

function closePage() {
    window.close();
    // Sekme index.html'den window.open() ile açıldıysa yukarıdaki satır sekmeyi kapatır ve
    // buradan sonrası hiç çalışmaz (belge yok edilir). Sekme başka bir yolla (doğrudan URL,
    // yer imi vb.) açıldıysa tarayıcı güvenliği window.close()'u sessizce engeller; bu durumda
    // kullanıcıya elle kapatması gerektiğini bildiririz.
    setTimeout(() => {
        Swal.fire({ icon: 'info', title: 'Sekme Kapatılamadı', text: 'Bu sekmeyi elle kapatabilirsiniz.' });
    }, 300);
}

function getAuthPayload() {
    // Merkezi yardımcı js/ktAuth.js'te — sadece schoolCode döner; bilet zaten fetch
    // sarmalayıcısı tarafından x-kt-token başlığına ekleniyor.
    return (typeof ktAuthFields === 'function') ? ktAuthFields() : { schoolCode: localStorage.getItem('kutuphane_code') };
}

function escapeHtmlText(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

// --- Kademe / Şube Seçenekleri ---
async function loadGradeOptions() {
    try {
        const res = await fetch('/api/getGradeOptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getAuthPayload())
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();
        if (r.status !== 'success') {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'Kademe listesi alınamadı.' });
            return;
        }

        const grades = (r.data && r.data.grades) || [];
        const labelFor = (g) => (typeof window.ktGradeLabel === 'function' ? window.ktGradeLabel(g) : `${g}. Sınıf`);
        const optionsHtml = grades.map(g => `<option value="${g}">${labelFor(g)}</option>`).join('');

        document.getElementById('sm_gradeFilter').innerHTML = `<option value="">-- Kademe --</option>${optionsHtml}`;
        document.getElementById('sm_formGrade').innerHTML = `<option value="">-- Kademe --</option>${optionsHtml}`;
        document.getElementById('sm_bulkGrade').innerHTML = `<option value="">-- Kademe --</option>${optionsHtml}`;
        document.getElementById('sm_eokulGrade').innerHTML = `<option value="">-- Kademe --</option>${optionsHtml}`;
    } catch (e) { console.error('Kademe listesi yüklenemedi', e); }
}

async function loadClassOptions() {
    try {
        const res = await fetch('/api/getClasses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getAuthPayload())
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();
        if (r.status !== 'success') return;

        const classes = (r.data && r.data.classes) || [];
        const optionsHtml = classes.map(c => `<option value="${escapeHtmlText(c)}">${escapeHtmlText(c)}</option>`).join('');
        document.getElementById('sm_classFilter').innerHTML = `<option value="">-- Şube --</option>${optionsHtml}`;
        document.getElementById('sm_bulkClass').innerHTML = `<option value="">-- Şube --</option>${optionsHtml}<option value="__new__">Yeni Şube Tanımla</option>`;
    } catch (e) { console.error('Şube listesi yüklenemedi', e); }
}

// --- Arama / Listeleme ---
function runSearch() {
    const text = document.getElementById('sm_searchInput').value.trim();
    const grade = document.getElementById('sm_gradeFilter').value;
    const className = document.getElementById('sm_classFilter').value;
    const status = document.getElementById('sm_statusFilter').value;
    const withoutPhoto = document.getElementById('sm_withoutPhotoFilter').checked;

    if (text.length < 2 && !className && !grade && !withoutPhoto && status === 'active') {
        Swal.fire({ icon: 'warning', title: 'Eksik Bilgi', text: 'Lütfen aramak için en az 2 karakter girin veya bir filtre seçin.' });
        return;
    }

    fetchAndRenderStudents({ query: text, grade, className, status, withoutPhoto });
}

// Kademe/Şube/Durum seçicileri ve "Sadece fotoğrafı olmayanlar" onay kutusu değiştiğinde
// (onchange) çağrılır. runSearch'ten farkı: hiçbir ölçüt kalmasa da "Eksik Bilgi" uyarısı
// GÖSTERMEZ, o anki alan durumunu olduğu gibi sunucuya gönderir (ölçüt yoksa bu doğal
// olarak "tüm aktif öğrenciler" sorgusuna denk gelir) — alanları SIFIRLAMAZ.
function applyFilters() {
    const rawText = document.getElementById('sm_searchInput').value.trim();
    const text = rawText.length >= 2 ? rawText : ''; // 1 karakterlik yarım yazım sunucuya gönderilmez
    const grade = document.getElementById('sm_gradeFilter').value;
    const className = document.getElementById('sm_classFilter').value;
    const status = document.getElementById('sm_statusFilter').value;
    const withoutPhoto = document.getElementById('sm_withoutPhotoFilter').checked;

    fetchAndRenderStudents({ query: text, grade, className, status, withoutPhoto });
}

function listAllStudents() {
    document.getElementById('sm_searchInput').value = '';
    document.getElementById('sm_gradeFilter').value = '';
    document.getElementById('sm_classFilter').value = '';
    document.getElementById('sm_statusFilter').value = 'active';
    document.getElementById('sm_withoutPhotoFilter').checked = false;
    fetchAndRenderStudents({ query: '', grade: '', className: '', status: 'active', withoutPhoto: false });
}

function refreshCurrentList() {
    if (lastSearchParams) fetchAndRenderStudents(lastSearchParams);
}

// YENİ: Öğrenci İşlemleri sayfasının üstündeki "fotoğraf durumu" özet satırı — sadece
// yönetici erişebiliyor (getStudentPhotoStats admin-only), ikincil bilgi olduğu için
// yüklenemezse/erişim yoksa kullanıcıya hata göstermez, sessizce gizlenir.
async function refreshPhotoCounter() {
    const line = document.getElementById('sm_photoCounterLine');
    if (!line) return;

    try {
        const res = await fetch('/api/getStudentPhotoStats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getAuthPayload())
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.status !== 'success' || !r.data || !r.data.total) {
            line.classList.add('hidden');
            return;
        }

        const { total, withPhoto } = r.data;
        const missing = total - withPhoto;
        line.textContent = missing > 0
            ? `Fotoğraf durumu: ${withPhoto} / ${total} öğrencide var (${missing} eksik)`
            : `Tüm öğrencilerin fotoğrafı var (${total} / ${total})`;
        line.classList.remove('hidden');
    } catch (e) {
        line.classList.add('hidden');
    }
}

async function fetchAndRenderStudents(params) {
    lastSearchParams = params;
    try {
        const res = await fetch('/api/listStudents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthPayload(), ...params })
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();
        if (r.status !== 'success') {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'İşlem başarısız oldu.' });
            return;
        }
        renderResults(r.data || [], !!r.limitReached);
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

function renderResults(students, limitReached) {
    currentStudentsById = new Map(students.map(s => [String(s.id), s]));

    document.getElementById('sm_resultsCard').classList.remove('hidden');
    const countText = students.length > 0 ? `${students.length} kayıt bulundu` : '0 kayıt';
    document.getElementById('sm_resultsCount').textContent = limitReached
        ? `${countText} — İlk 500 kayıt gösteriliyor, filtreleri daraltın.`
        : countText;
    document.getElementById('sm_selectAll').checked = false;

    const tbody = document.getElementById('sm_resultsBody');

    if (students.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Öğrenci bulunamadı.</td></tr>`;
        updateBulkTransferButtonState();
        return;
    }

    tbody.innerHTML = students.map(s => `
        <tr>
            <td><input type="checkbox" class="sm_rowCheckbox" value="${s.id}" onchange="updateBulkTransferButtonState()"></td>
            <td class="student-no-cell">${escapeHtmlText(s.student_no)}</td>
            <td>${escapeHtmlText(s.full_name)}</td>
            <td>${escapeHtmlText(s.grade ?? '-')} / ${escapeHtmlText(s.class_name || '-')}</td>
            <td class="row-actions">
                <button type="button" class="btn btn-outline btn-sm" onclick="openPhotoModal('${s.id}')">${s.has_photo ? '🖼️ Fotoğraf' : '📷 Fotoğraf Ekle'}</button>
                <button type="button" class="btn btn-outline btn-sm" onclick="openStudentModal('edit', '${s.id}')">✏️ Düzenle</button>
                ${s.is_active
            ? `<button type="button" class="btn btn-warning btn-sm" onclick="archiveStudentAction('${s.id}')">📦 Arşivle</button>
                       <button type="button" class="btn btn-danger btn-sm" onclick="deleteStudentAction('${s.id}')">🗑️ Sil</button>`
            : `<button type="button" class="btn btn-success btn-sm" onclick="restoreStudentAction('${s.id}')">♻️ Geri Al</button>`
        }
            </td>
        </tr>
    `).join('');

    updateBulkTransferButtonState();
}

function toggleSelectAll() {
    const checked = document.getElementById('sm_selectAll').checked;
    document.querySelectorAll('.sm_rowCheckbox').forEach(cb => { cb.checked = checked; });
    updateBulkTransferButtonState();
}

function getSelectedStudentIds() {
    return Array.from(document.querySelectorAll('.sm_rowCheckbox:checked')).map(cb => cb.value);
}

function updateBulkTransferButtonState() {
    const btn = document.getElementById('sm_bulkTransferBtn');
    const hasResults = currentStudentsById.size > 0;
    const anySelected = getSelectedStudentIds().length > 0;
    btn.classList.toggle('hidden', !hasResults);
    btn.disabled = !anySelected;
}

// --- Toplu Aktarma ---
function openBulkTransferModal() {
    document.getElementById('sm_bulkGrade').value = '';
    document.getElementById('sm_bulkClass').value = '';
    document.getElementById('sm_bulkTransferModal').classList.remove('hidden');
}

function closeBulkTransferModal() {
    document.getElementById('sm_bulkTransferModal').classList.add('hidden');
}

function handleBulkClassChange() {
    const select = document.getElementById('sm_bulkClass');
    if (select.value !== '__new__') return;

    const newName = prompt('Lütfen yeni şube adını giriniz (Örn: A, B, C):');
    if (!newName || !newName.trim()) {
        select.value = '';
        return;
    }

    const upper = newName.trim().toUpperCase();
    const existingOption = Array.from(select.options).find(o => o.value === upper);
    if (!existingOption) {
        const opt = document.createElement('option');
        opt.value = upper;
        opt.textContent = upper;
        select.insertBefore(opt, select.querySelector('option[value="__new__"]'));
    }
    select.value = upper;
}

async function submitBulkTransfer() {
    const grade = document.getElementById('sm_bulkGrade').value;
    const className = document.getElementById('sm_bulkClass').value;
    const ids = getSelectedStudentIds();

    if (ids.length === 0) {
        Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Aktarılacak öğrenci bulunamadı.' });
        return;
    }
    if (!grade || !className || className === '__new__') {
        Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Lütfen Kademe ve Şube giriniz!' });
        return;
    }

    Swal.fire({ title: 'Aktarılıyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/bulkTransferStudents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthPayload(), studentIds: ids, grade, className })
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Başarılı', text: r.message });
            closeBulkTransferModal();
            refreshCurrentList();
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'İşlem başarısız oldu.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

// --- Öğrenci Ekle / Düzenle ---
function openStudentModal(mode, studentId) {
    document.getElementById('sm_studentModalTitle').textContent = mode === 'edit' ? 'Öğrenci Düzenle' : 'Yeni Öğrenci Ekle';
    document.getElementById('sm_editOldNo').value = '';
    document.getElementById('sm_formNo').value = '';
    document.getElementById('sm_formName').value = '';
    document.getElementById('sm_formGrade').value = '';
    document.getElementById('sm_formClass').value = '';

    if (mode === 'edit') {
        const s = currentStudentsById.get(String(studentId));
        if (!s) return;
        document.getElementById('sm_editOldNo').value = s.student_no;
        document.getElementById('sm_formNo').value = s.student_no;
        document.getElementById('sm_formName').value = s.full_name;
        document.getElementById('sm_formGrade').value = s.grade || '';
        document.getElementById('sm_formClass').value = s.class_name || '';
    }

    document.getElementById('sm_studentModal').classList.remove('hidden');
}

function closeStudentModal() {
    document.getElementById('sm_studentModal').classList.add('hidden');
}

async function saveStudentFromModal() {
    const no = document.getElementById('sm_formNo').value.trim();
    const name = document.getElementById('sm_formName').value.trim();
    const grade = document.getElementById('sm_formGrade').value;
    const className = document.getElementById('sm_formClass').value.trim();
    const oldNo = document.getElementById('sm_editOldNo').value;
    const isEdit = !!oldNo;

    if (!no || !name || !className) {
        Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Öğrenci No, Ad Soyad ve Sınıf zorunludur.' });
        return;
    }

    Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading() });
    try {
        const endpoint = isEdit ? '/api/updateStudentDetailed' : '/api/addStudent';
        const body = isEdit
            ? { ...getAuthPayload(), oldNo, newNo: no, newName: name, newGrade: grade, newClass: className }
            : { ...getAuthPayload(), no, name, grade, className };

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Başarılı', text: isEdit ? 'Öğrenci bilgileri başarıyla güncellendi.' : 'Yeni öğrenci sisteme eklendi.' });
            closeStudentModal();
            refreshCurrentList();
            refreshPhotoCounter();
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'İşlem başarısız oldu.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

// --- Arşivle / Geri Al / Sil ---
async function archiveStudentAction(id) {
    const s = currentStudentsById.get(String(id));
    if (!s) return;

    const confirmResult = await Swal.fire({
        title: 'Öğrenciyi Arşivle',
        text: `${s.full_name} (${s.student_no}) öğrencisini arşivlemek istediğinize emin misiniz? Bu öğrenci artık aktif listede görünmeyecek.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Arşivle',
        cancelButtonText: 'İptal',
        confirmButtonColor: '#ef4444'
    });
    if (!confirmResult.isConfirmed) return;

    Swal.fire({ title: 'Arşivleniyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/archiveStudent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthPayload(), id })
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Başarılı', text: r.message });
            refreshCurrentList();
            refreshPhotoCounter();
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'İşlem başarısız oldu.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

async function restoreStudentAction(id) {
    const s = currentStudentsById.get(String(id));
    if (!s) return;

    // Adım 1: Kademe seçimi (aynı okul-türü kademe listesi, sm_formGrade ile aynı kaynak)
    const gradeInputOptions = {};
    document.querySelectorAll('#sm_formGrade option').forEach(opt => {
        if (opt.value) gradeInputOptions[opt.value] = opt.textContent;
    });

    const step1 = await Swal.fire({
        title: 'Öğrenciyi Geri Al',
        text: `${s.full_name} (${s.student_no}) için kademe seçin.`,
        input: 'select',
        inputOptions: gradeInputOptions,
        inputPlaceholder: '-- Kademe --',
        showCancelButton: true,
        confirmButtonText: 'Devam Et',
        cancelButtonText: 'İptal',
        inputValidator: (value) => {
            if (!value) return 'Lütfen bir kademe seçin.';
        }
    });
    if (!step1.isConfirmed || !step1.value) return;
    const selectedGrade = step1.value;

    // Adım 2: Onay
    const step2 = await Swal.fire({
        title: 'Geri alma onayı',
        text: `${s.full_name} öğrencisi aktif listeye geri alınacak. Devam edilsin mi?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Geri Al',
        cancelButtonText: 'İptal'
    });
    if (!step2.isConfirmed) return;

    Swal.fire({ title: 'Geri alınıyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/restoreStudent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthPayload(), id, grade: selectedGrade })
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Başarılı', text: r.message });
            refreshCurrentList();
            refreshPhotoCounter();
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'İşlem başarısız oldu.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

async function deleteStudentAction(id) {
    const s = currentStudentsById.get(String(id));
    if (!s) return;

    const confirmed = window.confirm(`DİKKAT! '${s.full_name}' isimli öğrenciyi silmek istediğinize emin misiniz? (Öğrenciye ait ödünç/emanet verileri de silinebilir!)`);
    if (!confirmed) return;

    Swal.fire({ title: 'Siliniyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/deleteStudent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthPayload(), id })
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Başarılı', text: r.message });
            refreshCurrentList();
            refreshPhotoCounter();
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'İşlem başarısız oldu.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

// --- Toplu İçe Aktarma (Şablon / Excel) ---
function openBulkImportModal() {
    document.getElementById('sm_bulkImportModal').classList.remove('hidden');
}

function closeBulkImportModal() {
    document.getElementById('sm_bulkImportModal').classList.add('hidden');
}

function downloadStudentTemplate() {
    if (typeof XLSX === 'undefined') {
        Swal.fire('Hata', 'Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyiniz.', 'error');
        return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["Öğrenci No", "Ad Soyad", "Kademe", "Şube"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Şablon");
    XLSX.writeFile(wb, "Ogrenci_Sablonu.xlsx");
}

function buildImportSummaryHtml(result) {
    const insertedCount = Number(result.insertedCount || 0);
    const updatedCount = Number(result.updatedCount || 0);
    const duplicateCount = Number(result.duplicateCount || 0);
    const nameMismatchCount = Number(result.nameMismatchCount || 0);
    const updated = Array.isArray(result.updated) ? result.updated : [];
    const duplicates = Array.isArray(result.duplicates) ? result.duplicates : [];
    const nameMismatches = Array.isArray(result.nameMismatches) ? result.nameMismatches : [];

    const lines = [`<div><b>${insertedCount}</b> yeni öğrenci eklendi.</div>`];

    if (updatedCount > 0) {
        const list = updated.map(item => `<div style="margin-top:4px;">• ${escapeHtmlText(item.full_name || item.student_no)} (${escapeHtmlText(item.student_no)})</div>`).join('');
        lines.push(`
            <div style="margin-top:10px;"><b>${updatedCount}</b> öğrencinin sınıfı güncellendi.</div>
            <div style="margin-top:4px; max-height:120px; overflow-y:auto;">${list}</div>
        `);
    }

    if (duplicateCount > 0) {
        const list = duplicates.map(item => `<div style="margin-top:4px;">• ${escapeHtmlText(item.full_name || item.student_no)} (${escapeHtmlText(item.student_no)})</div>`).join('');
        lines.push(`
            <div style="margin-top:10px;"><b>${duplicateCount}</b> öğrenci mükerrer olduğu için atlandı.</div>
            <div style="margin-top:4px; max-height:120px; overflow-y:auto;">${list}</div>
        `);
    }

    if (nameMismatchCount > 0) {
        const list = nameMismatches.map(item => `<div style="margin-top:4px;">• No: ${escapeHtmlText(item.student_no)} — Sistemde: "${escapeHtmlText(item.existing_name)}", Dosyada: "${escapeHtmlText(item.file_name)}"</div>`).join('');
        lines.push(`
            <div style="margin-top:10px; color:#b91c1c;"><b>${nameMismatchCount}</b> öğrenci isim uyuşmazlığı nedeniyle atlandı.</div>
            <div style="margin-top:4px; max-height:120px; overflow-y:auto;">${list}</div>
        `);
    }

    return `<div style="text-align:left;">${lines.join('')}</div>`;
}

async function submitStudentBulkData(mappedData, updateExistingClass) {
    if (mappedData.length === 0) {
        Swal.fire('Hata', 'Geçerli veri bulunamadı.', 'error');
        return;
    }

    Swal.fire({ title: 'Yükleniyor...', html: '<b>' + mappedData.length + '</b> kayıt işleniyor...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

    try {
        const res = await fetch('/api/students/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthPayload(), data: mappedData, updateExistingClass })
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.status === 'success') {
            Swal.fire({ icon: 'success', title: 'İçe Aktarım Tamamlandı', html: buildImportSummaryHtml(r), confirmButtonText: 'Tamam' });
            refreshCurrentList();
            refreshPhotoCounter();
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'Yükleme başarısız oldu.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

function handleBulkImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        Swal.fire('Hata', 'Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyiniz.', 'error');
        event.target.value = '';
        return;
    }

    const updateExistingClass = !!document.getElementById('sm_bulkImportUpdateClass')?.checked;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
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

            closeBulkImportModal();
            await submitStudentBulkData(mappedData, updateExistingClass);
        } catch (error) {
            Swal.fire('Hata', 'Dosya okunurken bir hata oluştu.', 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- E-Okul Excel Yükle ---
function openEokulImportModal() {
    document.getElementById('sm_eokulImportModal').classList.remove('hidden');
}

function closeEokulImportModal() {
    document.getElementById('sm_eokulImportModal').classList.add('hidden');
}

function triggerEokulFileSelect() {
    const grade = document.getElementById('sm_eokulGrade').value;
    const className = document.getElementById('sm_eokulClass').value.trim();

    if (!grade || !className) {
        Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Lütfen önce Kademe ve Şube seçin.' });
        return;
    }

    const fileInput = document.getElementById('sm_eokulImportFile');
    fileInput.value = '';
    fileInput.click();
}

function parseEokulRows(rows, grade, className) {
    if (!Array.isArray(rows) || rows.length < 2) return [];

    const mappedData = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const studentNo = String(row[1] ?? '').trim();
        const namePart = String(row[4] ?? '').trim();
        const surnamePart = String(row[9] ?? '').trim();

        if (!studentNo) continue;

        const fullName = [namePart, surnamePart].filter(Boolean).join(' ');
        if (!fullName) continue;

        mappedData.push({ student_no: studentNo, full_name: fullName, grade, class_name: className });
    }

    return mappedData;
}

function handleEokulImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const grade = document.getElementById('sm_eokulGrade').value;
    const className = document.getElementById('sm_eokulClass').value.trim();
    const updateExistingClass = !!document.getElementById('sm_eokulUpdateClass')?.checked;

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
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, blankrows: false });

            if (!rows || rows.length < 2) {
                Swal.fire('Hata', 'Excel dosyası boş veya formatı hatalı.', 'error');
                return;
            }

            const mappedData = parseEokulRows(rows, grade, className);

            if (mappedData.length === 0) {
                Swal.fire('Hata', 'Dosyada kullanılabilir öğrenci verisi bulunamadı. B sütununda öğrenci no, E sütununda ad, J sütununda soyad olmalıdır.', 'error');
                return;
            }

            closeEokulImportModal();
            await submitStudentBulkData(mappedData, updateExistingClass);
        } catch (error) {
            Swal.fire({ icon: 'error', title: 'Hata', text: 'Excel dosyası okunurken bir hata oluştu.' });
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- Öğrenci Fotoğrafı ---
let pendingPhotoBlob = null;
let photoModalStudentId = null;
let cropperInstance = null;
let cropSourceObjectUrl = null;

function resetPhotoFileInputs() {
    const captureInput = document.getElementById('sm_photoCaptureInput');
    const fileInput = document.getElementById('sm_photoFileInput');
    if (captureInput) captureInput.value = '';
    if (fileInput) fileInput.value = '';
}

function destroyCropper() {
    if (cropperInstance) {
        cropperInstance.destroy();
        cropperInstance = null;
    }
}

function revokeCropSourceUrl() {
    if (cropSourceObjectUrl) {
        URL.revokeObjectURL(cropSourceObjectUrl);
        cropSourceObjectUrl = null;
    }
}

// Kırpma adımından önizleme adımına (veya başlangıç durumuna) döner.
function resetToPhotoPreviewStep() {
    document.getElementById('sm_photoCropStep').classList.add('hidden');
    document.getElementById('sm_photoPreviewStep').classList.remove('hidden');
    document.getElementById('sm_photoDeleteBtn').classList.remove('hidden');
    document.getElementById('sm_photoCloseBtn').classList.remove('hidden');
    document.getElementById('sm_photoSaveBtn').classList.remove('hidden');
    document.getElementById('sm_photoCropCancelBtn').classList.add('hidden');
    document.getElementById('sm_photoCropUseBtn').classList.add('hidden');
}

function openPhotoModal(studentId) {
    const s = currentStudentsById.get(String(studentId));
    if (!s) return;

    photoModalStudentId = studentId;
    pendingPhotoBlob = null;

    document.getElementById('sm_photoModalTitle').textContent = `Öğrenci Fotoğrafı — ${s.full_name}`;
    resetPhotoFileInputs();
    document.getElementById('sm_photoSaveBtn').disabled = true;
    document.getElementById('sm_photoDeleteBtn').disabled = !s.has_photo;

    destroyCropper();
    revokeCropSourceUrl();
    resetToPhotoPreviewStep();

    const img = document.getElementById('sm_photoPreviewImg');
    const placeholder = document.getElementById('sm_photoPlaceholder');
    img.classList.add('hidden');
    img.src = '';
    placeholder.classList.remove('hidden');
    placeholder.textContent = s.has_photo ? 'Yükleniyor...' : 'Fotoğraf yok';

    document.getElementById('sm_photoModal').classList.remove('hidden');

    if (s.has_photo) loadCurrentPhoto(studentId);
}

async function loadCurrentPhoto(studentId) {
    try {
        const res = await fetch('/api/getStudentPhotoUrl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthPayload(), studentId })
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();
        const placeholder = document.getElementById('sm_photoPlaceholder');
        const img = document.getElementById('sm_photoPreviewImg');

        if (r.status === 'success' && r.url) {
            img.src = r.url;
            img.classList.remove('hidden');
            placeholder.classList.add('hidden');
        } else {
            placeholder.textContent = 'Fotoğraf yok';
            placeholder.classList.remove('hidden');
            img.classList.add('hidden');
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Fotoğraf yüklenemedi.' });
    }
}

function closePhotoModal() {
    destroyCropper();
    revokeCropSourceUrl();
    document.getElementById('sm_photoModal').classList.add('hidden');
    pendingPhotoBlob = null;
    photoModalStudentId = null;
}

function handlePhotoFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        Swal.fire({ icon: 'warning', title: 'Geçersiz Dosya', text: 'Lütfen bir resim dosyası seçin.' });
        event.target.value = '';
        return;
    }

    prepareImageForCropping(file)
        .then(blobUrl => openCropStep(blobUrl))
        .catch(() => {
            Swal.fire({ icon: 'error', title: 'Hata', text: 'Fotoğraf okunamadı. Dosya bozuk olabilir veya desteklenmeyen bir format olabilir.' });
        })
        .finally(() => {
            event.target.value = '';
        });
}

// Seçilen dosyayı EXIF yönünü düzelterek (createImageBitmap, imageOrientation:'from-image')
// decode eder, en uzun kenarı en fazla 2000px olacak şekilde oranı koruyarak küçültür ve
// kırpma ekranına verilecek EXIF'siz, yüksek kaliteli bir ara JPEG Blob URL'i döner.
// Çıktının EXIF taşımaması önemli: Cropper.js'in kendi EXIF düzeltmesini (checkOrientation)
// kapattık, bu adımdaki decode TEK düzeltme noktası olmalı (çift döndürme riskini önler).
const CROP_SOURCE_MAX_DIM = 2000;
const CROP_SOURCE_QUALITY = 0.92;

async function prepareImageForCropping(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (err) {
        throw new Error('Görüntü çözülemedi.');
    }

    try {
        const srcW = bitmap.width, srcH = bitmap.height;
        const scale = Math.min(CROP_SOURCE_MAX_DIM / srcW, CROP_SOURCE_MAX_DIM / srcH, 1);
        const drawW = Math.round(srcW * scale);
        const drawH = Math.round(srcH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = drawW;
        canvas.height = drawH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, drawW, drawH);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => { if (b) resolve(b); else reject(new Error('toBlob başarısız')); }, 'image/jpeg', CROP_SOURCE_QUALITY);
        });

        return URL.createObjectURL(blob);
    } finally {
        bitmap.close();
    }
}

function openCropStep(blobUrl) {
    revokeCropSourceUrl();
    cropSourceObjectUrl = blobUrl;

    document.getElementById('sm_photoPreviewStep').classList.add('hidden');
    document.getElementById('sm_photoCropStep').classList.remove('hidden');
    document.getElementById('sm_photoDeleteBtn').classList.add('hidden');
    document.getElementById('sm_photoCloseBtn').classList.add('hidden');
    document.getElementById('sm_photoSaveBtn').classList.add('hidden');
    document.getElementById('sm_photoCropCancelBtn').classList.remove('hidden');
    document.getElementById('sm_photoCropUseBtn').classList.remove('hidden');

    const cropImg = document.getElementById('sm_photoCropImg');
    destroyCropper();

    cropImg.onload = () => {
        cropperInstance = new Cropper(cropImg, {
            aspectRatio: 3 / 4,
            viewMode: 1,
            autoCropArea: 0.9,
            // EXIF düzeltmesi prepareImageForCropping'de (createImageBitmap ile) zaten
            // yapıldı ve kaynak bir canvas çıktısı olduğu için EXIF etiketi taşımıyor.
            // Cropper'ın kendi EXIF okuyup bir de kendisinin döndürmesine izin verirsek
            // çift döndürme hatasına (bu projede daha önce yaşandı) geri döneriz.
            checkOrientation: false
        });
    };
    cropImg.src = blobUrl;
}

function cancelCropStep() {
    destroyCropper();
    revokeCropSourceUrl();
    resetToPhotoPreviewStep();
    resetPhotoFileInputs();
}

function confirmCropStep() {
    if (!cropperInstance) return;

    const canvas = cropperInstance.getCroppedCanvas({
        width: 300,
        height: 400,
        fillColor: '#fff',
        imageSmoothingQuality: 'high'
    });

    if (!canvas) {
        Swal.fire({ icon: 'error', title: 'Hata', text: 'Fotoğraf kırpılamadı.' });
        return;
    }

    canvas.toBlob(blob => {
        if (!blob) {
            Swal.fire({ icon: 'error', title: 'Hata', text: 'Fotoğraf işlenemedi.' });
            return;
        }

        pendingPhotoBlob = blob;
        const previewUrl = URL.createObjectURL(blob);
        const previewImg = document.getElementById('sm_photoPreviewImg');
        previewImg.src = previewUrl;
        previewImg.classList.remove('hidden');
        document.getElementById('sm_photoPlaceholder').classList.add('hidden');
        document.getElementById('sm_photoSaveBtn').disabled = false;

        destroyCropper();
        revokeCropSourceUrl();
        resetToPhotoPreviewStep();
        resetPhotoFileInputs();
    }, 'image/jpeg', 0.85);
}

// Bağımsız yardımcı (UI'ye bağımlı değil, toplu zip fazında da aynen kullanılabilir):
// bir File/Blob alır, EXIF yönünü tarayıcının native decode'una uygulatarak (çift
// döndürme riski olmadan) oranı koruyup en fazla maxW x maxH kutusuna sığdırır
// (kırpma yok), JPEG Blob olarak döner.
async function resizeImageToJpegBlob(fileOrBlob, maxW, maxH, quality) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' });
    } catch (err) {
        throw new Error('Görüntü çözülemedi.');
    }

    try {
        const srcW = bitmap.width, srcH = bitmap.height; // EXIF düzeltilmiş boyutlar
        const scale = Math.min(maxW / srcW, maxH / srcH, 1);
        const drawW = Math.round(srcW * scale);
        const drawH = Math.round(srcH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = drawW;
        canvas.height = drawH;
        const ctx = canvas.getContext('2d');
        // Şeffaf PNG/WebP, alfa kanalı olmayan JPEG'e dönüşürken siyah çıkmasın.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, drawW, drawH);

        return await new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob); else reject(new Error('toBlob başarısız'));
            }, 'image/jpeg', quality);
        });
    } finally {
        bitmap.close();
    }
}

async function saveStudentPhoto() {
    if (!pendingPhotoBlob || !photoModalStudentId) return;

    Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    try {
        const res = await fetch('/api/uploadStudentPhoto', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                ...(typeof ktAuthHeaderFields === 'function' ? ktAuthHeaderFields() : { 'x-school-code': localStorage.getItem('kutuphane_code') }),
                'x-student-id': photoModalStudentId
            },
            body: pendingPhotoBlob
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.success) {
            Swal.fire({ icon: 'success', title: 'Başarılı', text: 'Fotoğraf kaydedildi.' });
            closePhotoModal();
            refreshCurrentList();
            refreshPhotoCounter();
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'Fotoğraf yüklenemedi.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

async function deletePhotoAction() {
    if (!photoModalStudentId) return;

    const confirmResult = await Swal.fire({
        title: 'Fotoğrafı Sil',
        text: 'Bu öğrencinin fotoğrafını silmek istediğinize emin misiniz?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sil',
        cancelButtonText: 'İptal',
        confirmButtonColor: '#ef4444'
    });
    if (!confirmResult.isConfirmed) return;

    Swal.fire({ title: 'Siliniyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/deleteStudentPhoto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthPayload(), studentId: photoModalStudentId })
        });
        if (res.status === 401) { redirectToLogin(); return; }
        const r = await res.json();

        if (r.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Başarılı', text: r.message });
            closePhotoModal();
            refreshCurrentList();
            refreshPhotoCounter();
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'İşlem başarısız oldu.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

// --- Toplu Fotoğraf Yükleme (Zip) ---
const BULK_PHOTO_MAX_WARN_BYTES = 500 * 1024 * 1024;
const BULK_PHOTO_ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const BULK_PHOTO_CONCURRENCY = 4;

let bulkPhotoCancelled = false;
let bulkPhotoRunning = false;

function openBulkPhotoModal() {
    document.getElementById('sm_bulkPhotoZipInput').value = '';
    document.getElementById('sm_bulkPhotoIntro').classList.remove('hidden');
    document.getElementById('sm_bulkPhotoProgress').classList.add('hidden');
    document.getElementById('sm_bulkPhotoReport').classList.add('hidden');
    document.getElementById('sm_bulkPhotoCancelBtn').classList.add('hidden');
    document.getElementById('sm_bulkPhotoModal').classList.remove('hidden');
}

function closeBulkPhotoModal() {
    if (bulkPhotoRunning) {
        Swal.fire({ icon: 'warning', title: 'Devam Ediyor', text: 'Yükleme sürüyor, önce İptal edin.' });
        return;
    }
    document.getElementById('sm_bulkPhotoModal').classList.add('hidden');
}

// Zip içindeki her dosya yolunu (klasör dahil) inceler; sistem dosyalarını/klasörlerini ve
// desteklenmeyen uzantıları sayarak eler, kalanları öğrenci no -> [dosya] olarak gruplar.
// İçerik bu adımda ÇÖZÜLMEZ (lazy) — sadece dosya adları üzerinden filtreleme yapılır.
function buildBulkPhotoFileLists(zip) {
    const candidatesByNo = new Map();
    let ignoredSystemCount = 0;
    let unsupportedCount = 0;

    Object.keys(zip.files).forEach(path => {
        const entry = zip.files[path];
        if (entry.dir) return;

        if (/(^|\/)__MACOSX(\/|$)/i.test(path) || /(^|\/)\.DS_Store$/i.test(path) || /(^|\/)Thumbs\.db$/i.test(path)) {
            ignoredSystemCount++;
            return;
        }

        const baseName = path.split('/').pop();
        const dotIndex = baseName.lastIndexOf('.');
        if (dotIndex <= 0) { unsupportedCount++; return; }

        const ext = baseName.slice(dotIndex + 1).toLowerCase();
        if (!BULK_PHOTO_ALLOWED_EXT.includes(ext)) { unsupportedCount++; return; }

        const studentNo = baseName.slice(0, dotIndex).trim();
        if (!studentNo) { unsupportedCount++; return; }

        if (!candidatesByNo.has(studentNo)) candidatesByNo.set(studentNo, []);
        candidatesByNo.get(studentNo).push({ entry, path });
    });

    let candidateCount = 0;
    candidatesByNo.forEach(files => { candidateCount += files.length; });

    return { candidatesByNo, ignoredSystemCount, unsupportedCount, candidateCount };
}

async function fetchActiveRoster() {
    try {
        const res = await fetch('/api/getActiveStudentRoster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getAuthPayload())
        });
        if (res.status === 401) { redirectToLogin(); return null; }
        const r = await res.json();
        if (r.status !== 'success') {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'Öğrenci listesi alınamadı.' });
            return null;
        }
        return r.data || [];
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Öğrenci listesi alınamadı.' });
        return null;
    }
}

// Dosya adından çıkarılan numaraları okulun aktif öğrencileriyle (roster) eşleştirir.
// Numara karşılaştırması string olarak yapılır (parseInt/Number KULLANILMAZ) ki baştaki
// sıfırlar korunsun. Aynı numaraya ait birden fazla dosya varsa ikisi de atlanır.
function computeBulkPhotoSummary(plan, roster) {
    const rosterByNo = new Map(roster.map(s => [String(s.student_no).trim(), s]));

    const matched = [];
    const duplicates = [];
    const unmatched = [];

    plan.candidatesByNo.forEach((files, studentNo) => {
        if (files.length > 1) {
            duplicates.push({ studentNo, fileNames: files.map(f => f.path) });
            return;
        }

        const student = rosterByNo.get(studentNo);
        if (!student) {
            unmatched.push(files[0].path);
            return;
        }

        matched.push({
            studentNo,
            studentId: student.id,
            fullName: student.full_name,
            hadPhoto: !!student.has_photo,
            entry: files[0].entry,
            fileName: files[0].path
        });
    });

    const willOverwriteCount = matched.filter(m => m.hadPhoto).length;

    return {
        roster,
        matched,
        duplicates,
        unmatched,
        ignoredSystemCount: plan.ignoredSystemCount,
        unsupportedCount: plan.unsupportedCount,
        willOverwriteCount
    };
}

async function handleBulkPhotoZipSelect(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    if (typeof JSZip === 'undefined') {
        Swal.fire({ icon: 'error', title: 'Hata', text: 'Zip kütüphanesi yüklenemedi. Lütfen sayfayı yenileyiniz.' });
        return;
    }

    if (file.size > BULK_PHOTO_MAX_WARN_BYTES) {
        const warn = await Swal.fire({
            icon: 'warning',
            title: 'Büyük Dosya',
            text: 'Seçilen zip dosyası 500 MB\'tan büyük. Tarayıcı yavaşlayabilir. Devam edilsin mi?',
            showCancelButton: true,
            confirmButtonText: 'Devam Et',
            cancelButtonText: 'Vazgeç'
        });
        if (!warn.isConfirmed) return;
    }

    Swal.fire({ title: 'Zip inceleniyor...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    try {
        const zip = await JSZip.loadAsync(file);
        const plan = buildBulkPhotoFileLists(zip);

        if (plan.candidateCount === 0) {
            Swal.close();
            Swal.fire({ icon: 'warning', title: 'Dosya Bulunamadı', text: 'Zip içinde desteklenen bir fotoğraf bulunamadı.' });
            return;
        }

        const roster = await fetchActiveRoster();
        Swal.close();
        if (roster === null) return; // fetchActiveRoster zaten hata gösterdi

        const summary = computeBulkPhotoSummary(plan, roster);
        await confirmAndRunBulkPhotoUpload(summary);
    } catch (e) {
        Swal.close();
        Swal.fire({ icon: 'error', title: 'Hata', text: 'Zip dosyası okunamadı veya bozuk.' });
    }
}

async function confirmAndRunBulkPhotoUpload(summary) {
    const totalFound = summary.matched.length + summary.duplicates.length + summary.unmatched.length;
    const ignoredTotal = summary.ignoredSystemCount + summary.unsupportedCount;

    const confirmResult = await Swal.fire({
        icon: 'question',
        title: 'Toplu Fotoğraf Yükleme',
        html: `
            <div style="text-align:left; font-size:0.9rem;">
                <div><b>${totalFound}</b> fotoğraf dosyası bulundu.</div>
                <div style="margin-top:6px;"><b>${summary.matched.length}</b> tanesi bir öğrenciyle eşleşti.</div>
                <div style="margin-top:6px; color:#b45309;"><b>${summary.willOverwriteCount}</b> tanesinin zaten fotoğrafı var ve üzerine yazılacak.</div>
                ${summary.duplicates.length > 0 ? `<div style="margin-top:6px; color:#b91c1c;"><b>${summary.duplicates.length}</b> numara mükerrer dosyaya sahip, atlanacak.</div>` : ''}
                ${summary.unmatched.length > 0 ? `<div style="margin-top:6px; color:#b91c1c;"><b>${summary.unmatched.length}</b> dosya adı hiçbir öğrenciyle eşleşmedi, atlanacak.</div>` : ''}
                ${ignoredTotal > 0 ? `<div style="margin-top:6px; color:var(--muted);"><b>${ignoredTotal}</b> sistem/desteklenmeyen dosya yok sayıldı.</div>` : ''}
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Yüklemeye Başla',
        cancelButtonText: 'Vazgeç',
        confirmButtonColor: '#10b981'
    });

    if (!confirmResult.isConfirmed) return;

    if (summary.matched.length === 0) {
        Swal.fire({ icon: 'info', title: 'Yüklenecek Fotoğraf Yok', text: 'Eşleşen fotoğraf bulunamadığı için işlem yapılmadı.' });
        return;
    }

    await runBulkPhotoUpload(summary);
}

// Tek bir dosyayı yükler; 429/5xx/ağ hatasında kısa bir bekleme sonrası 1 kez yeniden dener.
async function uploadStudentPhotoWithRetry(studentId, blob) {
    const attempt = async () => {
        let res;
        try {
            res = await fetch('/api/uploadStudentPhoto', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    ...(typeof ktAuthHeaderFields === 'function' ? ktAuthHeaderFields() : { 'x-school-code': localStorage.getItem('kutuphane_code') }),
                    'x-student-id': studentId
                },
                body: blob
            });
        } catch (networkErr) {
            throw Object.assign(new Error('Ağ hatası.'), { retryable: true });
        }

        if (res.status === 401) { redirectToLogin(); throw new Error('Yetkisiz.'); }
        if (res.status === 429 || res.status >= 500) {
            throw Object.assign(new Error('Sunucu geçici olarak yanıt vermedi.'), { retryable: true });
        }

        const r = await res.json();
        if (!r.success) throw new Error(r.message || 'Yükleme başarısız.');
        return r;
    };

    try {
        return await attempt();
    } catch (err) {
        if (err.retryable) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return await attempt(); // ikinci deneme de başarısız olursa hata yukarı fırlar
        }
        throw err;
    }
}

// En fazla BULK_PHOTO_CONCURRENCY paralel işçi ile eşleşen dosyaları sırayla işler:
// zip girdisini tek tek (lazy) çözer, yeniden boyutlandırır, yükler. İptal edilirse
// kuyruğa yeni dosya alınmaz, o an işlemde olanlar tamamlanır.
async function runBulkPhotoUpload(summary) {
    bulkPhotoCancelled = false;
    bulkPhotoRunning = true;

    document.getElementById('sm_bulkPhotoIntro').classList.add('hidden');
    document.getElementById('sm_bulkPhotoReport').classList.add('hidden');
    document.getElementById('sm_bulkPhotoProgress').classList.remove('hidden');
    document.getElementById('sm_bulkPhotoCancelBtn').classList.remove('hidden');

    const total = summary.matched.length;
    const errors = [];
    let doneCount = 0;
    let uploadedCount = 0;
    let overwrittenCount = 0;

    const updateProgress = () => {
        const pct = total === 0 ? 100 : Math.round((doneCount / total) * 100);
        document.getElementById('sm_bulkPhotoProgressBar').style.width = pct + '%';
        document.getElementById('sm_bulkPhotoProgressLabel').textContent = bulkPhotoCancelled ? 'İptal ediliyor, mevcut dosyalar tamamlanıyor...' : 'Yükleniyor...';
        document.getElementById('sm_bulkPhotoProgressCount').textContent = `${doneCount} / ${total}`;
    };
    updateProgress();

    let nextIndex = 0;

    async function worker() {
        while (true) {
            if (bulkPhotoCancelled) return;
            const index = nextIndex;
            if (index >= summary.matched.length) return;
            nextIndex++;

            const item = summary.matched[index];
            try {
                const rawBlob = await item.entry.async('blob');
                const resizedBlob = await resizeImageToJpegBlob(rawBlob, 300, 400, 0.85);
                await uploadStudentPhotoWithRetry(item.studentId, resizedBlob);
                uploadedCount++;
                if (item.hadPhoto) overwrittenCount++;
            } catch (err) {
                errors.push({ fileName: item.fileName, fullName: item.fullName, message: (err && err.message) || 'Bilinmeyen hata' });
            } finally {
                doneCount++;
                updateProgress();
            }
        }
    }

    const workerCount = Math.min(BULK_PHOTO_CONCURRENCY, total);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const cancelledRemaining = total - doneCount;

    bulkPhotoRunning = false;
    document.getElementById('sm_bulkPhotoCancelBtn').classList.add('hidden');

    const freshRoster = await fetchActiveRoster();
    const freshNoPhotoList = freshRoster ? freshRoster.filter(s => !s.has_photo) : null;

    renderBulkPhotoReport({
        uploadedCount,
        overwrittenCount,
        errors,
        duplicates: summary.duplicates,
        unmatched: summary.unmatched,
        cancelledRemaining,
        ignoredSystemCount: summary.ignoredSystemCount,
        unsupportedCount: summary.unsupportedCount,
        freshNoPhotoList
    });
}

function cancelBulkPhotoUpload() {
    bulkPhotoCancelled = true;
    document.getElementById('sm_bulkPhotoProgressLabel').textContent = 'İptal ediliyor, mevcut dosyalar tamamlanıyor...';
}

function renderBulkPhotoReport(r) {
    document.getElementById('sm_bulkPhotoProgress').classList.add('hidden');

    let html = `<div><b>${r.uploadedCount}</b> fotoğraf başarıyla yüklendi (<b>${r.overwrittenCount}</b> tanesinin üzerine yazıldı).</div>`;

    if (r.cancelledRemaining > 0) {
        html += `<div style="margin-top:8px; color:#b45309;">İşlem iptal edildi, <b>${r.cancelledRemaining}</b> dosya denenmeden kaldı.</div>`;
    }

    if (r.unmatched.length > 0) {
        html += `
            <div style="margin-top:8px; color:#b91c1c;"><b>${r.unmatched.length}</b> dosya adı öğrenciyle eşleşmedi:</div>
            <div style="max-height:100px; overflow-y:auto; font-size:0.8rem; margin-top:4px;">${r.unmatched.map(escapeHtmlText).join(', ')}</div>`;
    }

    if (r.duplicates.length > 0) {
        html += `
            <div style="margin-top:8px; color:#b91c1c;"><b>${r.duplicates.length}</b> numara mükerrer dosyaya sahip olduğu için atlandı:</div>
            <div style="max-height:100px; overflow-y:auto; font-size:0.8rem; margin-top:4px;">${r.duplicates.map(d => escapeHtmlText(d.studentNo)).join(', ')}</div>`;
    }

    if (r.errors.length > 0) {
        html += `
            <div style="margin-top:8px; color:#b91c1c;"><b>${r.errors.length}</b> dosya hata verdi:</div>
            <div style="max-height:120px; overflow-y:auto; font-size:0.8rem; margin-top:4px;">${r.errors.map(e => `${escapeHtmlText(e.fileName)} (${escapeHtmlText(e.fullName || '')}): ${escapeHtmlText(e.message)}`).join('<br>')}</div>`;
    }

    const ignoredTotal = r.ignoredSystemCount + r.unsupportedCount;
    if (ignoredTotal > 0) {
        html += `<div style="margin-top:8px; color:var(--muted);"><b>${ignoredTotal}</b> sistem/desteklenmeyen dosya yok sayıldı.</div>`;
    }

    if (r.freshNoPhotoList) {
        html += `
            <details style="margin-top:10px;">
                <summary style="cursor:pointer; font-weight:600;">Hâlâ fotoğrafı olmayan ${r.freshNoPhotoList.length} aktif öğrenci</summary>
                <div style="max-height:160px; overflow-y:auto; font-size:0.8rem; margin-top:6px;">
                    ${r.freshNoPhotoList.map(s => `${escapeHtmlText(s.student_no)} — ${escapeHtmlText(s.full_name)}`).join('<br>')}
                </div>
            </details>`;
    } else {
        html += `<div style="margin-top:8px; color:var(--muted);">Fotoğrafsız öğrenci sayısı hesaplanamadı.</div>`;
    }

    document.getElementById('sm_bulkPhotoReport').innerHTML = html;
    document.getElementById('sm_bulkPhotoReport').classList.remove('hidden');

    refreshCurrentList();
    refreshPhotoCounter();
}
