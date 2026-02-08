require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs'); // Dosya kontrolü için
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.static(__dirname)); 
app.use(cors());
app.use(express.json());

// --- HİBRİT KİMLİK DOĞRULAMA SİSTEMİ (KESİN ÇÖZÜM) ---
function getAuthObject() {
  // 1. Önce Lokaldeki 'credentials.json' dosyasına bak (IDX için garanti çözüm)
  if (fs.existsSync('./credentials.json')) {
    console.log("✅ MOD: Lokal Dosya (credentials.json) kullanılıyor.");
    return require('./credentials.json');
  }

  // 2. Dosya yoksa Environment Değişkenlerine bak (Render için)
  console.log("☁️ MOD: Environment Variables kullanılıyor.");
  
  if (!process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Kritik Hata: Ne dosya var ne de Environment Variable!");
  }

  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  // Render için satır sonu temizliği
  const cleanKey = rawKey.replace(/\\n/g, '\n').replace(/"/g, ''); 

  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: cleanKey,
  };
}

// --- YARDIMCI: SHEET ID BUL ---
async function getSchoolSheetID(schoolCode, schoolPass) {
  // .env içinde ID yoksa kod patlamasın, kontrol edelim
  const masterID = process.env.MASTER_SHEET_ID;
  if (!masterID) throw new Error("MASTER_SHEET_ID .env dosyasında bulunamadı!");

  const doc = new GoogleSpreadsheet(masterID);
  
  // Auth objesini al ve bağlan
  await doc.useServiceAccountAuth(getAuthObject());
  
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['Schools'];
  const rows = await sheet.getRows();
  const school = rows.find(row => row.school_code == schoolCode && row.school_password == schoolPass);
  return school ? school.school_sheet_ID : null;
}

