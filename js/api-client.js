// --- VERİ ÇEKME & İŞLEMLER ---
async function loadClasses() {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    try {
        const res = await fetch('/api/getClasses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolCode: code, schoolPass: pass }) });
        const r = await res.json();
        if (r.status === 'success' && r.data) {
            document.querySelectorAll(".class-selector").forEach(sel => {
                const defaultOpt = sel.firstElementChild ? sel.firstElementChild.outerHTML : '<option value="">Şube</option>';
                let options = defaultOpt;
                if (r.data.classes) r.data.classes.forEach(cls => { options += `<option value="${cls}">${cls}</option>`; });
                sel.innerHTML = options;
            });
            document.querySelectorAll(".grade-selector").forEach(sel => {
                const defaultOpt = sel.firstElementChild ? sel.firstElementChild.outerHTML : '<option value="">Kademe</option>';
                let options = defaultOpt;
                if (r.data.grades) r.data.grades.forEach(g => { options += `<option value="${g}">${g}. Sınıf</option>`; });
                sel.innerHTML = options;
            });
        }
    } catch (error) { console.error("Sınıflar yüklenirken hata oluştu:", error); }
}

async function login() {
    const code = document.getElementById("schoolCode").value;
    const pass = document.getElementById("schoolPass").value;
    const remember = document.getElementById("beniHatirla").checked;
    const btn = document.querySelector(".btn-login");

    if (!code || !pass) { Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Bilgileri doldurun' }); return; }
    btn.innerText = "Giriş yapılıyor.."; btn.disabled = true;

    try {
        const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolCode: code, schoolPass: pass }) });
        const result = await response.json();
        if (result.status === 'success') {
            localStorage.setItem("okul_ismi", result.schoolName);
            localStorage.setItem("user_role", result.role);
            document.getElementById("headerTitle").innerText = result.schoolName;

            const yonetimTabBtn = document.querySelector(".tab-btn[onclick=\"showTab('yonetim')\"]");
            if (result.role === 'staff' && yonetimTabBtn) {
                yonetimTabBtn.style.display = 'none';
                const yonetimPanel = document.getElementById("tab-yonetim");
                if (yonetimPanel) yonetimPanel.remove();
            } else if (yonetimTabBtn) {
                yonetimTabBtn.style.display = 'inline-block';
            }

            if (remember) {
                localStorage.setItem("kutuphane_code", code);
                localStorage.setItem("kutuphane_pass", pass);
                localStorage.setItem("beni_hatirla", "true");
            } else {
                localStorage.setItem("kutuphane_code", code);
                localStorage.setItem("kutuphane_pass", pass);
                localStorage.removeItem("beni_hatirla");
            }

            Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true }).fire({ icon: 'success', title: 'Giriş Başarılı' });
            document.getElementById("login-screen").classList.add("hidden");
            document.getElementById("dashboard").classList.remove("hidden");
            getStats(); getOverdueBooks(); loadClasses(); getLeaderboard();
            loadBookSuggestions();
        } else { Swal.fire({ icon: 'error', title: 'Hata', text: result.message }); }
    } catch (error) { Swal.fire({ icon: 'error', title: 'Hata', text: 'Sunucu hatası' }); } finally { btn.innerText = "Giriş Yap"; btn.disabled = false; }
}

