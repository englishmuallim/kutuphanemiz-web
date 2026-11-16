const supabase = require('../api/supabase');
const { getSchoolAuth, isAdmin } = require('./libraryController');
const { PHOTO_BUCKET, createSignedPhotoUrlMap } = require('../utils/photoStorage');

const DEFAULT_SIGNED_URL_TTL = 600; // 10 dakika

function isJpegBuffer(buffer) {
    return Buffer.isBuffer(buffer) && buffer.length > 3 &&
        buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
}

function buildPhotoPath(schoolId, studentId) {
    return `${schoolId}/${studentId}.jpg`;
}

// Okula ait öğrenciyi id veya öğrenci numarasıyla bulur; başka okula aitse null döner.
async function findStudentInSchool(schoolId, { studentId, studentNo }) {
    let query = supabase.from('students').select('id, student_no, photo_path').eq('school_id', schoolId);

    if (studentId) query = query.eq('id', studentId);
    else if (studentNo) query = query.eq('student_no', String(studentNo).trim());
    else return null;

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
}

exports.createSignedPhotoUrlMap = createSignedPhotoUrlMap;

// deleteStudent gibi diğer controller'lardan öğrenci kalıcı silinirken çağrılır.
exports.removePhotoFile = async (photoPath) => {
    if (!photoPath) return;
    await supabase.storage.from(PHOTO_BUCKET).remove([photoPath]);
};

// ==========================================
// YENİ: ÖĞRENCİ FOTOĞRAFI YÜKLEME (sadece yönetici)
// ==========================================
exports.uploadStudentPhoto = async (req, res) => {
    try {
        const schoolCode = req.headers['x-school-code'];
        const studentId = req.headers['x-student-id'];
        const studentNo = req.headers['x-student-no'];

        const auth = await getSchoolAuth(schoolCode);
        if (!auth || !isAdmin(auth)) {
            return res.json({ success: false, message: 'Yetkisiz işlem.' });
        }
        if (!studentId && !studentNo) {
            return res.json({ success: false, message: 'Öğrenci belirtilmedi.' });
        }

        const fileBuffer = req.body;
        if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
            return res.json({ success: false, message: 'Dosya alınamadı.' });
        }
        if (!isJpegBuffer(fileBuffer)) {
            return res.json({ success: false, message: 'Yalnızca JPEG formatında fotoğraf yüklenebilir.' });
        }

        const student = await findStudentInSchool(auth.id, { studentId, studentNo });
        if (!student) {
            return res.json({ success: false, message: 'Öğrenci bu okulda bulunamadı.' });
        }

        const photoPath = buildPhotoPath(auth.id, student.id);
        const { error: uploadError } = await supabase.storage
            .from(PHOTO_BUCKET)
            .upload(photoPath, fileBuffer, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });

        if (uploadError) {
            return res.json({ success: false, message: `Fotoğraf yüklenemedi: ${uploadError.message}` });
        }

        const { error: updateError } = await supabase.from('students')
            .update({ photo_path: photoPath })
            .eq('id', student.id)
            .eq('school_id', auth.id);
        if (updateError) throw updateError;

        res.json({ success: true, message: 'Fotoğraf kaydedildi.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
};

// ==========================================
// YENİ: ÖĞRENCİ FOTOĞRAFI SİLME (sadece yönetici)
// ==========================================
exports.deleteStudentPhoto = async (req, res) => {
    try {
        const { schoolCode, schoolPass, studentId, studentNo } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!isAdmin(auth)) {
            return res.json({ status: 'error', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
        }
        if (!studentId && !studentNo) {
            return res.json({ status: 'error', message: 'Öğrenci belirtilmedi.' });
        }

        const student = await findStudentInSchool(auth.id, { studentId, studentNo });
        if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

        if (student.photo_path) {
            await supabase.storage.from(PHOTO_BUCKET).remove([student.photo_path]);
        }

        const { error: updateError } = await supabase.from('students')
            .update({ photo_path: null })
            .eq('id', student.id)
            .eq('school_id', auth.id);
        if (updateError) throw updateError;

        res.json({ status: 'success', message: 'Fotoğraf silindi.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ==========================================
// YENİ: ÖĞRENCİ FOTOĞRAFI İÇİN SIGNED URL (yönetici / öğretmen / nöbetçi)
// ==========================================
exports.getStudentPhotoUrl = async (req, res) => {
    try {
        const { schoolCode, schoolPass, studentId, studentNo, expiresIn } = req.body;
        const auth = await getSchoolAuth(schoolCode, schoolPass);
        if (!auth) return res.status(401).json({ status: 'error', message: 'Yetkisiz' });
        if (!studentId && !studentNo) {
            return res.json({ status: 'error', message: 'Öğrenci belirtilmedi.' });
        }

        const student = await findStudentInSchool(auth.id, { studentId, studentNo });
        if (!student) return res.json({ status: 'error', message: 'Öğrenci bulunamadı.' });

        if (!student.photo_path) {
            return res.json({ status: 'success', url: null });
        }

        const ttl = Number.isInteger(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_SIGNED_URL_TTL;
        const urlMap = await createSignedPhotoUrlMap([student.photo_path], ttl);
        const url = urlMap.get(student.photo_path) || null;

        res.json({ status: 'success', url });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
