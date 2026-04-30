const supabase = require('../api/supabase');

// --- ORTAK KULLANIM İÇİN OKUL BULUCU ---
async function getSchoolAuth(code, pass) {
    const { data } = await supabase.from('schools')
        .select('id, kt_status, kt_start_date, kt_end_date, kt_pass, kt_settings')
        .eq('school_code', code)
        .single();

    if (!data) return null;

    const settings = data.kt_settings || {};
    let role = null;
    let app_roles = null;

    if (data.kt_pass === pass) {
        role = 'admin';
    } else if (
        (data.kt_settings?.fixed_staff_password && data.kt_settings.fixed_staff_password === pass) ||
        (data.kt_settings?.daily_staff_password && data.kt_settings.daily_staff_password === pass) ||
        (data.kt_settings?.staff_password && data.kt_settings.staff_password === pass)
    ) {
        role = 'duty';

        // 🚀 MİMARIN ZAMAN DÜZELTMESİ: Sunucu nerede olursa olsun İstanbul saatine bak!
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        if (pass === data.kt_settings?.daily_staff_password) {
            if (data.kt_settings?.daily_pass_date !== todayStr) {
                throw new Error('Personel şifresinin süresi dolmuş. Lütfen güncel şifreyi öğrenin.');
            }
        } else if (pass === data.kt_settings?.staff_password && data.kt_settings?.staff_pass_mode === 'daily') {
            if (data.kt_settings?.staff_pass_date !== todayStr) {
                throw new Error('Personel şifresinin süresi dolmuş. Lütfen güncel şifreyi öğrenin.');
            }
        }
    } else {
        // Personel/Yönetici users tablosundan kontrol
        const { data: user } = await supabase.from('users')
            .select('id, role, app_roles')
            .eq('school_id', data.id)
            .eq('password', pass)
            .limit(1);
        if (user && user.length > 0) {
            role = user[0].role; // 'admin' veya 'teacher' vb
            app_roles = user[0].app_roles;
        } else {
            return null;
        }
    }

    if (data.kt_status !== 'active') throw new Error('Abonelik süreniz dolmuştur. Uygulamayı kullanmak için lütfen aboneliğinizi yenileyiniz.');

    const today = new Date();
    const startDate = new Date(data.kt_start_date);
    const endDate = new Date(data.kt_end_date);
    endDate.setHours(23, 59, 59, 999);
    if (today < startDate || today > endDate) throw new Error('Abonelik süreniz dolmuştur.');

    return { id: data.id, role, app_roles, settings };
}

async function getSchoolId(code, pass) {
    const auth = await getSchoolAuth(code, pass);
    return auth ? auth.id : null;
}

