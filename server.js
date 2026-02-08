require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.static(__dirname)); 
app.use(cors());
app.use(express.json());

// --- 1. KİMLİK DOĞRULAMA (HİBRİT SİSTEM) ---
function getAuthObject() {
  // Lokaldeki 'credentials.json' dosyasına bak (IDX için)
  if (fs.existsSync('./credentials.json')) {
    console.log("✅ MOD: Lokal Dosya (credentials.json) kullanılıyor.");
    return require('./credentials.json');
  }

  // Yoksa Environment Değişkenlerine bak (Render için)
  console.log("☁️ MOD: Environment Variables kullanılıyor.");
  if (!process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Kritik Hata: Ne dosya var ne de Environment Variable!");
  }

  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const cleanKey = rawKey.replace(/\\n/g, '\n').replace(/"/g, ''); 

  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: cleanKey,
  };
}

// --- 2. YARDIMCI: OKUL SHEET ID BUL ---
async function getSchoolSheetID(schoolCode, schoolPass) {
  const masterID = process.env.MASTER_SHEET_ID;
  if (!masterID) throw new Error("MASTER_SHEET_ID .env dosyasında bulunamadı!");

  const doc = new GoogleSpreadsheet(masterID);
  await doc.useServiceAccountAuth(getAuthObject());
  await doc.loadInfo();
  
  const sheet = doc.sheetsByTitle['Schools'];
  const rows = await sheet.getRows();
  const school = rows.find(row => row.school_code == schoolCode && row.school_password == schoolPass);
  return school ? school.school_sheet_ID : null;
}

// --- 3. API ENDPOINTLERİ ---

