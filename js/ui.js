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
            localStorage.removeItem("kutuphane_code"); 
            localStorage.removeItem("kutuphane_pass"); 
            location.reload(); 
        } 
    }); 
}

window.onload = function() {
    // Beni Hatırla Kontrolü
    if (localStorage.getItem("beni_hatirla") === "true") {
        document.getElementById("schoolCode").value = localStorage.getItem("kutuphane_code");
        document.getElementById("schoolPass").value = localStorage.getItem("kutuphane_pass");
        document.getElementById("beniHatirla").checked = true;
    }
    if(localStorage.getItem("okul_ismi")) document.getElementById("headerTitle").innerText = localStorage.getItem("okul_ismi");
};

// --- TAB & NAVİGASYON ---
function showTab(tabName) {
    document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
    document.getElementById("tab-" + tabName).classList.remove("hidden");
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    event.currentTarget.classList.add("active");
    if(tabName === 'yonetim') closeYonetimForm();
}

function showYonetimForm(type) { 
    document.getElementById("yonetim-menu").classList.add("hidden"); 
    document.getElementById("yonetim-form-" + type).classList.remove("hidden"); 
}

function closeYonetimForm() { 
    document.querySelectorAll("[id^='yonetim-form-']").forEach(el => el.classList.add("hidden")); 
    document.getElementById("yonetim-menu").classList.remove("hidden"); 
    document.getElementById("report-result").innerHTML = ""; 
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