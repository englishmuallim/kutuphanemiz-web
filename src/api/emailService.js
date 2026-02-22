require('dotenv').config();

// Brevo API Key'ini .env dosyasından alıyoruz
const BREVO_API_KEY = process.env.BREVO_API_KEY;

exports.sendResetCodeEmail = async (toEmail, schoolName, resetCode) => {
    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': BREVO_API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    name: "Kütüphanemiz Yazılım",
                    email: "englishmuallim@gmail.com" // Kendi domainin varsa burayı değiştirebilirsin
                },
                to: [
                    {
                        email: toEmail,
                        name: schoolName
                    }
                ],
                subject: "Kütüphanemiz - Şifre Sıfırlama Kodu",
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2>Şifre Sıfırlama Talebi</h2>
                        <p>Merhaba <b>${schoolName}</b>,</p>
                        <p>Kütüphanemiz sistemi için şifre sıfırlama talebinde bulundunuz.</p>
                        <p>Güvenlik kodunuz:</p>
                        <h1 style="color: #4CAF50; letter-spacing: 5px;">${resetCode}</h1>
                        <p><em>Bu kod 15 dakika boyunca geçerlidir. Eğer bu talebi siz yapmadıysanız, bu e-postayı dikkate almayınız.</em></p>
                    </div>
                `
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Brevo API Hatası:", errorData);
            return false;
        }

        return true;
    } catch (error) {
        console.error("E-posta gönderme hatası:", error);
        return false;
    }
};