async function forgotPassword() {
    const { value: schoolCode } = await Swal.fire({
        title: 'Şifremi Unuttum',
        input: 'text',
        inputLabel: 'Sisteme kayıtlı okul kodunuzu girin',
        inputPlaceholder: 'Örn: 102030',
        showCancelButton: true,
        confirmButtonText: 'Şifre Sıfırlama Kodu Gönder',
        cancelButtonText: 'İptal',
        inputValidator: (value) => {
            if (!value) return 'Lütfen okul kodunuzu girin!';
        }
    });

    if (!schoolCode) return;

    Swal.fire({ title: 'Kontrol Ediliyor...', html: 'E-posta adresinize kod gönderiliyor...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        let res = await fetch('/api/forgotPassword', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode })
        });
        let data = await res.json();

        if (data.status !== 'success') {
            return Swal.fire({ icon: 'error', title: 'Hata', text: data.message });
        }

        const { value: resetCode } = await Swal.fire({
            title: 'Kod Gönderildi!',
            html: `<b>${data.maskedEmail}</b> adresine 6 haneli bir doğrulama kodu gönderdik.<br><br>Lütfen kodu aşağıya girin:`,
            input: 'text',
            inputPlaceholder: '123456',
            showCancelButton: true,
            confirmButtonText: 'Kodu Doğrula',
            cancelButtonText: 'İptal',
            inputValidator: (value) => {
                if (!value || value.length !== 6) return 'Lütfen 6 haneli kodu eksiksiz girin!';
            }
        });

        if (!resetCode) return;

        Swal.fire({ title: 'Kod Doğrulanıyor...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        res = await fetch('/api/verifyResetCode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode, resetCode })
        });
        data = await res.json();

        if (data.status !== 'success') {
            return Swal.fire({ icon: 'error', title: 'Geçersiz Kod', text: data.message });
        }

        const { value: newPassword } = await Swal.fire({
            title: 'Yeni Şifre',
            html: `
                <p style="font-size:0.9rem; color:#666; margin-bottom:15px;">Lütfen yeni şifrenizi belirleyin.</p>
                <input type="password" id="swal-pass1" class="swal2-input" placeholder="Yeni Şifre" style="margin-bottom: 10px;">
                <input type="password" id="swal-pass2" class="swal2-input" placeholder="Yeni Şifre (Tekrar)">
            `,
            showCancelButton: true,
            confirmButtonText: 'Şifreyi Kaydet',
            cancelButtonText: 'İptal',
            focusConfirm: false,
            preConfirm: () => {
                const pass1 = document.getElementById('swal-pass1').value;
                const pass2 = document.getElementById('swal-pass2').value;

                if (!pass1 || pass1.length < 4) {
                    Swal.showValidationMessage('Güvenliğiniz için şifre en az 4 karakter olmalıdır!');
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

        res = await fetch('/api/updatePassword', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode, resetCode, newPassword })
        });
        data = await res.json();

        if (data.status === 'success') {
            Swal.fire({ icon: 'success', title: 'Başarılı!', text: 'Şifreniz başarıyla güncellendi. Yeni şifrenizle giriş yapabilirsiniz.' });
        } else {
            Swal.fire({ icon: 'error', title: 'Hata', text: data.message });
        }

    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Bağlantı Hatası', text: 'Sunucuyla iletişim kurulurken bir hata oluştu.' });
    }
}

