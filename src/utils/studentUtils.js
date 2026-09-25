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

// Okul türüne göre geçerli kademe (sınıf) listesi. 13 = "Mezun" (dershane/özel okul için).
const GRADUATE_GRADE = 13;
const SCHOOL_TYPE_GRADE_RANGES = {
    'ilkokul': [1, 4],
    'ortaokul': [5, 8],
    'lise': [9, 12],
    'ilkokul-ortaokul': [1, 8],
    'ortaokul-lise': [5, 12],
};

const range = (start, end) => {
    const arr = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
};

const getGradesForSchoolType = (schoolType) => {
    const type = normalizeTurkishText(schoolType);

    if (SCHOOL_TYPE_GRADE_RANGES[type]) {
        const [start, end] = SCHOOL_TYPE_GRADE_RANGES[type];
        return range(start, end);
    }
    if (type === 'dershane') {
        return [...range(5, 12), GRADUATE_GRADE];
    }
    if (type === 'ozel okul') {
        return [...range(1, 12), GRADUATE_GRADE];
    }
    // Tanınmayan/boş: varsayılan 5-8
    return range(5, 8);
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

module.exports = {
    normalizeTurkishText,
    getAcademicYearEndYear,
    buildGraduatedStudentNo,
    getGradesForSchoolType,
    buildStudentSearchOrFilter,
    GRADUATE_GRADE,
};
