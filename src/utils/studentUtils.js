// Öğrenci verileriyle ilgili, birden fazla controller tarafından paylaşılan yardımcı fonksiyonlar.
// Tek kaynak: aynı mantığın farklı yerlerde kopyalanıp zamanla birbirinden sapmasını önlemek için.

// İsim/metin karşılaştırmasında Türkçe karakter/boşluk farklarını tolere eden normalizasyon
const normalizeTurkishText = (text) => {
    return String(text ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/İ/g, 'i')
        .replace(/I/g, 'i')
        .replace(/ı/g, 'i')
        .toLowerCase()
        .replace(/ş/g, 's')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c');
};

// "2025-2026" -> "2026". Format uymuyorsa/boşsa null döner.
const getAcademicYearEndYear = (academicYear) => {
    const parts = String(academicYear ?? '').split('-');
    if (parts.length !== 2 || !/^\d{4}$/.test(parts[0]) || !/^\d{4}$/.test(parts[1])) return null;
    return parts[1];
};

// Mezuniyet/arşiv numarası formülü: orijinal numara + akademik yılın bitiş yılı (araya ayraç konmadan).
// Örn: "130" + "2025-2026" -> "1302026". academicYear formatı geçersizse null döner.
const buildGraduatedStudentNo = (studentNo, academicYear) => {
    const endYear = getAcademicYearEndYear(academicYear);
    if (!endYear) return null;
    return `${studentNo}${endYear}`;
};

// Okul türüne göre geçerli kademe (sınıf) listesi. Deneliz'in school_type sütunuyla paylaşılan,
// TEK geçerli 8 değerli küme (eski "dershane" / "özel okul" değerleri veritabanında artık yok,
// bu dosyada da bilerek tutulmuyor). 13 = "Mezun" — sadece dershane-lise ve
// dershane-ortaokul-lise'de var; bunlar için GERÇEK, aktif bir kademedir (arşiv değildir).
const GRADUATE_GRADE = 13;

const range = (start, end) => {
    const arr = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
};

const SCHOOL_TYPES = {
    'ilkokul': { grades: range(1, 4) },
    'ortaokul': { grades: range(5, 8) },
    'lise': { grades: range(9, 12) },
    'ilkokul-ortaokul': { grades: range(1, 8) },
    'ortaokul-lise': { grades: range(5, 12) },
    'dershane-ortaokul': { grades: range(5, 8) },
    'dershane-lise': { grades: [...range(9, 12), GRADUATE_GRADE] },
    'dershane-ortaokul-lise': { grades: [...range(5, 12), GRADUATE_GRADE] },
};

// Her türe hasGraduate (Mezun kademesi var mı) ve lastAcademicGrade (Mezun hariç en yüksek
// kademe — yıl sonu atlatmada bu kademedeki öğrenci normal +1 değil, Mezun'a geçer/arşivlenir)
// önceden hesaplanıyor.
Object.keys(SCHOOL_TYPES).forEach((key) => {
    const info = SCHOOL_TYPES[key];
    info.hasGraduate = info.grades.includes(GRADUATE_GRADE);
    const academicGrades = info.grades.filter((g) => g !== GRADUATE_GRADE);
    info.lastAcademicGrade = Math.max(...academicGrades);
});

const VALID_SCHOOL_TYPES = Object.keys(SCHOOL_TYPES);

// Tanınmayan/boş okul türünde null döner — çağıran taraf bunu SESSİZCE bir varsayılana
// düşürmemeli, açık hata olarak ele almalı (bkz. getGradeOptions, restoreStudent, promoteAllStudents).
const getSchoolTypeInfo = (schoolType) => {
    const type = normalizeTurkishText(schoolType);
    return SCHOOL_TYPES[type] || null;
};

const getGradesForSchoolType = (schoolType) => {
    const info = getSchoolTypeInfo(schoolType);
    return info ? info.grades.slice() : null;
};

// 13 (Mezun) için ortak etiket. Backend tarafında raporlama/log amaçlı; frontend'de aynı mantık
// js/ktAuth.js'teki window.ktGradeLabel ile ayrıca (DOM'a bağımlı olduğu için ayrı dosyada) sağlanır.
const gradeLabel = (grade) => (Number(grade) === GRADUATE_GRADE ? 'Mezun' : `${grade}. Sınıf`);

// Yıl sonu toplu terfi/mezuniyet için SAF fonksiyon: okul türü + mevcut kademe -> yapılacak işlem.
// Tanınmayan türde null döner (çağıran taraf hiçbir öğrenciye dokunmadan hata dönmeli).
// Türün kademe listesinde olmayan bir grade değeri (bozuk/tutarsız veri) için 'skip' döner.
const getPromotionAction = (schoolType, grade) => {
    const info = getSchoolTypeInfo(schoolType);
    if (!info) return null;

    const gradeNum = Number(grade);
    if (!Number.isInteger(gradeNum) || !info.grades.includes(gradeNum)) {
        return { action: 'skip' };
    }
    if (info.hasGraduate && gradeNum === GRADUATE_GRADE) {
        return { action: 'archive' };
    }
    if (gradeNum === info.lastAcademicGrade) {
        return info.hasGraduate
            ? { action: 'promote', targetGrade: GRADUATE_GRADE }
            : { action: 'archive' };
    }
    return { action: 'promote', targetGrade: gradeNum + 1 };
};

