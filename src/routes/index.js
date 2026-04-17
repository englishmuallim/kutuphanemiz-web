const express = require('express');
const router = express.Router();
const libraryController = require('../controllers/libraryController');

// Kullanıcı & Oturum İşlemleri
router.post('/login', libraryController.login);

// Şifre Sıfırlama İşlemleri
router.post('/forgotPassword', libraryController.forgotPassword);
router.post('/verifyResetCode', libraryController.verifyResetCode);
router.put('/updatePassword', libraryController.updatePassword);


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
router.post('/updateStudent', libraryController.updateStudent);

router.get('/globalBooks', libraryController.getGlobalBooks);
router.post('/archive', libraryController.archiveRecord);


// Ayarlar
router.post('/getSettings', libraryController.getSettings);
router.post('/updateSettings', libraryController.updateSettings);

router.post('/getStudentByNo', libraryController.getStudentByNo);

// İşlem Geçmişi
router.post('/getLogs', libraryController.getLogs);

module.exports = router;