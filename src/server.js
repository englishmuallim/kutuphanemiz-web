require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/index');
const { ktAuthContextMiddleware } = require('./middleware/ktAuthContext');

const app = express();

// --- MIDDLEWARE ---
// Statik dosyaların klasörünü src/ dizininden bir üst dizine (kök dizine) ayarladık
app.use(express.static(path.join(__dirname, '../')));
// x-kt-token-refresh yanıt başlığı, istemci ileride ayrı bir origin'den servis edilirse
// tarayıcı JS'inin okuyabilmesi için açıkça ifşa edilir (bugün aynı origin olduğundan
// zorunlu değil, ileriye dönük önlem).
app.use(cors({ exposedHeaders: ['x-kt-token-refresh'] }));
app.use(express.json({ limit: '5mb' }));
// Bilet doğrulamasını (getSchoolAuth içinde) 53 çağrı noktasının imzasını değiştirmeden
// yapabilmek için isteğin {req,res} çiftini AsyncLocalStorage ile saklar. Rotalardan ÖNCE.
app.use(ktAuthContextMiddleware);

// --- ROUTER ENTEGRASYONU ---
app.use('/api', apiRoutes);

// --- HATA YAKALAMA ---
// body-parser'ın boyut/format hataları (örn. 413 PayloadTooLarge) ve diğer beklenmeyen
// hatalar Express'in varsayılan HTML hata sayfası yerine JSON olarak dönsün ki frontend
// res.json() çağrısında ham bir SyntaxError'a düşmesin.
app.use((err, req, res, next) => {
  if (!err) return next();
  const status = err.status || err.statusCode || 500;
  const message = status === 413
    ? 'Gönderilen veri çok büyük. Lütfen dosyayı daha küçük parçalara bölüp tekrar deneyin.'
    : (err.message || 'Sunucuda beklenmeyen bir hata oluştu.');
  res.status(status).json({ status: 'error', message });
});

// --- SUNUCUYU BAŞLAT ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});