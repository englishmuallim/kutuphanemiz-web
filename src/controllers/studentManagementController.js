const supabase = require('../api/supabase');
const { getSchoolAuth, isAdmin, isDuplicateStudentConstraintError } = require('./libraryController');
const { getGradesForSchoolType, buildStudentSearchOrFilter, buildGraduatedStudentNo } = require('../utils/studentUtils');
const { removePhotoFile } = require('./studentPhotoController');

// Tek bir yerde sabit: listStudents'ın sayfa sınırı, limitReached hesabı da buna bakar.
const STUDENT_LIST_LIMIT = 500;

// ==========================================
// ÖĞRENCİ LİSTELEME (ARAMA + FİLTRE)
// ==========================================
exports.listStudents = async (req, res) => {
    try {
        const { schoolCode, schoolPass, query, grade, className, status, withoutPhoto } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }

        let dbQuery = supabase.from('students')
            .select('id, student_no, full_name, grade, class_name, is_active, photo_path')
            .eq('school_id', auth.id);

        if (status === 'active') dbQuery = dbQuery.eq('is_active', true);
        else if (status === 'archived') dbQuery = dbQuery.eq('is_active', false);
        // status === 'all' -> filtre yok

        if (grade) dbQuery = dbQuery.eq('grade', grade);
        if (className) dbQuery = dbQuery.eq('class_name', className);
        if (withoutPhoto) dbQuery = dbQuery.is('photo_path', null);

        if (query && query.trim() !== '') {
            const orQueryString = buildStudentSearchOrFilter(query);
            if (orQueryString) dbQuery = dbQuery.or(orQueryString);
        }

        dbQuery = dbQuery
            .order('grade', { ascending: true })
            .order('class_name', { ascending: true })
            .order('full_name', { ascending: true })
            .limit(STUDENT_LIST_LIMIT);

        const { data, error } = await dbQuery;
        if (error) throw error;

        // photo_path istemciye hiç gönderilmez (depolama yolu iç bilgisidir); sadece
        // 350 öğrenci için 350 kez signed URL imzalamamak için has_photo boolean'ı dönülür.
        const result = (data || []).map(({ photo_path, ...rest }) => ({ ...rest, has_photo: !!photo_path }));

        res.json({ status: 'success', data: result, limitReached: result.length >= STUDENT_LIST_LIMIT });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: FOTOĞRAF DURUMU ÖZETİ (sadece yönetici)
// ==========================================
// count:'exact', head:true ile satır çekmeden sadece COUNT(*) yapılır; listStudents'taki
// STUDENT_LIST_LIMIT'ten tamamen bağımsızdır, okulda 500'den fazla öğrenci olsa da doğru sayar.
exports.getStudentPhotoStats = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }

        const [totalRes, withPhotoRes] = await Promise.all([
            supabase.from('students').select('id', { count: 'exact', head: true })
                .eq('school_id', auth.id).eq('is_active', true),
            supabase.from('students').select('id', { count: 'exact', head: true })
                .eq('school_id', auth.id).eq('is_active', true).not('photo_path', 'is', null)
        ]);

        if (totalRes.error) throw totalRes.error;
        if (withPhotoRes.error) throw withPhotoRes.error;

        res.json({
            status: 'success',
            data: { total: totalRes.count || 0, withPhoto: withPhotoRes.count || 0 }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: TOPLU FOTOĞRAF EŞLEŞTİRME İÇİN AKTİF ÖĞRENCİ ROSTER'I (sadece yönetici)
// ==========================================
// listStudents'tan ayrı tutuluyor: o sayfalı arama/filtre için var ve limit(500) ile
// sınırlı; bu endpoint ise toplu zip eşleştirmesi için okulun TÜM aktif öğrencilerini
// (Supabase'in sorgu başına ~1000 satır sınırını range ile sayfalayarak) döner.
exports.getActiveStudentRoster = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }

        const PAGE_SIZE = 1000;
        let allRows = [];
        let from = 0;

        while (true) {
            const { data, error } = await supabase.from('students')
                .select('id, student_no, full_name, grade, class_name, photo_path')
                .eq('school_id', auth.id)
                .eq('is_active', true)
                .order('id', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);
            if (error) throw error;

            allRows = allRows.concat(data || []);
            if (!data || data.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }

        const result = allRows.map(({ photo_path, ...rest }) => ({ ...rest, has_photo: !!photo_path }));

        res.json({ status: 'success', data: result });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// OKUL TÜRÜNE GÖRE KADEME (SINIF) SEÇENEKLERİ
// ==========================================
exports.getGradeOptions = async (req, res) => {
    try {
        const { schoolCode, schoolPass } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        const grades = getGradesForSchoolType(auth.schoolType);
        if (!grades) {
            console.error(`[school_type] Tanınmayan okul türü — schoolId=${auth.id} schoolType=${JSON.stringify(auth.schoolType)}`);
            return res.json({ status: 'error', message: 'Okul türünüz tanınamadı, lütfen yönetici ile iletişime geçin.' });
        }
        res.json({ status: 'success', data: { grades } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// TOPLU AKTARMA (SEÇİLİ ÖĞRENCİLERİN KADEME/ŞUBESİNİ TOPLU GÜNCELLEME)
// ==========================================
exports.bulkTransferStudents = async (req, res) => {
    try {
        const { schoolCode, schoolPass, studentIds, grade, className } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }

        const ids = Array.isArray(studentIds) ? studentIds.filter(Boolean) : [];
        if (ids.length === 0) {
            return res.json({ status: 'error', message: 'Aktarılacak öğrenci bulunamadı.' });
        }
        if (!grade || !className) {
            return res.json({ status: 'error', message: 'Yeni kademe ve şube zorunludur.' });
        }

        // Ekstra kontrol/onay yok: seçili öğrencilerin sadece grade ve class_name alanları tek bir
        // toplu UPDATE ile yazılır. Başka hiçbir alana dokunulmaz, mükerrer numara kontrolü yapılmaz.
        const { data, error } = await supabase.from('students')
            .update({ grade, class_name: className })
            .eq('school_id', auth.id)
            .in('id', ids)
            .select('id');

        if (error) throw error;

        const count = (data || []).length;
        res.json({
            status: 'success',
            count,
            message: `${count} öğrenci başarıyla ${grade}/${className} sınıfına aktarıldı.`
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// ÖĞRENCİYİ ARŞİVLE (MEZUN/NAKİL)
// ==========================================
exports.archiveStudent = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }
        if (!id) {
            return res.json({ status: 'error', message: 'Öğrenci ID eksik.' });
        }

        const { data: student, error: findError } = await supabase.from('students')
            .select('id, student_no, is_active')
            .eq('id', id)
            .eq('school_id', auth.id)
            .maybeSingle();
        if (findError) throw findError;
        if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });
        if (!student.is_active) return res.json({ status: 'error', message: 'Öğrenci zaten arşivlenmiş.' });

        // İade edilmemiş kitap kontrolü (archiveRecord'daki mevcut mantıkla aynı)
        const { count: activeTransCount } = await supabase.from('transactions')
            .select('id', { count: 'exact', head: true })
            .eq('school_id', auth.id)
            .eq('student_id', student.id)
            .eq('status', 'borrowed');
        if (activeTransCount && activeTransCount > 0) {
            return res.json({ status: 'error', message: 'Bu öğrencinin üzerinde teslim edilmemiş kitap bulunuyor. Önce kitapları iade almalısınız!' });
        }

        const { data: school, error: schoolError } = await supabase.from('schools')
            .select('active_academic_year')
            .eq('id', auth.id)
            .single();
        if (schoolError) throw schoolError;

        const activeYear = school?.active_academic_year;
        const newStudentNo = activeYear ? buildGraduatedStudentNo(student.student_no, activeYear) : null;
        if (!newStudentNo) {
            return res.json({ status: 'error', message: 'Önce Ayarlar sayfasından Aktif Akademik Yıl seçilmeli.' });
        }

        const { error: updateError } = await supabase.from('students')
            .update({ student_no: newStudentNo, is_active: false })
            .eq('id', student.id)
            .eq('school_id', auth.id);

        if (updateError) {
            if (isDuplicateStudentConstraintError(updateError)) {
                return res.json({ status: 'error', message: `Arşiv numarası (${newStudentNo}) zaten kullanılıyor.` });
            }
            throw updateError;
        }

        res.json({ status: 'success', message: 'Öğrenci başarıyla arşivlendi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// ÖĞRENCİYİ GERİ AL (ARŞİVDEN ÇIKAR)
// ==========================================
exports.restoreStudent = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id, grade } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }
        if (!id) {
            return res.json({ status: 'error', message: 'Öğrenci ID eksik.' });
        }
        if (!grade) {
            return res.json({ status: 'error', message: 'Öğrenci ve kademe bilgisi zorunludur.' });
        }

        const { data: student, error: findError } = await supabase.from('students')
            .select('id, student_no, is_active')
            .eq('id', id)
            .eq('school_id', auth.id)
            .maybeSingle();
        if (findError) throw findError;
        if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });
        if (student.is_active) return res.json({ status: 'error', message: 'Öğrenci zaten aktif.' });

        const gradeNum = parseInt(grade, 10);
        if (Number.isNaN(gradeNum)) {
            return res.json({ status: 'error', message: 'Geçersiz kademe seçildi.' });
        }

        const validGrades = getGradesForSchoolType(auth.schoolType);
        if (!validGrades) {
            console.error(`[school_type] Tanınmayan okul türü — schoolId=${auth.id} schoolType=${JSON.stringify(auth.schoolType)}`);
            return res.json({ status: 'error', message: 'Okul türünüz tanınamadı, lütfen yönetici ile iletişime geçin.' });
        }
        if (!validGrades.includes(gradeNum)) {
            return res.json({ status: 'error', message: 'Seçilen kademe bu okul türü için uygun değil.' });
        }

        const archivedNo = String(student.student_no);
        if (archivedNo.length < 5) {
            return res.json({ status: 'error', message: 'Bu kayıt eski formatta arşivlenmiş görünüyor, otomatik geri alınamıyor. Lütfen öğrenci numarasını manuel düzenleyin.' });
        }
        const originalNo = archivedNo.slice(0, -4);

        // Çakışma kontrolü: hesaplanan orijinal numara başka bir AKTİF öğrencide kullanılıyorsa dur
        const { data: conflictStudent, error: conflictError } = await supabase.from('students')
            .select('full_name')
            .eq('school_id', auth.id)
            .eq('student_no', originalNo)
            .eq('is_active', true)
            .maybeSingle();
        if (conflictError) throw conflictError;
        if (conflictStudent) {
            return res.json({ status: 'error', message: `Bu numara (${originalNo}) şu anda ${conflictStudent.full_name} tarafından kullanılıyor, önce onun numarasını değiştirin.` });
        }

        const { error: updateError } = await supabase.from('students')
            .update({ student_no: originalNo, is_active: true, grade: String(gradeNum) })
            .eq('id', student.id)
            .eq('school_id', auth.id);

        if (updateError) {
            if (isDuplicateStudentConstraintError(updateError)) {
                return res.json({ status: 'error', message: `Bu numara (${originalNo}) zaten kullanılıyor.` });
            }
            throw updateError;
        }

        res.json({ status: 'success', message: 'Öğrenci başarıyla geri alındı.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// ÖĞRENCİYİ KALICI SİL (deleteBook/deleteTeacher ile aynı desen)
// ==========================================
exports.deleteStudent = async (req, res) => {
    try {
        const { schoolCode, schoolPass, id } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        if (!isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }
        if (!id) {
            return res.json({ status: 'error', message: 'Öğrenci ID eksik.' });
        }

        const { data: student, error: findError } = await supabase.from('students')
            .select('id, photo_path')
            .eq('id', id)
            .eq('school_id', auth.id)
            .maybeSingle();
        if (findError) throw findError;
        if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

        const { error } = await supabase.from('students')
            .delete()
            .eq('id', id)
            .eq('school_id', auth.id);

        if (error) throw error;

        if (student.photo_path) {
            await removePhotoFile(student.photo_path);
        }

        res.json({ status: 'success', message: 'Öğrenci başarıyla silindi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
