// Öğrenci İşlemleri (Geniş Ekran) sayfası - bağımsız script.
// index.html'in js/api-client.js ve js/ui.js dosyalarına kasıtlı olarak bağımlı DEĞİL
// (onlar o sayfaya özel DOM id'lerine sıkı bağlı). Kimlik doğrulama deseni aynı:
// localStorage.kutuphane_code / kutuphane_pass her istekte body'ye eklenir.

let currentStudentsById = new Map();
let lastSearchParams = null;

// --- Başlangıç / Kimlik Doğrulama ---
document.addEventListener('DOMContentLoaded', async () => {
    const code = localStorage.getItem('kutuphane_code');
    const pass = localStorage.getItem('kutuphane_pass');
    if (!code || !pass) {
        redirectToLogin();
        return;
    }
    await Promise.all([loadGradeOptions(), loadClassOptions()]);
});

function redirectToLogin() {
    window.location.href = 'index.html';
}

function logoutFromPage() {
    Swal.fire({
        title: 'Çıkış?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Evet',
        cancelButtonText: 'Hayır'
    }).then((res) => {
        if (res.isConfirmed) {
            ['kutuphane_code', 'kutuphane_pass', 'beni_hatirla', 'okul_ismi', 'kutuphane_identity', 'kutuphane_user', 'kutuphane_login_type']
                .forEach(k => localStorage.removeItem(k));
            redirectToLogin();
        }
    });
}

function getAuthPayload() {
    return {
        schoolCode: localStorage.getItem('kutuphane_code'),
        schoolPass: localStorage.getItem('kutuphane_pass')
    };
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
        if (r.status !== 'success') return;

        const grades = (r.data && r.data.grades) || [];
        const labelFor = (g) => (g === 13 ? 'Mezun' : `${g}. Sınıf`);
        const optionsHtml = grades.map(g => `<option value="${g}">${labelFor(g)}</option>`).join('');

        document.getElementById('sm_gradeFilter').innerHTML = `<option value="">-- Kademe --</option>${optionsHtml}`;
        document.getElementById('sm_formGrade').innerHTML = `<option value="">-- Kademe --</option>${optionsHtml}`;
        document.getElementById('sm_bulkGrade').innerHTML = `<option value="">-- Kademe --</option>${optionsHtml}`;
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

    if (text.length < 2 && !className && !grade && status === 'active') {
        Swal.fire({ icon: 'warning', title: 'Eksik Bilgi', text: 'Lütfen aramak için en az 2 karakter girin veya bir filtre seçin.' });
        return;
    }

    fetchAndRenderStudents({ query: text, grade, className, status });
}

function listAllStudents() {
    document.getElementById('sm_searchInput').value = '';
    document.getElementById('sm_gradeFilter').value = '';
    document.getElementById('sm_classFilter').value = '';
    document.getElementById('sm_statusFilter').value = 'active';
    fetchAndRenderStudents({ query: '', grade: '', className: '', status: 'active' });
}

function refreshCurrentList() {
    if (lastSearchParams) fetchAndRenderStudents(lastSearchParams);
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
        renderResults(r.data || []);
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}

function renderResults(students) {
    currentStudentsById = new Map(students.map(s => [String(s.id), s]));

    document.getElementById('sm_resultsCard').classList.remove('hidden');
    document.getElementById('sm_resultsCount').textContent = students.length > 0 ? `${students.length} kayıt bulundu` : '0 kayıt';
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
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: r.message || 'İşlem başarısız oldu.' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuya ulaşılamadı.' });
    }
}
