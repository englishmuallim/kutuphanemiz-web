require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/index');

const app = express();

// --- MIDDLEWARE ---
// Statik dosyaların klasörünü src/ dizininden bir üst dizine (kök dizine) ayarladık
app.use(express.static(path.join(__dirname, '../')));
app.use(cors());
app.use(express.json());

// --- ROUTER ENTEGRASYONU ---
app.use('/api', apiRoutes);

// --- SUNUCUYU BAŞLAT ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});