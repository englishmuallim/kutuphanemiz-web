const supabase = require('../api/supabase');

// --- ORTAK KULLANIM İÇİN OKUL BULUCU ---
async function getSchoolId(code, pass) {
    const { data } = await supabase.from('schools').select('id').eq('school_code', code).eq('school_pass', pass).single();
    return data ? data.id : null;
}

exports.login = async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    const { data: school } = await supabase.from('schools').select('school_name').eq('school_code', schoolCode).eq('school_pass', schoolPass).single();
    if (school) res.json({ status: 'success', schoolName: school.school_name });
    else res.json({ status: 'error', message: 'Hatalı Okul Kodu veya Şifre' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.stats = async (req, res) => {
  try {
    const { schoolCode, schoolPass } = req.body;
    const schoolId = await getSchoolId(schoolCode, schoolPass);
    if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

    // 3 istatistiği aynı anda ve sadece sayı (count) olarak çekiyoruz! Çok hızlı!
    const [books, students, loans] = await Promise.all([
        supabase.from('books').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('is_active', true),
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('is_active', true),
        supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'borrowed')
    ]);

    res.json({ status: 'success', data: { kitap: books.count || 0, ogrenci: students.count || 0, emanet: loans.count || 0 } });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.getClasses = async (req, res) => {
    try {
      const { schoolCode, schoolPass } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      
      const { data } = await supabase.from('students').select('class_name').eq('school_id', schoolId).eq('is_active', true);
      const classes = [...new Set(data.map(s => s.class_name))]; // Benzersiz sınıfları ayıklar
      res.json({ status: 'success', data: classes.sort() });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.addBook = async (req, res) => {
    try {
      const { schoolCode, schoolPass, name, author, page, type, shelf, quantity } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      
      const loopCount = parseInt(quantity) || 1;
      
      // Barkodları otomatik bul ve oluştur (En büyük barkodu bulup +1 ekler)
      const { data: lastBook } = await supabase.from('books').select('barcode').eq('school_id', schoolId).order('barcode', { ascending: false }).limit(1).single();
      
      let startBarcode = lastBook && lastBook.barcode ? parseInt(lastBook.barcode) : 10000;
      let newBooks = [];
      let assignedBarcodes = [];

      for (let i = 1; i <= loopCount; i++) {
          let newBarcode = (startBarcode + i).toString();
          newBooks.push({
              school_id: schoolId, barcode: newBarcode, book_name: name,
              author: author, page_count: page, category: type, shelf: shelf, status: 'available'
          });
          assignedBarcodes.push(newBarcode);
      }

      await supabase.from('books').insert(newBooks);
      res.json({ status: 'success', message: 'Eklendi', barcodes: assignedBarcodes });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.kitapVer = async (req, res) => {
    try {
      const { schoolCode, schoolPass, barkod, ogrNo } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

      const [bookRes, studentRes] = await Promise.all([
          supabase.from('books').select('id, book_name, status').eq('school_id', schoolId).eq('barcode', barkod).single(),
          supabase.from('students').select('id, full_name').eq('school_id', schoolId).eq('student_no', ogrNo).single()
      ]);

      const book = bookRes.data;
      const student = studentRes.data;

      if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });
      if (book.status === 'borrowed') return res.json({ status: 'error', message: 'Kitap başkasında!' });
      if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı' });

      const now = new Date();
      const today = now.toISOString();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0=Ocak, 1=Şubat, ..., 8=Eylül
      
      // Eğer şu an Ağustos'tan (7) önce bir aydaysak, eğitim yılı geçen sene başlamıştır.
      const startYear = currentMonth < 7 ? currentYear - 1 : currentYear;
      const academicYear = `${startYear}-${startYear + 1}`;

      await Promise.all([
          supabase.from('transactions').insert([{ school_id: schoolId, student_id: student.id, book_id: book.id, status: 'borrowed', borrow_date: today, academic_year: academicYear }]),
          supabase.from('books').update({ status: 'borrowed' }).eq('id', book.id)
      ]);

      res.json({ status: 'success', message: `<b>"${book.book_name}"</b> adlı kitap <b>${student.full_name}</b> isimli öğrenciye verildi.` });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.kitapAl = async (req, res) => {
    try {
      const { schoolCode, schoolPass, barkod } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

      const { data: book } = await supabase.from('books').select('id, book_name, shelf, status').eq('school_id', schoolId).eq('barcode', barkod).single();
      if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });
      if (book.status === 'available') return res.json({ status: 'error', message: 'Bu kitap zaten rafta.' });

      // Aktif işlemi ve öğrenciyi bul
      const { data: trans } = await supabase.from('transactions').select('id, student_id, students(student_no, full_name)').eq('book_id', book.id).eq('status', 'borrowed').single();
      
      const today = new Date().toISOString();

      await Promise.all([
          supabase.from('transactions').update({ status: 'returned', return_date: today }).eq('id', trans.id),
          supabase.from('books').update({ status: 'available' }).eq('id', book.id)
      ]);

      res.json({ status: 'success', message: `<b>"${book.book_name}"</b> adlı kitap <b>${trans.students.full_name}</b> isimli öğrenciden teslim alındı. Lütfen kitabı rafa yerleştiriniz.`, raf: book.shelf, studentNo: trans.students.student_no });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.addStudent = async (req, res) => {
    try {
      const { schoolCode, schoolPass, no, name, className } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      
      const { error } = await supabase.from('students').insert([{ school_id: schoolId, student_no: no, full_name: name, class_name: className }]);
      if (error && error.code === '23505') return res.json({ status: 'error', message: 'Öğrenci zaten var!' }); // Unique hatası
      
      res.json({ status: 'success', message: 'Öğrenci eklendi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.updateStudent = async (req, res) => {
    try {
      const { schoolCode, schoolPass, no, newClass } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      
      const { data, error } = await supabase.from('students').update({ class_name: newClass }).eq('school_id', schoolId).eq('student_no', no).select().single();
      if (!data) return res.json({ status: 'error', message: 'Öğrenci bulunamadı!' });
      
      res.json({ status: 'success', message: 'Öğrenci sınıfı güncellendi.', studentName: data.full_name });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// SORGULA (Kitap ve Öğrenci Detayları)
// ==========================================
exports.sorgula = async (req, res) => {
    try {
      const { schoolCode, schoolPass, query, type } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      const q = query.trim();
  
      if (type === 'book') {
          const { data: book } = await supabase.from('books').select('*').eq('school_id', schoolId).eq('barcode', q).single();
          if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı.' });

          let detail = {
              name: book.book_name, code: book.barcode, author: book.author,
              status: book.status === 'borrowed' ? 'Out' : 'In', shelf: book.shelf, holder: null, holderNo: null, date: null
          };

          if (book.status === 'borrowed') {
              // JOIN işlemi: Kitap kimdeyse o öğrencinin bilgilerini de getir!
              const { data: trans } = await supabase.from('transactions')
                  .select('borrow_date, students(student_no, full_name)')
                  .eq('book_id', book.id).eq('status', 'borrowed').single();
              if (trans) {
                  detail.holder = trans.students.full_name;
                  detail.holderNo = trans.students.student_no;
                  detail.date = new Date(trans.borrow_date).toLocaleDateString("tr-TR");
              }
          }
          return res.json({ status: 'success', result: { type: 'book', data: [detail] } });
      }
  
      if (type === 'student') {
          const { data: student } = await supabase.from('students').select('*').eq('school_id', schoolId).eq('student_no', q).single();
          if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

          // JOIN İşlemi: Öğrencinin tüm işlemlerini ve okuduğu kitapların isimlerini/sayfalarını tek seferde çek!
          const { data: transactions } = await supabase.from('transactions')
              .select('borrow_date, return_date, status, books(barcode, book_name, page_count)')
              .eq('student_id', student.id);
          
          let history = []; let activeBooks = []; let totalPages = 0;

          if (transactions) {
              transactions.forEach(t => {
                 const p = t.books.page_count || 0;
                 const isCompleted = t.status === 'returned';
                 if (isCompleted) totalPages += p; 
                 
                 const record = {
                     name: t.books.book_name, code: t.books.barcode,
                     date: new Date(t.borrow_date).toLocaleDateString("tr-TR"),
                     returnDate: t.return_date ? new Date(t.return_date).toLocaleDateString("tr-TR") : '',
                     status: isCompleted ? 'Completed' : 'Active', pages: p
                 };
                 history.push(record);
                 if (!isCompleted) activeBooks.push(record);
              });
          }

          return res.json({ status: 'success', result: { 
              type: 'student', 
              data: {
                  name: student.full_name, no: student.student_no, class: student.class_name,
                  activeBooks: activeBooks, history: history,
                  totalReadPages: totalPages, totalReadCount: history.filter(h => h.status === 'Completed').length
              }
          }});
      }
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// RAPORLAR (Şampiyonlar Ligi)
// ==========================================
exports.getReport = async (req, res) => {
    try {
        const { schoolCode, schoolPass, filterClass, filterMonth } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        
        // Mükemmel SQL Sorgusu: Sadece teslim edilmiş kitapları, öğrenci ve kitap bilgileriyle getir
        let query = supabase.from('transactions')
            .select('borrow_date, students!inner(student_no, full_name, class_name), books!inner(book_name, page_count)')
            .eq('school_id', schoolId).eq('status', 'returned');

        if (filterClass !== 'ALL') query = query.eq('students.class_name', filterClass);

        const { data: transactions } = await query;
        let reportData = {};

        if (transactions) {
            transactions.forEach(t => {
                const borrowDate = new Date(t.borrow_date);
                const monthStr = ("0" + (borrowDate.getMonth() + 1)).slice(-2); // "01", "09" gibi ay formatı

                if (filterMonth !== 'ALL' && monthStr !== filterMonth) return;

                const sNo = t.students.student_no;
                if (!reportData[sNo]) {
                    reportData[sNo] = { name: t.students.full_name, className: t.students.class_name, totalPage: 0, books: [] };
                }
                
                const p = t.books.page_count || 0;
                reportData[sNo].totalPage += p;
                reportData[sNo].books.push({ name: t.books.book_name, page: p });
            });
        }

        let sortedReport = Object.values(reportData).sort((a, b) => b.totalPage - a.totalPage);
        res.json({ status: 'success', data: sortedReport });

    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// GECİKEN KİTAPLAR (15 Günü Aşanlar)
// ==========================================
exports.overdue = async (req, res) => {
    try {
      const { schoolCode, schoolPass } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
      
      const { data: activeTrans } = await supabase.from('transactions')
          .select('borrow_date, students(full_name), books(barcode, book_name)')
          .eq('school_id', schoolId).eq('status', 'borrowed');

      const now = new Date();
      const list = [];

      if (activeTrans) {
          activeTrans.forEach(t => {
              const bDate = new Date(t.borrow_date);
              const diffDays = Math.ceil(Math.abs(now - bDate) / (1000 * 60 * 60 * 24)); 
              
              if (diffDays > 15) { // 15 gün sınırı
                  list.push({ code: t.books.barcode, student: t.students.full_name, book: t.books.book_name, date: bDate.toLocaleDateString("tr-TR") });
              }
          });
      }
      res.json({ status: 'success', data: list });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// GERİ AL (Yanlışlıkla Verilen/Alınan Kitaplar)
// ==========================================
exports.undo = async (req, res) => {
    try {
      const { schoolCode, schoolPass, type, bookCode, studentNo } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

      const { data: book } = await supabase.from('books').select('id').eq('school_id', schoolId).eq('barcode', bookCode).single();
      const { data: student } = await supabase.from('students').select('id').eq('school_id', schoolId).eq('student_no', studentNo).single();

      if (!book || !student) return res.json({ status: 'error', message: 'Kitap veya öğrenci bulunamadı.' });

      if (type === 'ver') {
          // Kitap verme işlemini iptal et: İşlemi sil, kitabı 'available' yap
          const { data: trans } = await supabase.from('transactions').select('id').eq('book_id', book.id).eq('student_id', student.id).eq('status', 'borrowed').single();
          if (trans) {
              await supabase.from('transactions').delete().eq('id', trans.id);
              await supabase.from('books').update({ status: 'available' }).eq('id', book.id);
          }
      } 
      else if (type === 'al') {
          // Kitap alma işlemini iptal et: En son teslimi bul, tekrar 'borrowed' yap
          const { data: trans } = await supabase.from('transactions').select('id').eq('book_id', book.id).eq('student_id', student.id).eq('status', 'returned').order('return_date', { ascending: false }).limit(1).single();
          if (trans) {
              await supabase.from('transactions').update({ status: 'borrowed', return_date: null }).eq('id', trans.id);
              await supabase.from('books').update({ status: 'borrowed' }).eq('id', book.id);
          }
      }
      res.json({ status: 'success', message: 'İşlem başarıyla geri alındı.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};