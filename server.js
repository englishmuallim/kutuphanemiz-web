require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.static(__dirname)); 
app.use(cors());
app.use(express.json());

// --- 1. KİMLİK DOĞRULAMA ---
function getAuthObject() {
  if (fs.existsSync('./credentials.json')) {
    return require('./credentials.json');
  }
  if (!process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Kritik Hata: Private Key bulunamadı!");
  }
  const cleanKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, ''); 
  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: cleanKey,
  };
}

// --- 2. YARDIMCI FONKSİYONLAR ---
async function getSchoolSheetID(schoolCode, schoolPass) {
  const masterID = process.env.MASTER_SHEET_ID;
  const doc = new GoogleSpreadsheet(masterID);
  await doc.useServiceAccountAuth(getAuthObject());
  await doc.loadInfo();
  
  const sheet = doc.sheetsByTitle['Schools'];
  const rows = await sheet.getRows();
  const school = rows.find(row => row.school_code == schoolCode && row.school_password == schoolPass);
  return school ? school.school_sheet_ID : null;
}

// --- 3. API ENDPOINTLERİ ---

// A) GİRİŞ
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
        res.json({ status: 'success', message: 'Giriş Başarılı', schoolName: school.school_name || 'Kütüphane' });
    } else {
        res.json({ status: 'error', message: 'Hatalı Okul Kodu veya Şifre' });
    }
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// B) İSTATİSTİKLER
app.post('/api/stats', async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
    if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    const doc = new GoogleSpreadsheet(targetSheetID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle['Dashboard'];
    if (!sheet) return res.json({ status: 'success', data: { kitap: 0, ogrenci: 0, emanet: 0 } });

    const rows = await sheet.getRows();
    let stats = { kitap: 0, ogrenci: 0, emanet: 0 };
    rows.forEach(row => {
        if (row.Baslik == 'ToplamKitap') stats.kitap = row.Deger;
        if (row.Baslik == 'ToplamOgrenci') stats.ogrenci = row.Deger;
        if (row.Baslik == 'EmanetKitap') stats.emanet = row.Deger;
    });
    res.json({ status: 'success', data: stats });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// C) SINIF LİSTESİ (YENİ)
app.post('/api/getClasses', async (req, res) => {
    try {
      const { schoolCode, schoolPass } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
  
      const doc = new GoogleSpreadsheet(targetSheetID);
      await doc.useServiceAccountAuth(getAuthObject());
      await doc.loadInfo();
  
      // Classes sayfası yoksa boş dön
      if (!doc.sheetsByTitle['Classes']) return res.json({ status: 'success', data: [] });
  
      const sheet = doc.sheetsByTitle['Classes'];
      const rows = await sheet.getRows();
      
      // A sütununu (veya ilk sütunu) sınıf listesi olarak alıyoruz
      // Excel başlığı 'class_name' olsun veya ne olursa olsun ilk sütunu alır.
      const classes = rows.map(r => r._rawData[0]).filter(c => c); // Boş olmayanları al
  
      res.json({ status: 'success', data: classes });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
  });

// D) KİTAP EKLE (GÜNCELLENDİ - BOŞLUĞA YAZMA MANTIĞI)
app.post('/api/addBook', async (req, res) => {
    try {
      const { schoolCode, schoolPass, name, author, page, type, shelf, quantity } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      
      const doc = new GoogleSpreadsheet(targetSheetID);
      await doc.useServiceAccountAuth(getAuthObject());
      await doc.loadInfo();
  
      const sheet = doc.sheetsByTitle['Books'];
      const rows = await sheet.getRows(); // Tüm satırları (formüllüler dahil) çeker
      
      const loopCount = parseInt(quantity) || 1;
      let assignedBarcodes = [];
      let savedCount = 0;
  
      // 1. ADIM: Boş koltukları (B sütunu boş olanları) bul ve doldur
      for (let i = 0; i < rows.length; i++) {
          if (savedCount >= loopCount) break;
  
          // Eğer Kitap Adı (B sütunu) boşsa buraya yaz!
          if (!rows[i].book_name || rows[i].book_name === '') {
              rows[i].book_name = name;
              rows[i].author = author;
              rows[i].page = page;
              rows[i].book_type = type;
              rows[i].shelf = shelf;
              rows[i].status = 'In'; // Rafta
              
              await rows[i].save(); // Kaydet
              
              // Barkodu kaydet (A sütunundan okuyoruz)
              assignedBarcodes.push(rows[i].code); 
              savedCount++;
          }
      }
  
      // 2. ADIM: Eğer yeterince boş yer yoksa hata ver veya yeni satır ekle
      // (Sen formülü aşağı kadar çektiğin için genelde boş yer olacaktır)
      if (savedCount < loopCount) {
          // Yer kalmadıysa
          return res.json({ 
              status: 'partial', 
              message: `Sadece ${savedCount} adet eklenebildi. Tabloda yeterli boş (formüllü) satır kalmadı!`,
              barcodes: assignedBarcodes
          });
      }
  
      res.json({ 
          status: 'success', 
          message: 'Kitaplar başarıyla yerleştirildi.',
          barcodes: assignedBarcodes // Barkodları listeye gönderiyoruz
      });
  
    } catch (error) {
      console.error("Kitap Ekleme Hatası:", error);
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

// E) KİTAP VER/AL İŞLEMLERİ
app.post('/api/kitapVer', async (req, res) => {
    try {
      const { schoolCode, schoolPass, barkod, ogrNo } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
  
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
      
      const today = new Date().toLocaleDateString("tr-TR");
      await sheetTrans.addRow({
        transaction_ID: Math.random().toString(36).substr(2, 9),
        code: barkod,
        student_no: ogrNo,
        borrow_date: today,
        status: 'Active'
      });
  
      book.status = 'Out'; await book.save();
      const mesaj = `<b>"${book.book_name}"</b> adlı kitap <b>${student.student_fullname}</b> isimli öğrenciye verildi.`;
      res.json({ status: 'success', message: mesaj });
  
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
  });

app.post('/api/kitapAl', async (req, res) => {
    try {
      const { schoolCode, schoolPass, barkod } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
  
      const doc = new GoogleSpreadsheet(targetSheetID);
      await doc.useServiceAccountAuth(getAuthObject());
      await doc.loadInfo();
  
      const sheetBooks = doc.sheetsByTitle['Books'];
      const sheetTrans = doc.sheetsByTitle['Transactions'];
      const sheetStudents = doc.sheetsByTitle['Students'];
  
      const books = await sheetBooks.getRows();
      const book = books.find(row => row.code == barkod);
      if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });
  
      const transactions = await sheetTrans.getRows();
      const activeTrans = transactions.find(row => row.code == barkod && row.status == 'Active');
      if (!activeTrans) return res.json({ status: 'error', message: 'Bu kitap zaten rafta.' });
  
      const ogrNo = activeTrans.student_no;
      const returnDate = new Date().toLocaleDateString("tr-TR");
      const students = await sheetStudents.getRows();
      const student = students.find(row => row.student_no == ogrNo);
  
      activeTrans.return_date = returnDate;
      activeTrans.status = 'Completed';
      await activeTrans.save();
  
      book.status = 'In'; await book.save();
  
      const mesaj = `<b>"${book.book_name}"</b> adlı kitap <b>${student ? student.student_fullname : 'Bilinmeyen'}</b> isimli öğrenciden alındı.`;
      res.json({ status: 'success', message: mesaj, raf: book.shelf || '?', studentNo: student ? student.student_no : null });
  
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
  });

// F) SORGULA
app.post('/api/sorgula', async (req, res) => {
    try {
      const { schoolCode, schoolPass, query, type } = req.body;
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
  
      if (type === 'book') {
          const books = await sheetBooks.getRows();
          const foundBook = books.find(row => row.code == q);
          if (foundBook) {
              let detail = {
                  name: foundBook.book_name,
                  code: foundBook.code,
                  author: foundBook.author,
                  status: foundBook.status,
                  shelf: foundBook.shelf,
                  holder: null, holderNo: null, date: null
              };
              if (foundBook.status === 'Out') {
                  const transactions = await sheetTrans.getRows();
                  const students = await sheetStudents.getRows();
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
          return res.json({ status: 'error', message: 'Kitap bulunamadı.' });
      }
  
      if (type === 'student') {
          const students = await sheetStudents.getRows();
          const foundStudent = students.find(row => row.student_no == q);
          if (foundStudent) {
              const transactions = await sheetTrans.getRows();
              const books = await sheetBooks.getRows();
              const activeLoans = transactions.filter(t => t.student_no == q && t.status === 'Active');
              let booksHeld = activeLoans.map(loan => {
                  const bookInfo = books.find(b => b.code === loan.code);
                  return { name: bookInfo ? bookInfo.book_name : 'Kitap', code: loan.code, date: loan.borrow_date };
              });
              result.data = {
                  name: foundStudent.student_fullname,
                  no: foundStudent.student_no,
                  class: foundStudent.class,
                  books: booksHeld
              };
              return res.json({ status: 'success', result });
          }
          return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });
      }
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
  });

// G) GECİKENLER (CODE DAHİL EDİLDİ)
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
            code: row.code, // Loans sayfasında 'code' sütunu olmalı
            student: row.student_fullname,
            book: row.book_name,
            date: row.borrow_date
        };
      });
      res.json({ status: 'success', data: list });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
  });

// H) UNDO (GERİ AL)
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
          return res.json({ status: 'success', message: 'İşlem geri alındı.' });
      }
      if (type === 'al') {
          const book = books.find(b => b.code == bookCode);
          if (book) { book.status = 'Out'; await book.save(); }
          const transRows = transactions.filter(t => t.code == bookCode && t.student_no == studentNo && t.status === 'Completed');
          if (transRows.length > 0) {
              const lastTrans = transRows[transRows.length - 1];
              lastTrans.status = 'Active'; lastTrans.return_date = ''; await lastTrans.save();
          }
          return res.json({ status: 'success', message: 'İşlem geri alındı.' });
      }
      res.json({ status: 'error', message: 'Geçersiz işlem.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
  });

// I) ÖĞRENCİ EKLE (SINIF SÜTUNU GÜNCELLENDİ)
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
      res.json({ status: 'success', message: 'Öğrenci eklendi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
  });

// --- SERVER BAŞLAT ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda.`); });