// --- API: GİRİŞ KONTROL (Okul İsmiyle Beraber) ---
app.post('/api/login', async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    
    // Auth işlemleri
    const doc = new GoogleSpreadsheet(process.env.MASTER_SHEET_ID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();
    
    const sheet = doc.sheetsByTitle['Schools'];
    const rows = await sheet.getRows();
    
    // Okulu bul
    const school = rows.find(row => row.school_code == schoolCode && row.school_password == schoolPass);
    
    if (school) {
        // Hem başarı mesajı, hem de okul ismini gönderiyoruz
        res.json({ 
            status: 'success', 
            message: 'Giriş Başarılı',
            schoolName: school.school_name || 'Kütüphanemiz' // Excel'de school_name yoksa varsayılan
        });
    } else {
        res.json({ status: 'error', message: 'Hatalı Okul Kodu veya Şifre' });
    }
  } catch (error) {
    console.error("Login Hatası:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});
// --- API: DASHBOARD İSTATİSTİKLERİ (HATA AYIKLAMA MODU) ---
app.post('/api/stats', async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    console.log("İstatistik isteği geldi..."); // 1. Kontrol

    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    // Sayfa var mı kontrol et
    if (!doc.sheetsByTitle['Dashboard']) {
        console.log("HATA: 'Dashboard' isimli sayfa bulunamadı!"); // 2. Kontrol
        return res.json({ status: 'success', data: { kitap: 0, ogrenci: 0, emanet: 0 } });
    }

    const sheet = doc.sheetsByTitle['Dashboard'];
    const rows = await sheet.getRows();
    
    console.log("Dashboard Okundu. Satır Sayısı:", rows.length); // 3. Kontrol

    // Satırları okuyup basit bir objeye çevirelim
    let stats = { kitap: 0, ogrenci: 0, emanet: 0 };

    rows.forEach(row => {
        // Excel'den gelen veriyi terminale yazalım ki hatayı görelim
        console.log(`Okunan Satır -> Başlık: "${row.Baslik}", Değer: "${row.Deger}"`);
        
        if (row.Baslik == 'ToplamKitap') stats.kitap = row.Deger;
        if (row.Baslik == 'ToplamOgrenci') stats.ogrenci = row.Deger;
        if (row.Baslik == 'EmanetKitap') stats.emanet = row.Deger;
    });

    console.log("Gönderilen Veri:", stats); // 4. Sonuç
    res.json({ status: 'success', data: stats });

  } catch (error) {
    console.error("İstatistik Hatası DETAYI:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});
// --- API: KİTAP VER ---
app.post('/api/kitapVer', async (req, res) => {
  try {
    const { schoolCode, schoolPass, barkod, ogrNo } = req.body;
    
    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz Giriş' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    const sheetBooks = doc.sheetsByTitle['Books'];
    const sheetStudents = doc.sheetsByTitle['Students'];
    const sheetTrans = doc.sheetsByTitle['Transactions'];

    const books = await sheetBooks.getRows();
    const students = await sheetStudents.getRows();

    const book = books.find(row => row.code == barkod);
    if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });
    if (book.status == 'Out') return res.json({ status: 'error', message: 'Kitap zaten başkasında!' });

    const student = students.find(row => row.student_no == ogrNo);
    if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı' });
    
    let activeLoans = parseInt(student.active_loans || 0);
    if (activeLoans >= 2) return res.json({ status: 'error', message: 'Öğrenci limiti dolu (2)' });

    const today = new Date().toLocaleDateString("tr-TR");
    await sheetTrans.addRow({
      transaction_ID: Math.random().toString(36).substr(2, 9),
      code: barkod,
      student_no: ogrNo,
      borrow_date: today,
      status: 'Active'
    });

    book.status = 'Out'; await book.save();
    student.active_loans = activeLoans + 1; await student.save();

    const mesaj = `<b>"${book.book_name}"</b> adlı kitap <b>${student.student_fullname}</b> isimli öğrenciye verildi.`;
    res.json({ status: 'success', message: mesaj });

  } catch (error) {
    console.error("Kitap Ver Hatası:", error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// --- API: KİTAP AL ---
app.post('/api/kitapAl', async (req, res) => {
  try {
    const { schoolCode, schoolPass, barkod } = req.body;

    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz Giriş' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    const sheetBooks = doc.sheetsByTitle['Books'];
    const sheetStudents = doc.sheetsByTitle['Students'];
    const sheetTrans = doc.sheetsByTitle['Transactions'];

    const books = await sheetBooks.getRows();
    const book = books.find(row => row.code == barkod);
    if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });

    const transactions = await sheetTrans.getRows();
    const activeTrans = transactions.find(row => row.code == barkod && row.status == 'Active');

    if (!activeTrans) return res.json({ status: 'error', message: 'Bu kitap zaten rafta görünüyor.' });

    const ogrNo = activeTrans.student_no;
    const returnDate = new Date().toLocaleDateString("tr-TR");

    const students = await sheetStudents.getRows();
    const student = students.find(row => row.student_no == ogrNo);

    activeTrans.return_date = returnDate;
    activeTrans.status = 'Completed';
    await activeTrans.save();

    book.status = 'In'; await book.save();

    if (student) {
        let currentCount = parseInt(student.active_loans || 0);
        if (currentCount > 0) { student.active_loans = currentCount - 1; await student.save(); }
    }

    // MESAJI HAZIRLA
    const mesaj = `<b>"${book.book_name}"</b> adlı kitap <b>${student.student_fullname}</b> isimli öğrenciden teslim alındı.`;

    // CEVABI GÖNDER (Öğrenci Numarasını Ekledik)
    res.json({ 
        status: 'success', 
        message: mesaj, 
        raf: book.shelf || '?',
        studentNo: student.student_no  // <--- YENİ EKLENEN SATIR (Geri Al için şart)
    });

  } catch (error) {
    console.error("Kitap Al Hatası:", error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

const PORT = process.env.PORT || 3000;
// --- API: TÜR SEÇMELİ SORGU (KESİN SONUÇ) ---
app.post('/api/sorgula', async (req, res) => {
  try {
    const { schoolCode, schoolPass, query, type } = req.body; // type eklendi

    if (!query) return res.json({ status: 'error', message: 'Lütfen bir numara giriniz.' });
    if (!type) return res.json({ status: 'error', message: 'Arama türü seçilmedi.' });

    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    const sheetBooks = doc.sheetsByTitle['Books'];
    const sheetStudents = doc.sheetsByTitle['Students'];
    const sheetTrans = doc.sheetsByTitle['Transactions'];

    const q = query.trim();
    let result = { type: type, data: [] }; // Gelen tipi geri döndüreceğiz

    // --- SENARYO A: KİTAP ARANIYORSA ---
    if (type === 'book') {
        const books = await sheetBooks.getRows();
        const transactions = await sheetTrans.getRows();
        const students = await sheetStudents.getRows();

        const foundBook = books.find(row => row.code == q); // Tam eşleşme

        if (foundBook) {
            let detail = {
                name: foundBook.book_name,
                code: foundBook.code,
                author: foundBook.author,
                status: foundBook.status,
                shelf: foundBook.shelf,
                holder: null,
                holderNo: null,
                date: null
            };

            if (foundBook.status === 'Out') {
                const activeTrans = transactions.find(t => t.code === q && t.status === 'Active');
                if (activeTrans) {
                    const student = students.find(s => s.student_no === activeTrans.student_no);
                    detail.holder = student ? student.student_fullname : 'Bilinmiyor';
                    detail.holderNo = activeTrans.student_no;
                    detail.date = activeTrans.borrow_date;
                }
            }
            result.data = [detail];
            return res.json({ status: 'success', result });
        }
        return res.json({ status: 'error', message: 'Bu barkodla kitap bulunamadı.' });
    }

    // --- SENARYO B: ÖĞRENCİ ARANIYORSA ---
    if (type === 'student') {
        const students = await sheetStudents.getRows();
        const transactions = await sheetTrans.getRows();
        const books = await sheetBooks.getRows();

        const foundStudent = students.find(row => row.student_no == q); // Tam eşleşme

        if (foundStudent) {
            const activeLoans = transactions.filter(t => t.student_no == q && t.status === 'Active');
            
            let booksHeld = [];
            if (activeLoans.length > 0) {
                booksHeld = activeLoans.map(loan => {
                    const bookInfo = books.find(b => b.code === loan.code);
                    return {
                        name: bookInfo ? bookInfo.book_name : 'Bilinmeyen Kitap',
                        code: loan.code,
                        date: loan.borrow_date
                    };
                });
            }

            result.data = {
                name: foundStudent.student_fullname,
                no: foundStudent.student_no,
                class: foundStudent.class,
                books: booksHeld
            };
            return res.json({ status: 'success', result });
        }
        return res.json({ status: 'error', message: 'Bu numarayla öğrenci bulunamadı.' });
    }

  } catch (error) {
    console.error("Sorgu Hatası:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});
// --- API: SON HAREKETLER (HATA AYIKLAMA MODU) ---
app.post('/api/recent', async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    console.log("Son Hareketler isteği geldi..."); // KONTROL 1

    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    // Sayfa Kontrolü
    if (!doc.sheetsByTitle['Loans']) {
        console.log("HATA: 'Loans' isimli sayfa bulunamadı!"); // KONTROL 2
        return res.json({ status: 'success', data: [] });
    }

    const sheet = doc.sheetsByTitle['Loans'];
    const rows = await sheet.getRows();
    
    console.log(`Loans sayfası bulundu. Toplam ${rows.length} satır veri var.`); // KONTROL 3

    if (rows.length > 0) {
        // İlk satırı terminale yazdıralım ki sütun isimlerini görelim
        console.log("Örnek Satır Verisi (Sütun İsimlerine Dikkat):", rows[0]._rawData); 
    }

    const recentRows = rows.slice(-10).reverse();

    const history = recentRows.map(row => {
        // BURAYA DİKKAT: Excel başlıklarınla buradaki isimler AYNI olmalı
        return {
            student: row.student_fullname, // Excel'de "student_fullname" yazmalı
            book: row.book_name,           // Excel'de "book_name" yazmalı
            date: row.borrow_date,         // Excel'de "borrow_date" yazmalı
            returnDate: row.return_date,   // Excel'de "return_date" yazmalı
            status: row.status             // Excel'de "status" yazmalı
        };
    });

    console.log("Hazırlanan Veri (İlk Kayıt):", history[0]); // KONTROL 4
    res.json({ status: 'success', data: history });

  } catch (error) {
    console.error("LOANS HATASI:", error); // HATA BURADA GÖRÜNECEK
    res.status(500).json({ status: 'error', message: error.message });
  }
});
// --- API: GECİKEN KİTAPLAR LİSTESİ ---
app.post('/api/overdue', async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;

    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle['Loans'];
    if (!sheet) return res.json({ status: 'success', data: [] });

    const rows = await sheet.getRows();

    // Sadece "GEÇ KALDI" yazanları filtrele
    const overdueRows = rows.filter(row => row.overdues === 'GEÇ KALDI');

    // Veriyi hazırla
    // ...
    const list = overdueRows.map(row => {
      return {
          code: row.code,           // <--- YENİ: Kitap Kodunu ekledik
          student: row.student_fullname,
          book: row.book_name,
          date: row.borrow_date,
          status: row.overdues
      };
  });
  // ...

    res.json({ status: 'success', data: list });

  } catch (error) {
    console.error("Gecikenler Hatası:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});
app.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda çalışıyor.`); });

// --- API: İŞLEMİ GERİ AL (UNDO) ---
app.post('/api/undo', async (req, res) => {
  try {
    const { schoolCode, schoolPass, type, bookCode, studentNo } = req.body;

    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    const sheetBooks = doc.sheetsByTitle['Books'];
    const sheetTrans = doc.sheetsByTitle['Transactions'];
    
    const books = await sheetBooks.getRows();
    const transactions = await sheetTrans.getRows();

    if (type === 'ver') {
        // VERME İŞLEMİNİ İPTAL ET (Kitabı geri al, kaydı sil)
        const book = books.find(b => b.code == bookCode);
        if (book) { book.status = 'In'; book.holder = ''; await book.save(); }

        const transRows = transactions.filter(t => t.code == bookCode && t.student_no == studentNo && t.status === 'Active');
        if (transRows.length > 0) { await transRows[transRows.length - 1].delete(); }

        return res.json({ status: 'success', message: 'Verme işlemi geri alındı.' });
    }

    if (type === 'al') {
        // ALMA İŞLEMİNİ İPTAL ET (Kitabı geri ver, kaydı düzelt)
        const book = books.find(b => b.code == bookCode);
        if (book) { book.status = 'Out'; await book.save(); }

        const transRows = transactions.filter(t => t.code == bookCode && t.student_no == studentNo && t.status === 'Completed');
        if (transRows.length > 0) {
            const lastTrans = transRows[transRows.length - 1];
            lastTrans.status = 'Active'; lastTrans.return_date = ''; 
            await lastTrans.save();
        }

        return res.json({ status: 'success', message: 'İade işlemi geri alındı.' });
    }

    res.json({ status: 'error', message: 'Geçersiz işlem.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});