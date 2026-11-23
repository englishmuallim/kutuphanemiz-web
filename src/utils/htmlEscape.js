// Serbest metin (örn. school_name) HTML'e gömülmeden önce kullanılan ortak kaçışlayıcı.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

module.exports = { escapeHtml };
