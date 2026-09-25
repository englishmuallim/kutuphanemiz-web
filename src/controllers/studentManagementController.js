const supabase = require('../api/supabase');
const { getSchoolAuth, isAdmin, isDuplicateStudentConstraintError } = require('./libraryController');
const { getGradesForSchoolType, buildStudentSearchOrFilter, buildGraduatedStudentNo } = require('../utils/studentUtils');

// ==========================================
// ÖĞRENCİ LİSTELEME (ARAMA + FİLTRE)
// ==========================================
exports.listStudents = async (req, res) => {
    try {
        const { schoolCode, schoolPass, query, grade, className, status } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });

        let dbQuery = supabase.from('students')
            .select('id, student_no, full_name, grade, class_name, is_active')
            .eq('school_id', auth.id);

        if (status === 'active') dbQuery = dbQuery.eq('is_active', true);
        else if (status === 'archived') dbQuery = dbQuery.eq('is_active', false);
        // status === 'all' -> filtre yok

        if (grade) dbQuery = dbQuery.eq('grade', grade);
        if (className) dbQuery = dbQuery.eq('class_name', className);

        if (query && query.trim() !== '') {
            const orQueryString = buildStudentSearchOrFilter(query);
            if (orQueryString) dbQuery = dbQuery.or(orQueryString);
        }

        dbQuery = dbQuery
            .order('grade', { ascending: true })
            .order('class_name', { ascending: true })
            .order('full_name', { ascending: true })
            .limit(500);

        const { data, error } = await dbQuery;
        if (error) throw error;

        res.json({ status: 'success', data: data || [] });
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

        const { error } = await supabase.from('students')
            .delete()
            .eq('id', id)
            .eq('school_id', auth.id);

        if (error) throw error;

        res.json({ status: 'success', message: 'Öğrenci başarıyla silindi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
