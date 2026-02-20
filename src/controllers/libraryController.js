const { GoogleSpreadsheet } = require('google-spreadsheet');
const { getAuthObject, getSchoolSheetID } = require('../api/googleSheets');

exports.login = async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    const doc = new GoogleSpreadsheet(process.env.MASTER_SHEET_ID);
    await doc.useServiceAccountAuth(getAuthObject());
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['Schools'];
    const rows = await sheet.getRows();
    const school = rows.find(row => row.school_code == schoolCode && row.school_password == schoolPass);
    if (school) res.json({ status: 'success', schoolName: school.school_name || 'Kütüphane' });
    else res.json({ status: 'error', message: 'Hatalı Okul Kodu veya Şifre' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.stats = async (req, res) => {
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
        if (row.title == 'TotalBooks') stats.kitap = row.value;
        if (row.title == 'TotalStudents') stats.ogrenci = row.value;
        if (row.title == 'TotalLoans') stats.emanet = row.value;
    });
    res.json({ status: 'success', data: stats });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.getClasses = async (req, res) => {
    try {
      const { schoolCode, schoolPass } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      const doc = new GoogleSpreadsheet(targetSheetID);
      await doc.useServiceAccountAuth(getAuthObject());
      await doc.loadInfo();
      if (!doc.sheetsByTitle['Classes']) return res.json({ status: 'success', data: [] });
      const sheet = doc.sheetsByTitle['Classes'];
      const rows = await sheet.getRows();
      const classes = rows.map(r => r._rawData[0]).filter(c => c); 
      res.json({ status: 'success', data: classes });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.addBook = async (req, res) => {
    try {
      const { schoolCode, schoolPass, name, author, page, type, shelf, quantity } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      const doc = new GoogleSpreadsheet(targetSheetID);
      await doc.useServiceAccountAuth(getAuthObject());
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle['Books'];
      const rows = await sheet.getRows();
      
      const loopCount = parseInt(quantity) || 1;
      let assignedBarcodes = [];
      let savedCount = 0;
  
      for (let i = 0; i < rows.length; i++) {
          if (savedCount >= loopCount) break;
          if (!rows[i].book_name || rows[i].book_name === '') {
              rows[i].book_name = name; rows[i].author = author; rows[i].page = page;
              rows[i].book_type = type; rows[i].shelf = shelf; rows[i].status = 'In';
              await rows[i].save();
              assignedBarcodes.push(rows[i].code); 
              savedCount++;
          }
      }
      res.json({ status: 'success', message: 'Eklendi', barcodes: assignedBarcodes });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.kitapVer = async (req, res) => {
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
      if (book.status == 'Out') return res.json({ status: 'error', message: 'Kitap başkasında!' });
  
      const student = students.find(row => row.student_no == ogrNo);
      if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı' });
      
      const today = new Date().toLocaleDateString("tr-TR");
      await sheetTrans.addRow({
        transaction_ID: Math.random().toString(36).substr(2, 9),
        code: barkod, student_no: ogrNo, borrow_date: today, status: 'Active'
      });
      book.status = 'Out'; await book.save();
      res.json({ status: 'success', message: `<b>"${book.book_name}"</b> adlı kitap <b>${student.student_fullname}</b> isimli öğrenciye verildi.` });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.kitapAl = async (req, res) => {
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
      const students = await sheetStudents.getRows();
      const student = students.find(row => row.student_no == ogrNo);
  
      activeTrans.return_date = new Date().toLocaleDateString("tr-TR");
      activeTrans.status = 'Completed';
      await activeTrans.save();
      book.status = 'In'; await book.save();
  
      res.json({ status: 'success', message: `<b>"${book.book_name}"</b> adlı kitap <b>${student.student_fullname}</b> isimli öğrenciden teslim alındı. Lütfen kitabı rafa yerleştiriniz.` , raf: book.shelf, studentNo: ogrNo });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.sorgula = async (req, res) => {
    try {
      const { schoolCode, schoolPass, query, type } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      const doc = new GoogleSpreadsheet(targetSheetID);
      await doc.useServiceAccountAuth(getAuthObject());
      await doc.loadInfo();
      const q = query.trim();
  
      if (type === 'book') {
          const sheetBooks = doc.sheetsByTitle['Books'];
          const sheetTrans = doc.sheetsByTitle['Transactions'];
          const sheetStudents = doc.sheetsByTitle['Students'];
          
          const books = await sheetBooks.getRows();
          const foundBook = books.find(row => row.code == q);
          if (!foundBook) return res.json({ status: 'error', message: 'Kitap bulunamadı.' });

          let detail = {
              name: foundBook.book_name, code: foundBook.code, author: foundBook.author,
              status: foundBook.status, shelf: foundBook.shelf, holder: null, holderNo: null, date: null
          };
          if (foundBook.status === 'Out') {
              const transactions = await sheetTrans.getRows();
              const activeTrans = transactions.find(t => t.code === q && t.status === 'Active');
              if (activeTrans) {
                  const students = await sheetStudents.getRows();
                  const student = students.find(s => s.student_no === activeTrans.student_no);
                  detail.holder = student ? student.student_fullname : 'Bilinmiyor';
                  detail.holderNo = activeTrans.student_no;
                  detail.date = activeTrans.borrow_date;
              }
          }
          return res.json({ status: 'success', result: { type: 'book', data: [detail] } });
      }
  
      if (type === 'student') {
          const sheetStudents = doc.sheetsByTitle['Students'];
          const sheetTrans = doc.sheetsByTitle['Transactions'];
          const sheetBooks = doc.sheetsByTitle['Books'];

          const students = await sheetStudents.getRows();
          const foundStudent = students.find(row => row.student_no == q);
          if (!foundStudent) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

          const transactions = await sheetTrans.getRows();
          const books = await sheetBooks.getRows();
          
          const studentTrans = transactions.filter(t => t.student_no == q);
          
          let history = [];
          let totalPages = 0;

          studentTrans.forEach(trans => {
             const bookInfo = books.find(b => b.code === trans.code);
             if(bookInfo) {
                 const p = parseInt(bookInfo.page) || 0;
                 if(trans.status === 'Completed') totalPages += p; 
                 history.push({
                     name: bookInfo.book_name,
                     code: trans.code,
                     date: trans.borrow_date,
                     returnDate: trans.return_date,
                     status: trans.status,
                     pages: p
                 });
             }
          });

          const active = history.filter(h => h.status === 'Active');

          return res.json({ status: 'success', result: { 
              type: 'student', 
              data: {
                  name: foundStudent.student_fullname,
                  no: foundStudent.student_no,
                  class: foundStudent.class,
                  activeBooks: active,
                  history: history,
                  totalReadPages: totalPages,
                  totalReadCount: history.filter(h => h.status === 'Completed').length
              }
          }});
      }
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.addStudent = async (req, res) => {
    try {
      const { schoolCode, schoolPass, no, name, className } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      const doc = new GoogleSpreadsheet(targetSheetID);
      await doc.useServiceAccountAuth(getAuthObject());
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle['Students'];
      const rows = await sheet.getRows();
      if (rows.find(r => r.student_no == no)) return res.json({ status: 'error', message: 'Öğrenci zaten var!' });
      await sheet.addRow({ student_no: no, student_fullname: name, class: className });
      res.json({ status: 'success', message: 'Öğrenci eklendi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.updateStudent = async (req, res) => {
    try {
      const { schoolCode, schoolPass, no, newClass } = req.body;
      const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
      if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      const doc = new GoogleSpreadsheet(targetSheetID);
      await doc.useServiceAccountAuth(getAuthObject());
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle['Students'];
      const rows = await sheet.getRows();
      
      const student = rows.find(r => r.student_no == no);
      if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı!' });

      student.class = newClass;
      await student.save();

      res.json({ status: 'success', message: 'Öğrenci sınıfı güncellendi.', studentName: student.student_fullname });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.getReport = async (req, res) => {
    try {
        const { schoolCode, schoolPass, filterClass, filterMonth } = req.body;
        const targetSheetID = await getSchoolSheetID(schoolCode, schoolPass);
        if (!targetSheetID) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        
        const doc = new GoogleSpreadsheet(targetSheetID);
        await doc.useServiceAccountAuth(getAuthObject());
        await doc.loadInfo();

        const sheetTrans = doc.sheetsByTitle['Transactions'];
        const sheetBooks = doc.sheetsByTitle['Books'];
        const sheetStudents = doc.sheetsByTitle['Students'];

        const transactions = await sheetTrans.getRows();
        const books = await sheetBooks.getRows();
        const students = await sheetStudents.getRows();

        const bookMap = {};
        books.forEach(b => { bookMap[b.code] = { name: b.book_name, page: parseInt(b.page) || 0 }; });

        const studentMap = {};
        students.forEach(s => { studentMap[s.student_no] = { name: s.student_fullname, class: s.class }; });

        let reportData = {};

        transactions.forEach(t => {
            if (t.status === 'Completed') {
                const borrowDate = t.borrow_date; 
                const borrowMonth = borrowDate.split('.')[1]; 
                
                if (filterMonth !== 'ALL' && borrowMonth !== filterMonth) return;

                const std = studentMap[t.student_no];
                const book = bookMap[t.code];

                if (std && book) {
                    if (filterClass !== 'ALL' && std.class !== filterClass) return;

                    if (!reportData[t.student_no]) {
                        reportData[t.student_no] = { name: std.name, className: std.class, totalPage: 0, books: [] };
                    }
                    
                    reportData[t.student_no].totalPage += book.page;
                    reportData[t.student_no].books.push({ name: book.name, page: book.page });
                }
            }
        });

        let sortedReport = Object.values(reportData).sort((a, b) => b.totalPage - a.totalPage);
        res.json({ status: 'success', data: sortedReport });

    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.overdue = async (req, res) => {
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
      const list = rows.filter(r => r.overdues === 'Late').map(r => ({ code: r.code, student: r.student_fullname, book: r.book_name, date: r.borrow_date }));
      res.json({ status: 'success', data: list });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.undo = async (req, res) => {
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
      }
      if (type === 'al') {
          const book = books.find(b => b.code == bookCode);
          if (book) { book.status = 'Out'; await book.save(); }
          const transRows = transactions.filter(t => t.code == bookCode && t.student_no == studentNo && t.status === 'Completed');
          if (transRows.length > 0) { const l = transRows[transRows.length - 1]; l.status = 'Active'; l.return_date = ''; await l.save(); }
      }
      res.json({ status: 'success', message: 'Geri alındı.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};