exports.login = async (req, res) => {
    try {
        // Frontend'in ne gönderdiğini görmek için HER ŞEYİ logluyoruz:
        console.log("🚨 FRONTEND'DEN GELEN TÜM VERİ:", req.body);

        const { schoolCode, schoolPass, loginType } = req.body;

        // Eğer frontend "identity" yerine "username" veya "email" gönderiyorsa onu da yakala:
        const identity = req.body.identity || req.body.username || req.body.email || req.body.phone || "";

        // -------------------------
        // 1. NÖBETÇİ GİRİŞİ (DUTY)
        // -------------------------
        if (loginType === 'duty') {
            const auth = await getSchoolAuth(schoolCode, schoolPass);
            if (!auth || auth.role !== 'duty') return res.json({ status: 'error', message: 'Hatalı Okul Kodu veya Nöbetçi Şifresi' });

            const { data: school } = await supabase.from('schools')
                .select('school_name, kt_settings')
                .eq('id', auth.id)
                .single();

            let userName = "";
            const settings = school.kt_settings || {};

            if (settings.fixed_staff_password && schoolPass === settings.fixed_staff_password) {
                userName = settings.fixed_staff_name || "Sabit Görevli";
            } else if (settings.daily_staff_password && schoolPass === settings.daily_staff_password) {
                userName = settings.daily_staff_names || "Nöbetçi Öğrenci";
            } else if (settings.staff_password && schoolPass === settings.staff_password) {
                userName = settings.staff_names || "Nöbetçi";
            } else {
                return res.json({ status: 'error', message: 'Hatalı Şifre' });
            }

            return res.json({
                status: 'success',
                schoolName: school.school_name,
                userName: userName,
                role: 'duty',
                kt_role: 'duty',
                kt_classes: ['ALL']
            });
        }

        // -------------------------
        // 2. PERSONEL GİRİŞİ (STAFF) - GÜNCELLENMİŞ VE LOGLU
        // -------------------------
        if (loginType === 'staff') {
            const identity = req.body.identity || req.body.username || req.body.email || req.body.phone || "";
            console.log("🔍 GİRİŞ DENEMESİ - Kimlik:", identity, "Okul:", schoolCode);

            const { data: school } = await supabase.from('schools')
                .select('id, school_name, kt_status, kt_start_date, kt_end_date')
                .eq('school_code', schoolCode)
                .maybeSingle();

            if (!school) return res.json({ status: 'error', message: 'Geçersiz Okul Kodu.' });

            const { data: users, error } = await supabase.from('users')
                .select('*, full_name')
                .eq('school_id', school.id)
                .eq('password', schoolPass);

            if (error) throw error;

            const user = users?.find(u =>
                u.email === identity ||
                u.username === identity ||
                (identity.replace(/\D/g, '') && u.phone === identity.replace(/\D/g, '').replace(/^0/, '').replace(/^90/, ''))
            );

            if (user) {
                // --- KRİTİK LOGLAMA BAŞLADI ---
                console.log("✅ KULLANICI BULUNDU:", user.full_name);
                console.log("📊 ANA ROL (user.role):", user.role);
                console.log("📦 HAM APP_ROLES:", user.app_roles);

                let appRoles = user.app_roles;
                if (typeof appRoles === 'string') {
                    try { appRoles = JSON.parse(appRoles); } catch (e) {
                        console.error("❌ JSON PARSE HATASI:", e.message);
                        appRoles = {};
                    }
                }
                appRoles = appRoles || {};

                const ktRole = appRoles.kutuphanemiz?.role;
                const ktClasses = appRoles.kutuphanemiz?.classes || [];

                console.log("🔑 KUTUPHANEMİZ ROLÜ:", ktRole);
                console.log("🏫 YETKİLİ SINIFLAR:", ktClasses);
                // --- KRİTİK LOGLAMA BİTTİ ---

                if (user.role === 'admin' || ktRole === 'admin') {
                    console.log("⭐ SONUÇ: ADMIN OLARAK ALINIYOR");
                    return res.json({
                        status: 'success',
                        schoolName: school.school_name,
                        userName: user.full_name,
                        role: user.role,
                        kt_role: 'admin',
                        kt_classes: ['ALL']
                    });
                } else if (ktRole === 'teacher') {
                    console.log("📝 SONUÇ: ÖĞRETMEN OLARAK ALINIYOR");
                    return res.json({
                        status: 'success',
                        schoolName: school.school_name,
                        userName: user.full_name,
                        role: user.role,
                        kt_role: 'teacher',
                        kt_classes: ktClasses
                    });
                } else {
                    console.warn("🚫 SONUÇ: YETKİSİZ (Neither admin nor teacher in JSON)");
                    return res.status(403).json({ status: 'error', message: 'Kütüphane sistemine erişim yetkiniz yok.' });
                }
            }
            return res.json({ status: 'error', message: 'Hatalı Kimlik veya Şifre.' });
        }

        return res.json({ status: 'error', message: 'Geçersiz giriş tipi.' });

    } catch (error) {
        return res.status(401).json({ status: 'error', message: error.message });
    }
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

        const { error } = await supabase.from('schools').update({ kt_pass: newPassword, reset_code: null }).eq('id', school.id);
        if (error) throw error;

        res.json({ status: 'success', message: 'Şifreniz başarıyla güncellendi!' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.changePassword = async (req, res) => {
    try {
        const { schoolCode, schoolPass, oldPassword, newPassword } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (auth.role !== 'admin') {
            return res.json({ status: 'error', message: 'Sadece idareciler şifre değiştirebilir.' });
        }

        const { data: school } = await supabase.from('schools').select('kt_pass').eq('id', auth.id).single();
        if (!school || school.kt_pass !== oldPassword) {
            return res.status(400).json({ status: 'error', message: 'Mevcut şifreniz hatalı.' });
        }

        const { error } = await supabase.from('schools').update({ kt_pass: newPassword }).eq('id', auth.id);
        if (error) throw error;

        res.json({ status: 'success', message: 'Şifreniz başarıyla güncellendi.' });
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

        // KRİTİK: Herhangi bir sorguda Supabase hatası varsa yakala ve catch bloğuna fırlat
        if (books.error) throw books.error;
        if (students.error) throw students.error;
        if (loans.error) throw loans.error;

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
                    .select('borrow_date, students(student_no, full_name, class_name, grade), books(barcode, book_name)')
                    .eq('school_id', schoolId).eq('status', 'borrowed')
                    .order('borrow_date', { ascending: false });
            } else if (type === 'kitap') {
                query = supabase.from('books')
                    .select('barcode, book_name, author, shelf, condition')
                    .eq('school_id', schoolId).eq('is_active', true)
                    .order('book_name', { ascending: true });
            } else if (type === 'ogrenci') {
                query = supabase.from('students')
                    .select('student_no, full_name, class_name, grade')
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

        const { data } = await supabase.from('students').select('grade, class_name').eq('school_id', schoolId).eq('is_active', true);

        const grades = [...new Set(data.map(s => s.grade).filter(Boolean))].sort((a, b) => a - b);
        const classes = [...new Set(data.map(s => s.class_name).filter(Boolean))].sort();

        res.json({ status: 'success', data: { grades, classes } });
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

exports.bulkAddBooks = async (req, res) => {
    try {
        const { schoolCode, schoolPass, data } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const mappedData = data.map(item => ({
            ...item,
            school_id: auth.id,
            status: 'available',
            is_active: true
        }));

        const { error } = await supabase.from('books').insert(mappedData);
        if (error) throw error;

        res.json({ status: 'success', message: 'Toplu kitap ekleme başarılı' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.kitapVer = async (req, res) => {
    try {
        const { schoolCode, schoolPass, barkod, ogrNo, condition, handlerName } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const schoolId = auth.id;
        const settings = auth.settings;

        if (settings.lib_open_time && settings.lib_close_time) {
            const currentHourStr = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });
            if (currentHourStr < settings.lib_open_time || currentHourStr > settings.lib_close_time) {
                return res.json({ status: 'error', message: `Mesai saatleri dışındasınız. Kütüphane çalışma saatleri: ${settings.lib_open_time} - ${settings.lib_close_time}` });
            }
        }

        const [bookRes, studentRes] = await Promise.all([
            supabase.from('books').select('id, book_name, status, condition').eq('school_id', schoolId).eq('barcode', barkod).single(),
            supabase.from('students').select('id, full_name').eq('school_id', schoolId).eq('student_no', ogrNo).single()
        ]);

        const book = bookRes.data;
        const student = studentRes.data;

        if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });
        if (book.status === 'borrowed') return res.json({ status: 'error', message: 'Kitap başkasında!' });
        if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı' });

        const { count: activeCount } = await supabase.from('transactions')
            .select('id', { count: 'exact', head: true })
            .eq('school_id', schoolId)
            .eq('student_id', student.id)
            .eq('status', 'borrowed');

        const limit = settings.max_borrow_limit !== undefined ? settings.max_borrow_limit : 2;
        if (activeCount >= limit) {
            return res.json({ status: 'error', message: `Öğrenci kitap alma sınırını aşmıştır. (Maksimum: ${limit})` });
        }

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

        const [transRes, bookUpdRes] = await Promise.all([
            supabase.from('transactions').insert([{ school_id: schoolId, student_id: student.id, book_id: book.id, status: 'borrowed', borrow_date: today, academic_year: academicYear, handed_by: handlerName || 'Bilinmeyen', borrow_condition: condition || book.condition }]),
            supabase.from('books').update(updateData).eq('id', book.id)
        ]);

        // KRİTİK: Yazma işlemlerinden biri bile hata verirse sistemi try/catch'e düşür
        if (transRes.error) throw transRes.error;
        if (bookUpdRes.error) throw bookUpdRes.error;

        res.json({ status: 'success', message: `<b>"${book.book_name}"</b> adlı kitap <b>${student.full_name}</b> isimli öğrenciye verildi.` });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};


exports.kitapAl = async (req, res) => {
    try {
        const { schoolCode, schoolPass, barkod, condition, handlerName } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        const schoolId = auth.id;
        const settings = auth.settings;

        if (settings.lib_open_time && settings.lib_close_time) {
            const currentHourStr = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });
            if (currentHourStr < settings.lib_open_time || currentHourStr > settings.lib_close_time) {
                return res.json({ status: 'error', message: `Mesai saatleri dışındasınız. Kütüphane çalışma saatleri: ${settings.lib_open_time} - ${settings.lib_close_time}` });
            }
        }

        const { data: book } = await supabase.from('books').select('id, book_name, shelf, status, condition').eq('school_id', schoolId).eq('barcode', barkod).single();
        if (!book) return res.json({ status: 'error', message: 'Kitap bulunamadı' });
        if (book.status === 'available') return res.json({ status: 'error', message: 'Bu kitap zaten rafta.' });

        // Aktif işlemi ve öğrenciyi bul
        const { data: trans } = await supabase.from('transactions').select('id, borrow_date, student_id, students(student_no, full_name)').eq('book_id', book.id).eq('status', 'borrowed').single();

        if (!trans) return res.json({ status: 'error', message: 'Aktif bir ödünç işlemi bulunamadı.' });

        const minDays = settings.min_borrow_days !== undefined ? settings.min_borrow_days : 1;
        const bDate = new Date(trans.borrow_date);
        const diffDays = Math.floor(Math.abs(new Date() - bDate) / (1000 * 60 * 60 * 24));
        if (diffDays < minDays) {
            return res.json({ status: 'error', message: `Bu kitabı henüz iade edemezsiniz, okumak için daha fazla zaman ayırın. (En az ${minDays} gün okunmalı)` });
        }

        const today = new Date().toISOString();

        let updateData = { status: 'available' };
        if (condition) updateData.condition = condition;

        // Transaction tablosunda "received_by" güncellenerek teslim edenin adı loglanır.
        const [transRes, bookUpdRes] = await Promise.all([
            supabase.from('transactions').update({ status: 'returned', return_date: today, received_by: handlerName || 'Bilinmeyen', return_condition: condition || book.condition }).eq('id', trans.id),
            supabase.from('books').update(updateData).eq('id', book.id)
        ]);

        // KRİTİK: Yazma işlemlerinden biri bile hata verirse sistemi try/catch'e düşür
        if (transRes.error) throw transRes.error;
        if (bookUpdRes.error) throw bookUpdRes.error;

        res.json({ status: 'success', message: `<b>"${book.book_name}"</b> adlı kitap <b>${trans.students.full_name}</b> isimli öğrenciden teslim alındı. Lütfen kitabı rafa yerleştiriniz.`, raf: book.shelf, studentNo: trans.students.student_no });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.addStudent = async (req, res) => {
    try {
        const { schoolCode, schoolPass, no, name, grade, className } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const { error } = await supabase.from('students').insert([{ school_id: schoolId, student_no: no, full_name: name, grade: grade, class_name: className }]);
        if (error && error.code === '23505') return res.json({ status: 'error', message: 'Öğrenci zaten var!' }); // Unique hatası

        res.json({ status: 'success', message: 'Öğrenci eklendi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.bulkAddStudents = async (req, res) => {
    try {
        const { schoolCode, schoolPass, data } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const mappedData = data.map(item => ({
            ...item,
            school_id: auth.id,
            is_active: true
        }));

        const { error } = await supabase.from('students').insert(mappedData);
        if (error) throw error;

        res.json({ status: 'success', message: 'Toplu öğrenci ekleme başarılı' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.updateStudent = async (req, res) => {
    try {
        const { schoolCode, schoolPass, no, newGrade, newClass } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const { data, error } = await supabase.from('students').update({ grade: newGrade, class_name: newClass }).eq('school_id', schoolId).eq('student_no', no).select().single();
        if (!data) return res.json({ status: 'error', message: 'Öğrenci bulunamadı!' });

        res.json({ status: 'success', message: 'Öğrenci sınıfı güncellendi.', studentName: data.full_name });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.searchStudentsAdvanced = async (req, res) => {
    try {
        const { schoolCode, schoolPass, query } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        let orQuery = `full_name.ilike.%${query}%`;
        if (!isNaN(query) && query.trim() !== '') {
            orQuery += `,student_no.eq.${query}`;
        }

        const { data, error } = await supabase.from('students')
            .select('full_name, student_no, grade, class_name')
            .eq('school_id', schoolId)
            .or(orQuery)
            .eq('is_active', true)
            .limit(20);

        if (error) throw error;

        res.json({ status: 'success', data: data || [] });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.updateStudentDetailed = async (req, res) => {
    try {
        const { schoolCode, schoolPass, oldNo, newNo, newName, newGrade, newClass } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const { data, error } = await supabase.from('students')
            .update({ full_name: newName, student_no: newNo, grade: newGrade, class_name: newClass })
            .eq('school_id', schoolId)
            .eq('student_no', oldNo)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.json({ status: 'error', message: 'Bu öğrenci numarası sistemde zaten kayıtlı!' });
            throw error;
        }
        if (!data) return res.json({ status: 'error', message: 'Öğrenci bulunamadı!' });

        res.json({ status: 'success', message: 'Öğrenci bilgileri güncellendi.', data: data });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

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

            return res.json({
                status: 'success', result: {
                    type: 'student',
                    data: {
                        name: student.full_name, no: student.student_no,
                        grade: student.grade, className: student.class_name,
                        activeBooks: activeBooks, history: history,
                        totalReadPages: totalPages, totalReadCount: history.filter(h => h.status === 'Completed').length
                    }
                }
            });
        }
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};



// ==========================================
// RAPORLAR (Şampiyonlar Ligi)
// ==========================================
exports.getReport = async (req, res) => {
    try {
        const { schoolCode, schoolPass, filterGrade, filterClass, filterMonth } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        // Mükemmel SQL Sorgusu: Sadece teslim edilmiş kitapları, öğrenci ve kitap bilgileriyle getir
        let query = supabase.from('transactions')
            .select('borrow_date, students!inner(student_no, full_name, class_name, grade), books!inner(book_name, page_count)')
            .eq('school_id', schoolId).eq('status', 'returned');

        if (filterGrade && filterGrade !== 'ALL') query = query.eq('students.grade', filterGrade);
        if (filterClass && filterClass !== 'ALL') query = query.eq('students.class_name', filterClass);

        const { data: transactions, error } = await query;
        if (error) throw error; // KRİTİK: Supabase veritabanı hatalarını try/catch bloğuna düşürür

        let reportData = {};

        if (transactions && transactions.length > 0) {
            reportData = transactions.reduce((acc, t) => {
                const borrowDate = new Date(t.borrow_date);
                const monthStr = ("0" + (borrowDate.getMonth() + 1)).slice(-2); // "01", "09" gibi ay formatı

                if (filterMonth && filterMonth !== 'ALL') {
                    const fMonthStr = String(filterMonth).trim().toUpperCase();
                    if (fMonthStr === 'TERM1') {
                        if (!['07', '08', '09', '10', '11', '12', '01'].includes(monthStr)) return acc;
                    } else if (fMonthStr === 'TERM2') {
                        if (!['02', '03', '04', '05', '06'].includes(monthStr)) return acc;
                    } else {
                        const targetMonth = String(filterMonth).trim().padStart(2, '0');
                        if (monthStr !== targetMonth) return acc;
                    }
                }

                const sNo = t.students.student_no;
                if (!acc[sNo]) {
                    const cName = t.students.grade ? `${t.students.grade}/${t.students.class_name}` : t.students.class_name;
                    acc[sNo] = { name: t.students.full_name, className: cName, totalPage: 0, books: [] };
                }

                const p = t.books.page_count || 0;
                acc[sNo].totalPage += p;
                acc[sNo].books.push({ name: t.books.book_name, page: p });

                return acc;
            }, {});
        }

        let sortedReport = Object.values(reportData).sort((a, b) => b.totalPage - a.totalPage);
        res.json({ status: 'success', data: sortedReport });

    } catch (error) { res.status(500).json({ status: 'error', message: 'Sunucu Hatası: ' + (error.message || JSON.stringify(error) || error) }); }
};

// ==========================================
// GECİKEN KİTAPLAR (15 Günü Aşanlar)
// ==========================================
exports.overdue = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const { data: activeTrans, error } = await supabase.from('transactions')
            .select('borrow_date, students!inner(full_name, grade, class_name), books!inner(barcode, book_name)')
            .eq('school_id', schoolId).eq('status', 'borrowed');

        if (error) throw error; // KRİTİK: Supabase hatalarını yakala ve try/catch'e düşür

        const now = new Date();
        let list = [];

        if (activeTrans && activeTrans.length > 0) {
            list = activeTrans.reduce((acc, t) => {
                const bDate = new Date(t.borrow_date);
                const diffDays = Math.ceil(Math.abs(now - bDate) / (1000 * 60 * 60 * 24));

                if (diffDays > 15) { // 15 gün sınırı
                    const sName = t.students.grade ? `${t.students.full_name} (${t.students.grade}/${t.students.class_name})` : t.students.full_name;
                    acc.push({ code: t.books.barcode, student: sName, book: t.books.book_name, date: bDate.toLocaleDateString("tr-TR") });
                }
                return acc;
            }, []);
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
                await supabase.from('transactions').update({ status: 'borrowed', return_date: null, return_condition: null, received_by: null }).eq('id', trans.id);
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
            const { data: student } = await supabase.from('students').select('id').eq('school_id', schoolId).eq('student_no', code).single();
            if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

            const { count: activeTransCount } = await supabase.from('transactions')
                .select('id', { count: 'exact', head: true })
                .eq('school_id', schoolId)
                .eq('student_id', student.id)
                .eq('status', 'borrowed');

            if (activeTransCount && activeTransCount > 0) {
                return res.json({ status: 'error', message: 'Bu öğrencinin üzerinde teslim edilmemiş kitap bulunuyor. Önce kitapları iade almalısınız!' });
            }

            await supabase.from('students').update({ is_active: false }).eq('id', student.id);
        } else {
            return res.json({ status: 'error', message: 'Geçersiz işlem tipi.' });
        }

        res.json({ status: 'success', message: 'Kayıt başarıyla arşive gönderildi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// AYARLAR (YÖNETİM PANELİ)
// ==========================================
exports.getSettings = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        res.json({ status: 'success', data: auth.settings });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

exports.updateSettings = async (req, res) => {
    try {
        const { schoolCode, schoolPass, settings } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!(auth.role === 'admin' || auth.app_roles?.kutuphanemiz?.role === 'admin')) {
            return res.json({ status: 'error', message: 'Bu işlem için yetkiniz yok.' });
        }

        const updatedSettings = { ...auth.settings, ...settings };

        Object.keys(updatedSettings).forEach(key => {
            if (updatedSettings[key] === null) delete updatedSettings[key];
        });

        const { error } = await supabase.from('schools').update({ kt_settings: updatedSettings }).eq('id', auth.id);
        if (error) throw error;

        res.json({ status: 'success', message: 'Ayarlar güncellendi.' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: ÖĞRENCİ NUMARASI İLE BULMA (NÖBETÇİ İÇİN)
// ==========================================
exports.getStudentByNo = async (req, res) => {
    try {
        const { schoolCode, schoolPass, studentNo } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const { data: student } = await supabase.from('students')
            .select('full_name')
            .eq('school_id', auth.id)
            .eq('student_no', studentNo)
            .single();

        if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

        res.json({ status: 'success', data: student });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: İŞLEM GEÇMİŞİ LOGLARI (OMNI-SEARCH İÇİN)
// ==========================================
exports.getLogs = async (req, res) => {
    try {
        const { schoolCode, schoolPass, filterDate } = req.body;
        const schoolId = await getSchoolId(schoolCode, schoolPass);
        if (!schoolId) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        let query = supabase.from('transactions')
            .select('id, created_at, borrow_date, return_date, status, handed_by, received_by, academic_year, borrow_condition, return_condition, students(student_no, full_name, grade, class_name), books(barcode, book_name)')
            .eq('school_id', schoolId)
            .order('created_at', { ascending: false })
            .limit(100);

        if (filterDate) {
            query = query.gte('created_at', `${filterDate}T00:00:00`).lte('created_at', `${filterDate}T23:59:59`);
        }

        const { data: logs, error } = await query;
        if (error) throw error;

        res.json({ status: 'success', data: logs || [] });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
};

// ==========================================
// YENİ: ÖĞRETMEN YETKİLENDİRME (ADMİN İÇİN)
// ==========================================
exports.getTeachers = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);

        if (!auth || auth.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Yetkisiz erişim. Sadece yöneticiler öğretmen listeleyebilir.' });
        }

        const { data: teachers, error } = await supabase.from('users')
            .select('id, full_name, username, email, phone, app_roles')
            .eq('school_id', auth.id)
            .eq('role', 'teacher');

        if (error) throw error;

        res.json({ status: 'success', data: teachers });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.saveTeacher = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id, fullName, username, email, phone, password, ktRole, ktClasses } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);

        if (!auth || auth.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Yetkisiz erişim. Sadece yöneticiler yetki değiştirebilir.' });
        }

        const appRolesPayload = {
            kutuphanemiz: {
                role: ktRole,
                classes: ktClasses || []
            }
        };

        if (id) {
            // GÜNCELLEME İŞLEMİ
            const { data: user, error: fetchError } = await supabase.from('users')
                .select('app_roles')
                .eq('id', id)
                .eq('school_id', auth.id)
                .single();

            if (fetchError || !user) throw new Error("Öğretmen bulunamadı.");

            let mergedRoles = user.app_roles;
            if (typeof mergedRoles === 'string') {
                try { mergedRoles = JSON.parse(mergedRoles); } catch (e) { mergedRoles = {}; }
            }
            mergedRoles = mergedRoles || {};
            mergedRoles.kutuphanemiz = appRolesPayload.kutuphanemiz;

            const updateData = {
                full_name: fullName,
                username: username || null,
                email: email || null,
                phone: phone || null,
                app_roles: mergedRoles
            };

            if (password && password.trim() !== '') {
                updateData.password = password;
            }

            const { error: updateError } = await supabase.from('users')
                .update(updateData)
                .eq('id', id);

            if (updateError) throw updateError;
            return res.json({ status: 'success', message: 'Öğretmen başarıyla güncellendi.' });

        } else {
            // YENİ EKLEME İŞLEMİ
            if (!password) throw new Error("Yeni eklerken şifre belirlemek zorunludur.");

            const insertData = {
                school_id: auth.id,
                role: 'teacher',
                full_name: fullName,
                username: username || null,
                email: email || null,
                phone: phone || null,
                password: password,
                app_roles: appRolesPayload
            };

            const { error: insertError } = await supabase.from('users')
                .insert([insertData]);

            if (insertError) {
                if (insertError.code === '23505') throw new Error("Bu kullanıcı bilgisi sistemde zaten kayıtlı.");
                throw insertError;
            }

            return res.json({ status: 'success', message: 'Öğretmen başarıyla eklendi.' });
        }

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: KİTAP ARAMA
// ==========================================
exports.searchBooks = async (req, res) => {
    try {
        const { schoolCode, schoolPass, query } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!query || query.trim().length < 1) {
            return res.json({ status: 'error', message: 'Arama terimi gereklidir.' });
        }

        const q = query.trim();

        const { data: books, error } = await supabase.from('books')
            .select('id, barcode, book_name, author, publisher, shelf, category, page_count, condition, status')
            .eq('school_id', auth.id)
            .eq('is_active', true)
            .or(`barcode.ilike.%${q}%,book_name.ilike.%${q}%`)
            .limit(20);

        if (error) throw error;

        // status alanını kullanıcı dostu hale getir
        const mapped = (books || []).map(b => ({
            ...b,
            status: b.status === 'borrowed' ? 'Emanette' : 'Rafta'
        }));

        res.json({ status: 'success', data: mapped });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: KİTAP GÜNCELLEME
// ==========================================
exports.updateBook = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id, barcode, book_name, author, publisher, shelf, category, page_count, condition } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!id) throw new Error('Güncellenecek kitap ID\'si belirtilmedi.');
        if (!book_name || !barcode) throw new Error('Kitap Adı ve Barkod zorunludur.');

        const updateData = {
            barcode,
            book_name,
            author: author || null,
            publisher: publisher || null,
            shelf: shelf || null,
            category: category || null,
            page_count: page_count ? parseInt(page_count) : null,
            condition: condition || 'Yeni'
        };

        const { error } = await supabase.from('books')
            .update(updateData)
            .eq('id', id)
            .eq('school_id', auth.id);

        if (error) throw error;

        res.json({ status: 'success', message: 'Kitap başarıyla güncellendi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: KİTAP SİLME (SADECE ADMİN)
// ==========================================
exports.deleteBook = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);

        if (!auth || auth.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Yetkisiz erişim. Sadece yöneticiler kitap silebilir.' });
        }

        if (!id) throw new Error('Silinecek kitap ID\'si belirtilmedi.');

        const { error } = await supabase.from('books')
            .delete()
            .eq('id', id)
            .eq('school_id', auth.id);

        if (error) throw error;

        res.json({ status: 'success', message: 'Kitap sistemden tamamen silindi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: ÖĞRETMEN SİLME (SADECE ADMİN)
// ==========================================
exports.deleteTeacher = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);

        if (!auth || auth.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Yetkisiz erişim. Sadece yöneticiler öğretmen silebilir.' });
        }

        if (!id) throw new Error("Silinecek öğretmen ID\'si belirtilmedi.");

        const { error } = await supabase.from('users')
            .delete()
            .eq('id', id)
            .eq('school_id', auth.id);

        if (error) throw error;

        res.json({ status: 'success', message: 'Öğretmen başarıyla silindi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};