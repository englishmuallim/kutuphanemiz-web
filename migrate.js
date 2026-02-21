require('dotenv').config();
const { google } = require('googleapis');
const supabase = require('./src/api/supabase');

const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json', 
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const spreadsheetId = '1K5I7f1USxNKOBUavPFIlfI8H4MqJZw_XgSxsZMqkeow'; 

async function startBookMigration() {
    console.log("🚀 Sadece Kitaplar Aktarılıyor (Faz 2)...");
    const sheets = google.sheets({ version: 'v4', auth });

    try {
        // 1. Az önce oluşturduğumuz okulu bulalım
        const { data: school, error: schoolErr } = await supabase
            .from('schools')
            .select('id')
            .eq('school_code', '123456')
            .single();
            
        if (schoolErr) throw new Error("Okul bulunamadı!");
        const schoolId = school.id;
        console.log("✅ Okul ID'si bulundu:", schoolId);

        // 2. Kitapları Okuyalım
        console.log("📚 Kitaplar Sheets'ten okunuyor...");
        const booksRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Books!A2:G' });
        const booksData = booksRes.data.values;
        
        if (booksData && booksData.length > 0) {
            // FİLTRELEME: Sadece barkodu (row[0]) ve kitap adı (row[1]) dolu olan satırları al!
            const cleanBooksData = booksData.filter(row => row[0] && row[1] && row[1].trim() !== '');

            const booksToInsert = cleanBooksData.map(row => ({
                school_id: schoolId,
                barcode: row[0],                                       
                book_name: row[1],                                     
                page_count: parseInt(row[2]) || 0,                     
                author: row[3] || 'Bilinmiyor',                        
                category: row[4] || 'Genel',                                
                shelf: row[5] || '',                                   
                status: row[6] === 'out' ? 'borrowed' : 'available'    
            }));

            const { error: bookErr } = await supabase.from('books').insert(booksToInsert);
            if (bookErr) throw bookErr;
            console.log(`✅ ${booksToInsert.length} Kitap boş satırlar atlanarak kusursuzca aktarıldı!`);
        }

        console.log("🎉 GÖÇ OPERASYONU %100 TAMAMLANDI!");
    } catch (error) {
        console.error("❌ HATA OLUŞTU:", error.message);
    }
}

startBookMigration();