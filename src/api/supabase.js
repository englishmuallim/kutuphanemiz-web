require('dotenv').config({ path: '../../.env' }); // .env dosyasındaki şifreleri okumak için
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

// İşte Supabase roketimiz ateşleniyor! 🚀
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;