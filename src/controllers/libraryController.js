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

const emailService = require('../api/emailService');

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

exports.forgotPassword = async (req, res) => {
    try {
        const { schoolCode } = req.body;
        const { data: school } = await supabase.from('schools').select('id, school_name, school_email').eq('school_code', schoolCode).single();
        
        if (!school) return res.json({ status: 'error', message: 'Bu koda ait bir okul bulunamadı.' });
        if (!school.school_email) return res.json({ status: 'error', message: 'Bu okul hesabına tanımlı bir e-posta adresi yok. Lütfen sistem yöneticisiyle iletişime geçin.' });

        const resetCode = generateOTP();
        const { error } = await supabase.from('schools').update({ reset_code: resetCode }).eq('id', school.id);
        if (error) throw error;

        const emailSent = await emailService.sendResetCodeEmail(school.school_email, school.school_name, resetCode);
        
        if (emailSent) {
            const maskedEmail = school.school_email.replace(/(.{2})(.*)(?=@)/, (gp1, gp2, gp3) => gp2 + gp3.replace(/./g, '*'));
            res.json({ status: 'success', message: 'Sıfırlama kodu gönderildi.', maskedEmail: maskedEmail });
        } else {
            res.json({ status: 'error', message: 'E-posta gönderilirken bir hata oluştu.' });
        }
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.verifyResetCode = async (req, res) => {
    try {
        const { schoolCode, resetCode } = req.body;
        const { data: school } = await supabase.from('schools').select('id, reset_code').eq('school_code', schoolCode).single();
        
        if (!school || String(school.reset_code) !== String(resetCode)) {
            return res.json({ status: 'error', message: 'Hatalı veya süresi dolmuş kod.' });
        }

        res.json({ status: 'success', message: 'Kod doğrulandı.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.updatePassword = async (req, res) => {
    try {
        const { schoolCode, resetCode, newPassword } = req.body;
        const { data: school } = await supabase.from('schools').select('id, reset_code').eq('school_code', schoolCode).single();
        
        if (!school || String(school.reset_code) !== String(resetCode)) {
            return res.json({ status: 'error', message: 'Güvenlik doğrulaması başarısız oldu.' });
        }

        const { error } = await supabase.from('schools').update({ school_pass: newPassword, reset_code: null }).eq('id', school.id);
        if (error) throw error;

        res.json({ status: 'success', message: 'Şifreniz başarıyla güncellendi!' });
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



exports.statDetails = async (req, res) => {
    try {
        const { schoolCode, schoolPass, type } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        let allData = [];
        let from = 0;
        const step = 1000;
        let fetchMore = true;

        while (fetchMore) {
            let query;
            if (type === 'emanet') {
                query = supabase.from('transactions')
                    .select('borrow_date, students(student_no, full_name, class_name), books(barcode, book_name)')
                    .eq('school_id', schoolId).eq('status', 'borrowed')
                    .order('borrow_date', { ascending: false });
            } else if (type === 'kitap') {
                query = supabase.from('books')
                    .select('barcode, book_name, author, shelf, condition')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('book_name', { ascending: true });
            } else if (type === 'ogrenci') {
                query = supabase.from('students')
                    .select('student_no, full_name, class_name')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('class_name', { ascending: true });
            }

            // Döngü her döndüğünde sayfalamayı (range) ekleyip veriyi çekiyoruz
            const { data } = await query.range(from, from + step - 1);

            if (data && data.length > 0) {
                allData.push(...data);
                from += step;
                if (data.length < step) fetchMore = false; // 1000'den az geldiyse bitti
            } else {
                fetchMore = false; // Veri hiç gelmediyse bitti
            }
        }

        res.json({ status: 'success', data: allData });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.getClasses = async (req, res) => {
    try {
        const { schoolCode, schoolPass, type } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        let allData = [];
        let from = 0;
        const step = 1000;
        let fetchMore = true;

        while (fetchMore) {
            let queryData = null;
            if (type === 'emanet') {
                const { data } = await supabase.from('transactions')
                    .select('borrow_date, students(student_no, full_name, class_name), books(barcode, book_name)')
                    .eq('school_id', schoolId).eq('status', 'borrowed')
                    .order('borrow_date', { ascending: false })
                    .range(from, from + step - 1);
                queryData = data;
            } else if (type === 'kitap') {
                const { data } = await supabase.from('books')
                    .select('barcode, book_name, author, shelf, condition')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('book_name', { ascending: true })
                    .range(from, from + step - 1);
                queryData = data;
            } else if (type === 'ogrenci') {
                const { data } = await supabase.from('students')
                    .select('student_no, full_name, class_name')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('class_name', { ascending: true })
                    .range(from, from + step - 1);
                queryData = data;
            }

            if (queryData && queryData.length > 0) {
                allData.push(...queryData);
                from += step;
                if (queryData.length < step) fetchMore = false; // 1000'den az veri geldiyse son sayfadayız demektir
            } else {
                fetchMore = false; // Veri bitti
            }
        }

        res.json({ status: 'success', data: allData });
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
      const { schoolCode, schoolPass, name, author, page, type, shelf, quantity, condition } = req.body;
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
            author: author, page_count: page, category: type, shelf: shelf, status: 'available', condition: condition || 'Yeni'
        });
        assignedBarcodes.push(newBarcode);
    }


      await supabase.from('books').insert(newBooks);
      res.json({ status: 'success', message: 'Eklendi', barcodes: assignedBarcodes });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.kitapVer = async (req, res) => {
    try {
      const { schoolCode, schoolPass, barkod, ogrNo, condition } = req.body;
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

      // Eğer formdan durum geldiyse (seçildiyse) ekle
      let updateData = { status: 'borrowed' };
      if (condition) updateData.condition = condition;

      await Promise.all([
          supabase.from('transactions').insert([{ school_id: schoolId, student_id: student.id, book_id: book.id, status: 'borrowed', borrow_date: today, academic_year: academicYear }]),
          supabase.from('books').update(updateData).eq('id', book.id)
      ]);

      res.json({ status: 'success', message: `<b>"${book.book_name}"</b> adlı kitap <b>${student.full_name}</b> isimli öğrenciye verildi.` });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};


exports.kitapAl = async (req, res) => {
    try {
      const { schoolCode, schoolPass, barkod, condition } = req.body;
      const schoolId = await getSchoolId(schoolCode, schoolPass);
      if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

      const { data: book } = await supabase.from('books').select('id, book_name, shelf, status').eq('school_id', schoolId).eq('barcode', barkod).single();
      if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });
      if (book.status === 'available') return res.json({ status: 'error', message: 'Bu kitap zaten rafta.' });

      // Aktif işlemi ve öğrenciyi bul
      const { data: trans } = await supabase.from('transactions').select('id, student_id, students(student_no, full_name)').eq('book_id', book.id).eq('status', 'borrowed').single();
      
      const today = new Date().toISOString();

      let updateData = { status: 'available' };
      if (condition) updateData.condition = condition;

      await Promise.all([
          supabase.from('transactions').update({ status: 'returned', return_date: today }).eq('id', trans.id),
          supabase.from('books').update(updateData).eq('id', book.id)
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
            status: book.status === 'borrowed' ? 'Out' : 'In', shelf: book.shelf, condition: book.condition, holder: null, holderNo: null, date: null
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
              .select('borrow_date, return_date, status, books(barcode, book_name, page_count, condition)')
              .eq('student_id', student.id);
          
          let history = []; let activeBooks = []; let totalPages = 0;

          if (transactions) {
              transactions.forEach(t => {
                 const p = t.books.page_count || 0;
                 const isCompleted = t.status === 'returned';
                 if (isCompleted) totalPages += p; 
                 
                 const record = {
                    name: t.books.book_name, code: t.books.barcode, condition: t.books.condition,
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
// ==========================================
// YENİ: GLOBAL KİTAP ÖNERİLERİ
// ==========================================
exports.getGlobalBooks = async (req, res) => {
    try {
        let allBooks = [];
        let from = 0;
        const step = 1000;
        let fetchMore = true;

        // Supabase'in 1000 satır limitini aşmak için verileri parça parça çekiyoruz
        while (fetchMore) {
            const { data } = await supabase
                .from('books')
                .select('book_name')
                .neq('is_active', false)
                .range(from, from + step - 1);

            if (data && data.length > 0) {
                allBooks.push(...data);
                from += step;
                if (data.length < step) fetchMore = false; // 1000'den az geldiyse son sayfadayız demektir
            } else {
                fetchMore = false; // Veri bitti
            }
        }

        if (allBooks.length === 0) return res.json({ status: 'success', data: [] });
        
        // Node.js üzerinde DISTINCT (Benzersizleştirme) ve sıralama işlemi
        const uniqueBooks = [...new Set(allBooks.map(b => b.book_name))].sort();
        res.json({ status: 'success', data: uniqueBooks });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: SOFT-DELETE (ARŞİVLEME)
// ==========================================
exports.archiveRecord = async (req, res) => {
    try {
        const { schoolCode, schoolPass, type, code } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (type === 'book') {
            const { data: book } = await supabase.from('books').select('status').eq('school_id', schoolId).eq('barcode', code).single();
            if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı.' });
            if (book.status === 'borrowed') return res.json({ status: 'error', message: 'Kitap şu an öğrencide, arşive alınamaz!' });

            await supabase.from('books').update({ is_active: false }).eq('school_id', schoolId).eq('barcode', code);
        } else if (type === 'student') {
            await supabase.from('students').update({ is_active: false }).eq('school_id', schoolId).eq('student_no', code);
        } else {
            return res.json({ status: 'error', message: 'Geçersiz işlem tipi.' });
        }

        res.json({ status: 'success', message: 'Kayıt başarıyla arşive gönderildi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};