// Öğrenci arama için Türkçe varyasyon genişletmeli OR filtresi (student_no + full_name üzerinde).
// searchStudentsAdvanced ve listStudents aynı mantığı kullanır (postgres'in ı/İ'yi
// doğru fold etmemesine karşı bir güvenlik önlemi).
const buildStudentSearchOrFilter = (query) => {
    const baseQuery = String(query ?? '').trim().replace(/,/g, '');
    if (!baseQuery) return null;

    const variations = new Set();
    variations.add(baseQuery);
    variations.add(baseQuery.toLocaleLowerCase('tr-TR'));
    variations.add(baseQuery.toLocaleUpperCase('tr-TR'));
    variations.add(baseQuery.toLowerCase());
    variations.add(baseQuery.toUpperCase());
    variations.add(baseQuery.replace(/i/g, 'ı').replace(/İ/g, 'I'));
    variations.add(baseQuery.replace(/ı/g, 'i').replace(/I/g, 'İ'));
    variations.add(baseQuery.toLocaleUpperCase('tr-TR').replace(/İ/g, 'I'));

    const validVariations = Array.from(variations).filter(Boolean);

    return validVariations
        .map(v => `student_no.ilike.%${v}%,full_name.ilike.%${v}%`)
        .join(',');
};

// Deneliz'in class_teacher_of sütunu "kademe-HARF" biçiminde ("8-A"), Kütüphanemiz'in
// app_roles.kutuphanemiz.classes ise "kademe/HARF" biçiminde ("8/A") tutuyor. Bu ikisi
// arasında dönüşüm yapar; geçersiz/boş girdide null döner, asla çökmez.
const classTeacherOfToKtFormat = (code) => {
    if (typeof code !== 'string') return null;
    const trimmed = code.trim();
    if (!trimmed) return null;
    const idx = trimmed.lastIndexOf('-');
    if (idx <= 0 || idx === trimmed.length - 1) return null;
    const grade = trimmed.slice(0, idx).trim();
    const section = trimmed.slice(idx + 1).trim();
    if (!grade || !section) return null;
    return `${grade}/${section}`;
};

// Tersi dönüşüm: "8/A" -> "8-A". Kütüphanemiz bu adımda class_teacher_of'a YAZMIYOR,
// bu fonksiyon simetri/test amaçlı sağlanıyor.
const ktFormatToClassTeacherOf = (code) => {
    if (typeof code !== 'string') return null;
    const trimmed = code.trim();
    if (!trimmed) return null;
    const idx = trimmed.lastIndexOf('/');
    if (idx <= 0 || idx === trimmed.length - 1) return null;
    const grade = trimmed.slice(0, idx).trim();
    const section = trimmed.slice(idx + 1).trim();
    if (!grade || !section) return null;
    return `${grade}-${section}`;
};

// Sınıf kodu karşılaştırmasında boşluk/büyük-küçük harf/Türkçe karakter farklarını tolere
// eder (örn. " 8-a " ve "8-A" aynı kabul edilsin diye normalize eder).
const normalizeClassCode = (code) => {
    if (typeof code !== 'string') return '';
    return code.trim().toLocaleUpperCase('tr-TR');
};

// Bir öğrencinin (grade, class_name) çiftini normalize edilmiş, karşılaştırılabilir tek bir
// anahtara çevirir. getReport/getBorrowedReport'ta öğretmenin etkin sınıf kapsamıyla
// (effectiveClasses, "kademe/HARF" biçiminde) eşleştirme için kullanılır.
const classScopeKey = (grade, className) => {
    const g = normalizeClassCode(String(grade ?? ''));
    const c = normalizeClassCode(String(className ?? ''));
    return `${g}/${c}`;
};

// "8/A" (etkin kapsam girdisi) -> normalize edilmiş karşılaştırma anahtarı. "/" yoksa/baş ya
// da sonda ise null döner.
const classScopeKeyFromCombo = (combo) => {
    if (typeof combo !== 'string') return null;
    const idx = combo.lastIndexOf('/');
    if (idx <= 0 || idx === combo.length - 1) return null;
    return classScopeKey(combo.slice(0, idx), combo.slice(idx + 1));
};

module.exports = {
    normalizeTurkishText,
    getAcademicYearEndYear,
    buildGraduatedStudentNo,
    getGradesForSchoolType,
    getSchoolTypeInfo,
    getPromotionAction,
    gradeLabel,
    VALID_SCHOOL_TYPES,
    buildStudentSearchOrFilter,
    GRADUATE_GRADE,
    classTeacherOfToKtFormat,
    ktFormatToClassTeacherOf,
    normalizeClassCode,
    classScopeKey,
    classScopeKeyFromCombo,
};