async function islemYap(actionType) {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    let data = { schoolCode: code, schoolPass: pass };
    let endpoint = actionType === 'kitapVer' ? "/api/kitapVer" : "/api/kitapAl";
    let islemBarkod = "", islemOgrNo = "";

    if (actionType === 'kitapVer') {
        data.ogrNo = document.getElementById("verOgrNo").value;
        data.barkod = document.getElementById("verBarkod").value;
        data.condition = document.getElementById("verKitapDurum").value; // YENİ EKLENDİ
        islemOgrNo = data.ogrNo; islemBarkod = data.barkod;
        if (!data.ogrNo || !data.barkod) { Swal.fire({ icon: 'warning', title: 'Eksik', text: 'Bilgileri giriniz' }); return; }
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
            playBeep();
            let msg = result.message;
            if (result.raf) msg += `<br><br><div style="font-size:1.2rem; color:#4f46e5;">Raf No: <b>${result.raf}</b></div>`;
            const popup = await Swal.fire({ icon: 'success', title: 'Başarılı', html: msg, showConfirmButton: true, confirmButtonText: 'TAMAM', confirmButtonColor: '#10b981', showDenyButton: true, denyButtonText: 'Geri Al', denyButtonColor: '#ef4444', allowOutsideClick: false });
            if (popup.isDenied) {
                Swal.fire({ title: 'Geri Alınıyor...', didOpen: () => Swal.showLoading() });
                const undoRes = await undoResp.json();
                if (undoRes.status === 'success') { Swal.fire('Geri Alındı', undoRes.message, 'info'); getStats(); getOverdueBooks(); getLeaderboard(); } else { Swal.fire('Hata', undoRes.message, 'error'); }
            }
            if (document.getElementById("verBarkod")) document.getElementById("verBarkod").value = "";
            if (document.getElementById("alBarkod")) document.getElementById("alBarkod").value = "";
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
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");

    try {
        const response = await fetch('/api/sorgula', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolCode: code, schoolPass: pass, query: query, type: searchType }) });
        const res = await response.json();
        if (res.status === 'success') {
            let html = '';
            if (res.result.type === 'book') {
                if (res.result.data.length === 0) { resultArea.innerHTML = '<div style="color:red; text-align:center;">Bulunamadı.</div>'; return; }
                res.result.data.forEach(book => {
                    const statusText = book.status === 'In' ? `RAF: ${book.shelf || '?'}` : `KİMDE: ${book.holder} (${book.holderNo})`;
                    const badgeClass = book.status === 'In' ? 'badge-raf' : 'badge-out';
                    const condColor = book.condition === 'Hasarlı' || book.condition === 'Yıpranmış' ? '#ef4444' : '#059669';
                    html += `<div class="result-card" style="border-left-color:#f59e0b;">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <div style="font-weight:bold;">${book.name}</div>
                                    <button onclick="archiveRecord('${book.code}', 'book')" style="background:none; border:none; color:#ef4444; cursor:pointer;" title="Arşive Gönder"><span class="material-symbols-rounded">delete</span></button>
                                </div>
                                <div style="font-size:0.9rem; color:#666;">${book.author} | Barkod: ${book.code}</div>
                                <div style="margin-top:5px; display:flex; gap:5px;">
                                    <span class="badge ${badgeClass}">${statusText}</span>
                                    <span class="badge" style="background:${condColor}; color:white;">Durum: ${book.condition || 'Yeni'}</span>
                                </div>
                            </div>`;
                });
            } else {
                const std = res.result.data;
                html += `<div class="result-card" style="border-left-color:#6366f1;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-weight:bold; color:#4f46e5; font-size:1.1rem;">${std.name}</div>
                        <button onclick="archiveRecord('${std.no}', 'student')" style="background:none; border:none; color:#ef4444; cursor:pointer;" title="Arşive Gönder"><span class="material-symbols-rounded">delete</span></button>
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

                std.history.forEach(h => {
                    if (h.status === 'Completed') {
                        html += `<div style="font-size:0.8rem; padding:5px 0; border-bottom:1px solid #f3f4f6;">✅ ${h.name} <span style="color:#6b7280;">(${h.pages} syf)</span></div>`;
                    }
                });
                html += `</div></div>`;
            }
            resultArea.innerHTML = html;
        } else { resultArea.innerHTML = `<div style="color:red; text-align:center;">${res.message}</div>`; }
    } catch (e) { resultArea.innerHTML = 'Hata.'; }
}

async function kaydet(type) {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    let data = { schoolCode: code, schoolPass: pass };
    let endpoint = "";

    if (type === 'student') {
        const no = document.getElementById("newOgrNo").value;
        const name = document.getElementById("newOgrAd").value;
        const grade = document.getElementById("newOgrKademe").value;
        const sube = document.getElementById("newOgrSube").value;
        if (!no || !name || !grade || !sube) { Swal.fire('Eksik', 'Bilgileri doldurunuz.', 'warning'); return; }
        data.no = no; data.name = name; data.grade = grade; data.className = sube;
        endpoint = "/api/addStudent";
    } else {
        const bName = document.getElementById("newKitapAd").value;
        const auth = document.getElementById("newKitapYazar").value;
        const pg = document.getElementById("newKitapSayfa").value;
        const typ = document.getElementById("newKitapTur").value;
        const shlf = document.getElementById("newKitapRaf").value;
        const qty = document.getElementById("newKitapAdet").value;
        const cond = document.getElementById("newKitapDurum").value;
        if (!bName) { Swal.fire('Eksik', 'Kitap Adı zorunludur.', 'warning'); return; }
        data.name = bName; data.author = auth; data.page = pg; data.type = typ; data.shelf = shlf; data.quantity = qty; data.condition = cond;
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
            document.querySelectorAll('#yonetim-form-' + type + ' input').forEach(i => { if (i.id !== 'newKitapAdet') i.value = ''; else i.value = '1'; });
        } else { Swal.fire('Hata', r.message, 'error'); }
    } catch (e) { Swal.fire('Hata', 'Sunucu hatası.', 'error'); }
}

async function updateStudent() {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    const no = document.getElementById("updateOgrNo").value;
    const newGrade = document.getElementById("updateOgrKademe").value;
    const newClass = document.getElementById("updateOgrSube").value;
    if (!no || !newGrade || !newClass) { Swal.fire('Eksik', 'Bilgileri doldurun', 'warning'); return; }

    Swal.fire({ title: 'Güncelleniyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/updateStudent', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode: code, schoolPass: pass, no: no, newGrade: newGrade, newClass: newClass })
        });
        const r = await res.json();
        if (r.status === 'success') {
            Swal.fire('Başarılı', `${r.studentName} artık ${newGrade}/${newClass} sınıfında.`, 'success');
            document.getElementById("updateOgrNo").value = "";
        } else Swal.fire('Hata', r.message, 'error');
    } catch (e) { Swal.fire('Hata', 'Sunucu hatası', 'error'); }
}


async function getReport() {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");

    const grdSelect = document.getElementById("reportGrade");
    const clsSelect = document.getElementById("reportClass");
    const monSelect = document.getElementById("reportMonth");
    
    const grd = grdSelect.value;
    const cls = clsSelect.value;
    const mon = monSelect.value;
    
    const resDiv = document.getElementById("report-result");
    const printBtn = document.getElementById("printBtn"); // YENİ EKLENDİ

    // Rapor çekilmeye başlarken veya yeni sorguda butonu pasif et
    if (printBtn) { printBtn.disabled = true; printBtn.style.opacity = "0.5"; printBtn.style.cursor = "not-allowed"; }

    resDiv.innerHTML = '<div style="text-align:center;">Hesaplanıyor...</div>';
    try {
        const res = await fetch('/api/getReport', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode: code, schoolPass: pass, filterGrade: grd, filterClass: cls, filterMonth: mon })
        });
        const r = await res.json();
        if (r.status === 'success') {
            if (r.data.length === 0) { resDiv.innerHTML = '<div style="text-align:center; color:red;">Kayıt yok.</div>'; return; }

            const grdText = grdSelect.options[grdSelect.selectedIndex].text;
            const clsText = clsSelect.options[clsSelect.selectedIndex].text;
            const monText = monSelect.options[monSelect.selectedIndex].text;

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

            let titleMonth = mon === 'ALL' ? 'TÜM ZAMANLAR' : `${monText.toLocaleUpperCase('tr-TR')} AYI`;
            let reportTitle = `${titleClass} ${titleMonth} OKUMA RAPORU`;


            let html = `
            <div style="text-align:center; margin-bottom:20px; padding-bottom:10px; border-bottom:2px solid #274ae4; page-break-after: avoid;">
                <h2 style="margin:0; font-size:1.3rem; color:#1f2937;">${reportTitle}</h2>
            </div>
            <div style="font-weight:bold; margin-bottom:10px;">Sonuçlar (${r.data.length} Öğrenci): <span style="font-size:0.8rem; font-weight:normal; color:#6b7280; display:inline-block;" class="hide-on-print">(Detaylar için tıklayın)</span></div>`;

            r.data.slice(0, 50).forEach((item, index) => {
                let booksHtml = "";
                if (item.books && item.books.length > 0) {
                    item.books.forEach(b => {
                        booksHtml += `<div style="padding: 4px 0; border-bottom: 1px dashed #e5e7eb;">📕 ${b.name} <span style="color:#6b7280; float:right;">${b.page} syf</span></div>`;
                    });
                } else {
                    booksHtml = `<div style="color:#9ca3af;">Veri yok.</div>`;
                }

                html += `<div class="report-item" onclick="this.classList.toggle('active')">
                    <div class="report-header-row">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div class="rank-circle">${index + 1}</div>
                            <div><div style="font-weight:bold; color:#1f2937;">${item.name}</div><div style="font-size:0.8rem; color:#6b7280;">${item.className}</div></div>
                        </div>
                        <div style="font-weight:bold; color:#4f46e5; text-align:right;">${item.totalPage} syf <br><span style="font-size:0.7rem; color:#9ca3af;">▼ Detay</span></div>
                    </div>
                    <div class="book-details">
                        <div style="font-weight:bold; margin-bottom:5px; color:#374151;">Okuduğu Kitaplar:</div>
                        ${booksHtml}
                    </div>
                </div>`;
            });

            resDiv.innerHTML = html;

            // Rapor başarıyla basıldı, PDF butonunu aktif et
            if (printBtn) { printBtn.disabled = false; printBtn.style.opacity = "1"; printBtn.style.cursor = "pointer"; }

        } else resDiv.innerHTML = 'Hata.';
    } catch (e) { resDiv.innerHTML = 'Sunucu Hatası.'; }
}

async function getStats() {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    try {
        const response = await fetch('/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolCode: code, schoolPass: pass }) });
        const res = await response.json();
        if (res.status === 'success') { document.getElementById("stat-kitap").innerText = res.data.kitap; document.getElementById("stat-ogrenci").innerText = res.data.ogrenci; document.getElementById("stat-emanet").innerText = res.data.emanet; }
    } catch (error) { }
}

async function showStatDetails(type) {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    let title = type === 'emanet' ? 'Emanetteki Kitaplar' : (type === 'kitap' ? 'Tüm Kitaplar' : 'Kayıtlı Öğrenciler');

    Swal.fire({ title: 'Yükleniyor...', didOpen: () => Swal.showLoading() });

    try {
        const response = await fetch('/api/statDetails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode: code, schoolPass: pass, type: type })
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
                    html += `<div style="padding: 10px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'}; border-radius: 8px; margin-bottom: 5px;">
                        <div style="font-weight: bold; color: #b91c1c; font-size: 0.95rem;">📖 ${item.books?.book_name || 'Bilinmeyen'} <span style="font-size: 0.75rem; color: #6b7280; font-weight: normal;">(#${item.books?.barcode || '-'})</span></div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                            <div style="font-size: 0.85rem; color: #1f2937;"><span class="material-symbols-rounded" style="font-size: 14px; vertical-align: middle;">person</span> ${item.students?.full_name || 'Bilinmeyen'} <span style="color: #6b7280;">(${item.students?.class_name || '-'})</span></div>
                            <div style="font-size: 0.75rem; color: #4f46e5; font-weight: bold;">${dateStr}</div>
                        </div>
                    </div>`;
                });
            } else if (type === 'kitap') {
                res.data.forEach((item, index) => {
                    html += `<div style="padding: 8px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'};">
                        <div style="font-weight: bold; color: #1f2937;">${item.book_name}</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Barkod: ${item.barcode} | Raf: ${item.shelf || '?'} | Durum: ${item.condition || 'Yeni'}</div>
                    </div>`;
                });
            } else if (type === 'ogrenci') {
                res.data.forEach((item, index) => {
                    html += `<div style="padding: 8px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'};">
                        <div style="font-weight: bold; color: #1f2937;">${item.full_name}</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Sınıf: ${item.class_name} | No: ${item.student_no}</div>
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




async function showStatDetails(type) {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    let title = type === 'emanet' ? 'Emanetteki Kitaplar' : (type === 'kitap' ? 'Tüm Kitaplar' : 'Kayıtlı Öğrenciler');

    Swal.fire({ title: 'Yükleniyor...', didOpen: () => Swal.showLoading() });

    try {
        const response = await fetch('/api/statDetails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode: code, schoolPass: pass, type: type })
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
                    html += `<div style="padding: 10px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'}; border-radius: 8px; margin-bottom: 5px;">
                        <div style="font-weight: bold; color: #b91c1c; font-size: 0.95rem;">📖 ${item.books?.book_name || 'Bilinmeyen'} <span style="font-size: 0.75rem; color: #6b7280; font-weight: normal;">(#${item.books?.barcode || '-'})</span></div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                            <div style="font-size: 0.85rem; color: #1f2937;"><span class="material-symbols-rounded" style="font-size: 14px; vertical-align: middle;">person</span> ${item.students?.full_name || 'Bilinmeyen'} <span style="color: #6b7280;">(${item.students?.class_name || '-'})</span></div>
                            <div style="font-size: 0.75rem; color: #4f46e5; font-weight: bold;">${dateStr}</div>
                        </div>
                    </div>`;
                });
            } else if (type === 'kitap') {
                res.data.forEach((item, index) => {
                    html += `<div style="padding: 8px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'};">
                        <div style="font-weight: bold; color: #1f2937;">${item.book_name}</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Barkod: ${item.barcode} | Raf: ${item.shelf || '?'} | Durum: ${item.condition || 'Yeni'}</div>
                    </div>`;
                });
            } else if (type === 'ogrenci') {
                res.data.forEach((item, index) => {
                    html += `<div style="padding: 8px; border-bottom: 1px solid #e5e7eb; background: ${index % 2 === 0 ? '#f9fafb' : '#fff'};">
                        <div style="font-weight: bold; color: #1f2937;">${item.full_name}</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Sınıf: ${item.class_name} | No: ${item.student_no}</div>
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
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    try {
        const response = await fetch('/api/getReport', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode: code, schoolPass: pass, filterGrade: 'ALL', filterClass: 'ALL', filterMonth: 'ALL' })
        });
        const result = await response.json();
        if (result.status === 'success') {
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
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    try {
        const response = await fetch('/api/overdue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolCode: code, schoolPass: pass }) });
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

async function loadBookSuggestions() {
    try {
        const res = await fetch('/api/globalBooks');
        const r = await res.json();
        if (r.status === 'success' && r.data.length > 0) {
            const datalist = document.getElementById("bookSuggestions");
            let options = "";
            r.data.forEach(book => { options += `<option value="${book}">`; });
            datalist.innerHTML = options;
        }
    } catch (error) { console.error("Öneriler yüklenemedi", error); }
}

async function archiveRecord(code, type) {
    const confirmed = await Swal.fire({
        title: 'Emin misiniz?',
        text: 'Bu kayıt arşive gönderilecek ve listelerde görünmeyecek.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Evet, Arşivle',
        cancelButtonText: 'İptal'
    });

    if (!confirmed.isConfirmed) return;

    const schoolCode = localStorage.getItem("kutuphane_code");
    const schoolPass = localStorage.getItem("kutuphane_pass");

    Swal.fire({ title: 'Arşivleniyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode, schoolPass, code, type })
        });
        const result = await res.json();

        if (result.status === 'success') {
            Swal.fire('Başarılı', result.message, 'success');
            document.getElementById("sorguSonucAlani").innerHTML = ""; // Temizle
            getStats(); // Sayıları güncelle
        } else {
            Swal.fire('Hata', result.message, 'error');
        }
    } catch (error) {
        Swal.fire('Hata', 'Sunucu hatası', 'error');
    }
}

async function loadSettings() {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    try {
        const response = await fetch('/api/getSettings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolCode: code, schoolPass: pass }) });
        const res = await response.json();
        if (res.status === 'success') {
            const s = res.data || {};
            document.getElementById("setting_max_borrow_limit").value = s.max_borrow_limit || '';
            document.getElementById("setting_max_borrow_days").value = s.max_borrow_days || '';
            document.getElementById("setting_min_borrow_days").value = s.min_borrow_days || '';
            document.getElementById("setting_lib_open_time").value = s.lib_open_time || '';
            document.getElementById("setting_lib_close_time").value = s.lib_close_time || '';

            document.getElementById("setting_staff_pass_mode").value = s.staff_pass_mode || 'fixed';
            if (s.staff_pass_mode === 'fixed') {
                document.getElementById("setting_fixed_staff_name").value = s.staff_names || '';
                document.getElementById("setting_staff_password").value = s.staff_password || '';
                currentStaffNames = [];
            } else {
                document.getElementById("setting_fixed_staff_name").value = '';
                document.getElementById("setting_staff_password").value = '';
                currentStaffNames = s.staff_names ? s.staff_names.split(',').map(n => n.trim()).filter(Boolean) : [];
            }
            renderStaffList();
            if (typeof toggleStaffGroups === 'function') toggleStaffGroups();
        }
    } catch (e) { console.error("Ayarlar yüklenemedi", e); }
}

async function saveSettings(type) {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    
    let settingsPayload = {};
    if (type === 'general') {
        settingsPayload = {
            max_borrow_limit: document.getElementById("setting_max_borrow_limit").value ? parseInt(document.getElementById("setting_max_borrow_limit").value) : null,
            max_borrow_days: document.getElementById("setting_max_borrow_days").value ? parseInt(document.getElementById("setting_max_borrow_days").value) : null,
            min_borrow_days: document.getElementById("setting_min_borrow_days").value ? parseInt(document.getElementById("setting_min_borrow_days").value) : null,
            lib_open_time: document.getElementById("setting_lib_open_time").value || null,
            lib_close_time: document.getElementById("setting_lib_close_time").value || null
        };
    } else if (type === 'staff') {
        const mode = document.getElementById("setting_staff_pass_mode").value;
        if (mode === 'daily') {
            const randomPass = Math.floor(100000 + Math.random() * 900000).toString();
            const d = new Date();
            
            settingsPayload = {
                staff_pass_mode: mode,
                staff_password: randomPass,
                staff_names: currentStaffNames.join(', ') || null,
                staff_pass_date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
            };
        } else {
            settingsPayload = {
                staff_pass_mode: mode,
                staff_password: document.getElementById("setting_staff_password").value || null,
                staff_names: document.getElementById("setting_fixed_staff_name").value || null,
                staff_pass_date: null
            };
        }
    }

    Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch('/api/updateSettings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode: code, schoolPass: pass, settings: settingsPayload })
        });
        const result = await res.json();
        
        if (result.status === 'success') {
            if (type === 'staff') {
                const mode = document.getElementById("setting_staff_pass_mode").value;
                if (mode === 'daily') {
                    Swal.fire({
                        icon: 'success',
                        title: 'Nöbetçiler Kaydedildi',
                        html: `Günün nöbetçileri: <b>${currentStaffNames.join(', ')}</b><br><br><div style="font-size:1.5rem; color:#4f46e5; padding:10px; background:#f3f4f6; border-radius:8px; display:inline-block; font-weight:bold; letter-spacing:2px;">Günlük Şifre: ${settingsPayload.staff_password}</div>`
                    });
                } else {
                    Swal.fire('Başarılı', 'Sabit görevli ayarları kaydedildi.', 'success');
                }
            } else {
                Swal.fire('Başarılı', 'Ayarlar Kaydedildi', 'success');
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

    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");

    Swal.fire({ title: 'Aranıyor...', didOpen: () => Swal.showLoading() });

    try {
        const response = await fetch('/api/getStudentByNo', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ schoolCode: code, schoolPass: pass, studentNo: no }) 
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

// ==========================================
// İŞLEM GEÇMİŞİ (LOGS) & OMNI-SEARCH
// ==========================================
let allLogs = [];

async function loadLogs() {
    const listArea = document.getElementById("logs-list");
    listArea.innerHTML = '<div style="text-align:center;">Yükleniyor...</div>';
    
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");
    const filterDate = document.getElementById("logDateFilter")?.value || null;
    
    try {
        const response = await fetch('/api/getLogs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolCode: code, schoolPass: pass, filterDate: filterDate })
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
            return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'});
        };
        
        let dateHTML = `<span class="text-red-600" style="color:#dc2626;">⬆️ Veriliş: ${formatDate(log.borrow_date)}</span>`;
        if (isCompleted && log.return_date) {
            dateHTML += `<br> <span class="text-green-600" style="color:#16a34a;">⬇️ İade: ${formatDate(log.return_date)}</span>`;
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
        <div style="background:#f9fafb; border:1px solid #e5e7eb; border-left:4px solid ${borderColor}; padding:10px 15px; border-radius:8px;">
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
    const q = searchTerm.toLowerCase();
    
    const filtered = allLogs.filter(log => {
        return (log.students?.full_name || '').toLowerCase().includes(q) ||
               (log.students?.student_no?.toString() || '').includes(q) ||
               ((log.students?.grade || '') + '/' + (log.students?.class_name || '')).toLowerCase().includes(q) ||
               (log.books?.book_name || '').toLowerCase().includes(q) ||
               (log.books?.barcode?.toString() || '').includes(q) ||
               (log.handed_by || '').toLowerCase().includes(q) ||
               (log.received_by || '').toLowerCase().includes(q);
    });
    
    renderLogs(filtered);
}