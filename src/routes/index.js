const express = require('express');
const router = express.Router();
const libraryController = require('../controllers/libraryController');

// Kullanıcı & Oturum İşlemleri
router.post('/login', libraryController.login);
router.post('/magic-login', libraryController.magicLogin); // YENİ: Bilet kapısı

// Şifre Sıfırlama İşlemleri
router.post('/forgotPassword', libraryController.forgotPassword);
router.post('/verifyResetCode', libraryController.verifyResetCode);
router.put('/updatePassword', libraryController.updatePassword);
router.post('/changePassword', libraryController.changePassword);


// İstatistik & Gösterge Paneli
router.post('/stats', libraryController.stats);
router.post('/getClasses', libraryController.getClasses);
router.post('/stats', libraryController.stats);
router.post('/statDetails', libraryController.statDetails);
router.post('/getClasses', libraryController.getClasses);
router.post('/overdue', libraryController.overdue);
router.post('/getReport', libraryController.getReport);

// Kitap ve Emanet İşlemleri
router.post('/addBook', libraryController.addBook);
router.post('/kitapVer', libraryController.kitapVer);
router.post('/kitapAl', libraryController.kitapAl);
router.post('/undo', libraryController.undo);
router.post('/sorgula', libraryController.sorgula);

// Öğrenci İşlemleri
router.post('/addStudent', libraryController.addStudent);
router.post('/students/bulk', libraryController.bulkAddStudents);
router.post('/updateStudent', libraryController.updateStudent);
router.post('/searchStudentsAdvanced', libraryController.searchStudentsAdvanced);
router.post('/updateStudentDetailed', libraryController.updateStudentDetailed);
router.get('/globalBooks', libraryController.getGlobalBooks);
router.post('/books/bulk', libraryController.bulkAddBooks);
router.post('/archive', libraryController.archiveRecord);

// Kitap Arama, Düzenleme, Silme
router.post('/searchBooks', libraryController.searchBooks);
router.post('/updateBook', libraryController.updateBook);
router.post('/deleteBook', libraryController.deleteBook);

// Ayarlar
router.post('/getSettings', libraryController.getSettings);
router.post('/updateSettings', libraryController.updateSettings);

// Öğretmen İşlemleri Modülü
router.post('/getTeachers', libraryController.getTeachers);
router.post('/saveTeacher', libraryController.saveTeacher);
router.post('/deleteTeacher', libraryController.deleteTeacher);

router.post('/getStudentByNo', libraryController.getStudentByNo);

// İşlem Geçmişi
router.post('/getLogs', libraryController.getLogs);

module.exports = router;