// A) GİRİŞ YAP
app.post('/api/login', async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    const doc = new GoogleSpreadsheet(process.env.MASTER_SHEET_ID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['Schools'];
    const rows = await sheet.getRows();
    const school = rows.find(row => row.school_code == schoolCode && row.school_password == schoolPass);
    
    if (school) {
        res.json({ 
            status: 'success', 
            message: 'Giriş Başarılı',
            schoolName: school.school_name || 'Kütüphanemiz'
        });
    } else {
        res.json({ status: 'error', message: 'Hatalı Okul Kodu veya Şifre' });
    }
  } catch (error) {
    console.error("Login Hatası:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// B) DASHBOARD İSTATİSTİKLERİ
app.post('/api/stats', async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    if (!doc.sheetsByTitle['Dashboard']) {
        return res.json({ status: 'success', data: { kitap: 0, ogrenci: 0, emanet: 0 } });
    }

    const sheet = doc.sheetsByTitle['Dashboard'];
    const rows = await sheet.getRows();
    let stats = { kitap: 0, ogrenci: 0, emanet: 0 };

    rows.forEach(row => {
        if (row.Baslik == 'ToplamKitap') stats.kitap = row.Deger;
        if (row.Baslik == 'ToplamOgrenci') stats.ogrenci = row.Deger;
        if (row.Baslik == 'EmanetKitap') stats.emanet = row.Deger;
    });

    res.json({ status: 'success', data: stats });
  } catch (error) {
    console.error("İstatistik Hatası:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// C) KİTAP VER
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
    
    // Öğrenci limiti kontrolü (aktif emanet sayısı)
    // Not: active_loans sütunu formül ise bu kontrol Excel tarafında da yapılabilir ama burada güvenlik sağlıyoruz.
    // Eğer Excel'de formül varsa bu değeri okuyabiliriz.
    let activeLoans = parseInt(student.active_loans || 0); 
    // activeLoans >= 2 gibi bir limit koymak istersen burayı açabilirsin.

    const today = new Date().toLocaleDateString("tr-TR");
    await sheetTrans.addRow({
      transaction_ID: Math.random().toString(36).substr(2, 9),
      code: barkod,
      student_no: ogrNo,
      borrow_date: today,
      status: 'Active'
    });

    book.status = 'Out'; await book.save();
    // active_loans sütunu formül değilse elle arttır:
    // student.active_loans = activeLoans + 1; await student.save();

    const mesaj = `<b>"${book.book_name}"</b> adlı kitap <b>${student.student_fullname}</b> isimli öğrenciye verildi.`;
    res.json({ status: 'success', message: mesaj });

  } catch (error) {
    console.error("Kitap Ver Hatası:", error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// D) KİTAP AL (TESLİM)
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
    // active_loans formül değilse azalt:
    // if (student) { let currentCount = parseInt(student.active_loans || 0); if (currentCount > 0) { student.active_loans = currentCount - 1; await student.save(); } }

    const mesaj = `<b>"${book.book_name}"</b> adlı kitap <b>${student ? student.student_fullname : 'Bilinmeyen Öğrenci'}</b> isimli öğrenciden teslim alındı.`;

    res.json({ 
        status: 'success', 
        message: mesaj, 
        raf: book.shelf || '?',
        studentNo: student ? student.student_no : null 
    });

  } catch (error) {
    console.error("Kitap Al Hatası:", error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// E) SORGULAMA (KİTAP / ÖĞRENCİ)
app.post('/api/sorgula', async (req, res) => {
  try {
    const { schoolCode, schoolPass, query, type } = req.body;
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
    let result = { type: type, data: [] };

    // --- SENARYO A: KİTAP ARANIYORSA ---
    if (type === 'book') {
        const books = await sheetBooks.getRows();
        const transactions = await sheetTrans.getRows();
        const students = await sheetStudents.getRows();

        const foundBook = books.find(row => row.code == q);
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

        const foundStudent = students.find(row => row.student_no == q);
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

// F) SON HAREKETLER LİSTESİ
app.post('/api/recent', async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    if (!doc.sheetsByTitle['Loans']) return res.json({ status: 'success', data: [] });

    const sheet = doc.sheetsByTitle['Loans'];
    const rows = await sheet.getRows();
    const recentRows = rows.slice(-10).reverse();

    const history = recentRows.map(row => {
        return {
            student: row.student_fullname,
            book: row.book_name,
            date: row.borrow_date,
            returnDate: row.return_date,
            status: row.status
        };
    });
    res.json({ status: 'success', data: history });
  } catch (error) {
    console.error("Loans Hatası:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// G) GECİKENLER LİSTESİ (OVERDUE)
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
    const overdueRows = rows.filter(row => row.overdues === 'GEÇ KALDI');

    const list = overdueRows.map(row => {
      return {
          code: row.code,
          student: row.student_fullname,
          book: row.book_name,
          date: row.borrow_date,
          status: row.overdues
      };
    });
    res.json({ status: 'success', data: list });
  } catch (error) {
    console.error("Gecikenler Hatası:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// H) İŞLEMİ GERİ AL (UNDO)
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
        const book = books.find(b => b.code == bookCode);
        if (book) { book.status = 'In'; book.holder = ''; await book.save(); }

        const transRows = transactions.filter(t => t.code == bookCode && t.student_no == studentNo && t.status === 'Active');
        if (transRows.length > 0) { await transRows[transRows.length - 1].delete(); }

        return res.json({ status: 'success', message: 'Verme işlemi geri alındı.' });
    }

    if (type === 'al') {
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

// I) YENİ ÖĞRENCİ EKLE (YÖNETİM)
app.post('/api/addStudent', async (req, res) => {
  try {
    const { schoolCode, schoolPass, no, name, className } = req.body;
    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
    
    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();
    
    const sheet = doc.sheetsByTitle['Students'];
    const rows = await sheet.getRows();

    const exist = rows.find(r => r.student_no == no);
    if (exist) return res.json({ status: 'error', message: 'Bu numaralı öğrenci zaten kayıtlı!' });

    await sheet.addRow({
        student_no: no,
        student_fullname: name,
        class: className
    });

    res.json({ status: 'success', message: 'Öğrenci başarıyla eklendi.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// J) YENİ KİTAP EKLE (YÖNETİM - TOPLU)
app.post('/api/addBook', async (req, res) => {
  try {
    const { schoolCode, schoolPass, name, author, page, type, shelf, quantity } = req.body;
    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
    
    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle['Books'];
    
    const booksToAdd = [];
    const loopCount = parseInt(quantity) || 1;

    for (let i = 0; i < loopCount; i++) {
        booksToAdd.push({
            book_name: name,
            page: page,
            author: author,
            book_type: type,
            shelf: shelf,
            status: 'In'
        });
    }

    await sheet.addRows(booksToAdd);
    res.json({ status: 'success', message: `${loopCount} adet kitap başarıyla eklendi.` });

  } catch (error) {
    console.error("Kitap Ekleme Hatası:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// --- 4. SUNUCUYU BAŞLAT (HER ŞEYİN EN SONU) ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});