// --- BAŞLANGIÇ & AYARLAR ---
// Splash 3.5 saniye (3500ms)
window.addEventListener('load', () => { 
    setTimeout(() => { 
        document.getElementById('splash-screen').classList.add('hidden-splash'); 
        document.body.style.overflow = 'auto'; 
    }, 3150); 
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
            
            // 2. SPA Mimarisi: Sayfayı yenilemek yerine sadece UI'ı değiştiriyoruz
            document.getElementById("dashboard").classList.add("hidden"); 
            document.getElementById("login-screen").classList.remove("hidden"); 
            
            // 3. Giriş formunu sıfırlama
            document.getElementById("schoolCode").value = "";
            document.getElementById("schoolPass").value = "";
            document.getElementById("beniHatirla").checked = false;
        } 
    }); 
}

window.onload = function() {
    const savedCode = localStorage.getItem("kutuphane_code");
    const savedPass = localStorage.getItem("kutuphane_pass");

    // Eğer veriler varsa form inputlarına yaz ve login'i otomatik tetikle
    if (savedCode && savedPass) {
        document.getElementById("schoolCode").value = savedCode;
        document.getElementById("schoolPass").value = savedPass;
        document.getElementById("beniHatirla").checked = (localStorage.getItem("beni_hatirla") === "true");
        
        if(localStorage.getItem("okul_ismi")) {
            document.getElementById("headerTitle").innerText = localStorage.getItem("okul_ismi");
        }
        
        // api-client.js içindeki mevcut giriş fonksiyonunu çağırarak auto-login yap
        login(); 
    }
};

// --- TAB & NAVİGASYON ---
function showTab(tabName) {
    document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
    document.getElementById("tab-" + tabName).classList.remove("hidden");
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    event.currentTarget.classList.add("active");
    if(tabName === 'yonetim') {
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
        if(type === 'sorgu') sorgula(null); 
        else type === 'ver' ? islemYap('kitapVer') : islemYap('kitapAl'); 
    } 
}

function playBeep() { 
    const s = document.getElementById("beepSound"); 
    s.currentTime=0; 
    s.play().catch(e=>{}); 
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
        (err) => {} 
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
    } else {
        document.getElementById("scanner-modal").classList.add("hidden");
    }
}