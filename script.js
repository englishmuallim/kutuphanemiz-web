// BURAYA KOPYALADIĞIN API LİNKİNİ YAPIŞTIR (Tırnak içinde!)
const API_URL = "https://docs.google.com/spreadsheets/d/1ARYZKLuEhjtg4o5HTtwTzsj18zyYrG9wFoLBodUD8s0/edit?gid=0#gid=0"; 

// Hata mesajlarını alert yerine ekrana basan fonksiyon
function showMsg(msg, type = 'error') {
    const resultArea = document.getElementById("result-area");
    const resultText = document.getElementById("result-text");
    const resultIcon = document.getElementById("result-icon");

    resultArea.classList.remove("hidden");
    resultText.innerText = msg;
    
    if(type === 'error') {
        resultArea.style.backgroundColor = "#f8d7da";
        resultIcon.innerText = "error";
        resultIcon.style.color = "red";
    } else {
        resultArea.style.backgroundColor = "#d4edda";
        resultIcon.innerText = "check_circle";
        resultIcon.style.color = "green";
    }
}

// --- GİRİŞ İŞLEMLERİ ---
function login() {
    const code = document.getElementById("schoolCode").value;
    const pass = document.getElementById("schoolPass").value;

    if (!code || !pass) {
        // ALERT YOK! Konsola yazıyoruz.
        console.error("Giriş bilgileri eksik");
        return;
    }

    localStorage.setItem("kutuphane_code", code);
    localStorage.setItem("kutuphane_pass", pass);

    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
}

window.onload = function() {
    const savedCode = localStorage.getItem("kutuphane_code");
    if (savedCode) {
        document.getElementById("schoolCode").value = savedCode;
        document.getElementById("schoolPass").value = localStorage.getItem("kutuphane_pass");
        login();
    }
};

function logout() {
    localStorage.clear();
    location.reload();
}

function showTab(tabName) {
    document.getElementById("tab-ver").classList.add("hidden");
    document.getElementById("tab-al").classList.add("hidden");
    document.getElementById("tab-" + tabName).classList.remove("hidden");

    const buttons = document.querySelectorAll(".tab-btn");
    buttons.forEach(btn => btn.classList.remove("active"));
    event.target.classList.add("active");
    
    document.getElementById("result-area").classList.add("hidden");
}

async function islemYap(actionType) {
    const code = localStorage.getItem("kutuphane_code");
    const pass = localStorage.getItem("kutuphane_pass");

    let data = {
        action: actionType,
        schoolCode: code,
        schoolPass: pass
    };

    if (actionType === 'kitapVer') {
        data.ogrNo = document.getElementById("verOgrNo").value;
        data.barkod = document.getElementById("verBarkod").value;
        if (!data.ogrNo || !data.barkod) { showMsg("Bilgiler eksik!", "error"); return; }
    } else {
        data.barkod = document.getElementById("alBarkod").value;
        if (!data.barkod) { showMsg("Barkod okutun!", "error"); return; }
    }

    showMsg("İşlem yapılıyor...", "wait");

    try {
        // fetch içinde redirect: 'follow' CORS için önemlidir
        const response = await fetch(API_URL, {
            redirect: "follow",
            method: "POST",
            body: JSON.stringify(data),
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
        });

        const result = await response.json();

        if (result.status === 'success') {
            showMsg(result.message + (result.raf ? " (Raf: " + result.raf + ")" : ""), "success");
            
            document.getElementById("verBarkod").value = "";
            document.getElementById("alBarkod").value = "";
        } else {
            showMsg(result.message, "error");
        }

    } catch (error) {
        console.error(error);
        showMsg("Bağlantı hatası: " + error, "error");
    }
}

function handleEnter(e, type) {
    if (e.key === "Enter") {
        if (type === 'ver') islemYap('kitapVer');
        else islemYap('kitapAl');
    }
}