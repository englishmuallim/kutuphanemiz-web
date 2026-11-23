// --- KT BİLET (ktToken) YÖNETİMİ + GLOBAL FETCH SARMALAYICI ---
// Bağımsız, başka hiçbir dosyaya bağımlı değil. index.html ve ogrenci-islemleri.html'de
// diğer scriptlerden ÖNCE yüklenir ki window.fetch, sarmalanmış haliyle onlara ulaşsın.
//
// Amaç: her /api isteğine (login ve magic-login hariç) sessizce bir x-kt-token başlığı
// eklemek ve sunucudan gelen x-kt-token-refresh başlığıyla saklanan bileti güncellemek.
// Şifre (schoolPass) hiçbir istekte ASLA gönderilmez — ne normal girişten sonra ne de
// magic login'den sonra (ikisi de artık bilet üretiyor).
(function () {
    'use strict';

    var KT_TOKEN_KEY = 'kutuphane_token';
    var KT_CODE_KEY = 'kutuphane_code';

    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* sessizce yut */ }
    }
    function safeRemove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* sessizce yut */ }
    }

    function getKtToken() {
        return safeGet(KT_TOKEN_KEY);
    }

    function setKtToken(token) {
        if (!token) {
            safeRemove(KT_TOKEN_KEY);
            return;
        }
        safeSet(KT_TOKEN_KEY, token);
    }

    function clearKtToken() {
        safeRemove(KT_TOKEN_KEY);
    }

    // Merkezi yardımcı: TÜM istek gövdelerinin kimlik kısmı buradan gelir. Şifre ASLA
    // eklenmez — oturum bileti zaten fetch sarmalayıcısı tarafından x-kt-token başlığına
    // ekleniyor (magic login de dahil, artık bilet üretiyor — eski magic_legacy şifre
    // istisnası kalktı).
    function ktAuthFields() {
        return { schoolCode: safeGet(KT_CODE_KEY) };
    }

    // Header-tabanlı (ham ikili yükleme) istekler için aynı kural, başlık adlarıyla.
    function ktAuthHeaderFields() {
        return { 'x-school-code': safeGet(KT_CODE_KEY) };
    }

    window.getKtToken = getKtToken;
    window.setKtToken = setKtToken;
    window.clearKtToken = clearKtToken;
    window.ktAuthFields = ktAuthFields;
    window.ktAuthHeaderFields = ktAuthHeaderFields;

    // Backend'deki studentUtils.js#gradeLabel ile AYNI mantık: 13 = "Mezun" (dershane-lise /
    // dershane-ortaokul-lise'de gerçek, aktif bir kademe — arşiv değil). Kademe gösteren HER
    // dropdown (student-management.js, api-client.js, ui.js) bu tek fonksiyonu kullanır.
    window.ktGradeLabel = function (grade) {
        return Number(grade) === 13 ? 'Mezun' : (grade + '. Sınıf');
    };

    // --- GLOBAL FETCH SARMALAYICI ---
    // Çift yüklemeye karşı: zaten kurulmuşsa tekrar sarmalamaz (fonksiyonlar yine de
    // yeniden atanır ama bu zararsız/idempotent).
    if (window.__ktFetchWrapped || typeof window.fetch !== 'function') {
        return;
    }
    window.__ktFetchWrapped = true;

    var originalFetch = window.fetch.bind(window);
    var EXEMPT_API_PATHS = ['/api/login', '/api/magic-login'];

    // input: string | URL | Request. Request nesnesine hiç dokunulmuyor (spec), bu
    // yüzden sadece "hedefi anlamak" için url'sini okuyoruz, değiştirmiyoruz.
    function describeTarget(input) {
        var isRequestObject = (typeof Request !== 'undefined') && (input instanceof Request);
        var urlStr = isRequestObject ? input.url : String(input);
        var pathname = null;
        var sameOrigin = false;
        try {
            var parsed = new URL(urlStr, window.location.origin);
            pathname = parsed.pathname;
            sameOrigin = parsed.origin === window.location.origin;
        } catch (e) {
            // Ayrıştırılamayan/garip bir URL — dokunmadan geçsin.
        }
        return { isRequestObject: isRequestObject, pathname: pathname, sameOrigin: sameOrigin };
    }

    function isEligibleApiPath(target) {
        return !target.isRequestObject &&
            target.sameOrigin &&
            !!target.pathname &&
            target.pathname.indexOf('/api/') === 0 &&
            EXEMPT_API_PATHS.indexOf(target.pathname) === -1;
    }

    // Mevcut başlıkları (düz obje / Headers / [[k,v]] dizisi) koruyarak x-kt-token ekler.
    function withTokenHeader(existingHeaders, token) {
        if (typeof Headers !== 'undefined' && existingHeaders instanceof Headers) {
            var h = new Headers(existingHeaders);
            h.set('x-kt-token', token);
            return h;
        }
        if (Array.isArray(existingHeaders)) {
            return existingHeaders.concat([['x-kt-token', token]]);
        }
        var obj = {};
        if (existingHeaders && typeof existingHeaders === 'object') {
            for (var key in existingHeaders) {
                if (Object.prototype.hasOwnProperty.call(existingHeaders, key)) {
                    obj[key] = existingHeaders[key];
                }
            }
        }
        obj['x-kt-token'] = token;
        return obj;
    }

    window.fetch = function (input, init) {
        var target;
        try {
            target = describeTarget(input);
        } catch (e) {
            // Hedef anlaşılamadıysa sarmalama denenmez — orijinal istek aynen gider.
            return originalFetch(input, init);
        }

        var effectiveInit = init;
        var eligible = false;
        var tokenAttached = false;
        try {
            eligible = isEligibleApiPath(target);
            if (eligible) {
                var token = getKtToken();
                if (token) {
                    effectiveInit = init ? Object.assign({}, init) : {};
                    effectiveInit.headers = withTokenHeader(init && init.headers, token);
                    tokenAttached = true;
                }
            }
        } catch (e) {
            // Başlık ekleme sırasında herhangi bir hata — sarmalayıcı isteği ASLA bozmaz,
            // orijinal init ile devam eder.
            effectiveInit = init;
        }

        // Çağıran taraf (örn. açılıştaki /api/session kontrolü), bu TEK istek için
        // "oturum sona erdi" kancasının tetiklenmesini bilerek bastırabilir — çünkü kendi
        // 401 yönetimini (sessiz) zaten kendisi yapacaktır. Gerçek fetch bu özel alanı
        // görmezden gelir (Fetch API bilinmeyen init alanlarını yok sayar).
        var suppressHook = !!(init && init.__ktSuppressSessionExpired);

        var promise;
        try {
            promise = originalFetch(input, effectiveInit);
        } catch (e) {
            // Senkron bir hata fırlarsa (nadiren), değiştirilmemiş init ile tekrar dene.
            return originalFetch(input, init);
        }

        return promise.then(function (response) {
            try {
                if (eligible) {
                    var refreshed = response.headers.get('x-kt-token-refresh');
                    if (refreshed) {
                        setKtToken(refreshed);
                    }
                    if (tokenAttached && !suppressHook && response.status === 401 && typeof window.onKtSessionExpired === 'function') {
                        window.onKtSessionExpired();
                    }
                }
            } catch (e) {
                // Yanıt başlığı okunamadıysa yanıtın kendisini bozma, sessizce geç.
            }
            return response;
        });
    };
})();
