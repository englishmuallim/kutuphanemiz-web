const supabase = require('../api/supabase');

// studentPhotoController.js ve libraryController.js ikisi de buradan alır. Burada ayrı bir
// dosyada tutuluyor ki ikisi birbirini require ederken dairesel bağımlılık oluşmasın
// (studentPhotoController zaten libraryController'dan getSchoolAuth/isAdmin alıyor).
const PHOTO_BUCKET = 'student_photos';

// Birden çok öğrenci fotoğrafı için tek seferde signed URL üretir.
// paths: photo_path değerleri -> Map<path, signedUrl>. expiresIn saniye cinsinden zorunludur
// (çağıranlar farklı ömürler istiyor: admin modalı ~600s, ödünç verme ön-kontrolü ~300s).
async function createSignedPhotoUrlMap(paths, expiresIn) {
    const validPaths = [...new Set((paths || []).filter(Boolean))];
    if (validPaths.length === 0) return new Map();

    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(validPaths, expiresIn);
    if (error) throw error;

    const map = new Map();
    (data || []).forEach(item => {
        if (item.path && item.signedUrl && !item.error) map.set(item.path, item.signedUrl);
    });
    return map;
}

module.exports = { PHOTO_BUCKET, createSignedPhotoUrlMap };
