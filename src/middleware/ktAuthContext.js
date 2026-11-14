'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const ktAuthStorage = new AsyncLocalStorage();

// Rotalardan ÖNCE kullanılır: bu isteğin {req, res} çiftini, istekle ilişkili tüm
// async zincir boyunca (getSchoolAuth gibi req/res parametresi almayan fonksiyonlardan
// da) erişilebilir kılar. 53 çağrı noktasının imzasını değiştirmeden bilet doğrulamasını
// getSchoolAuth'un içine taşımanın tek amacı budur.
function ktAuthContextMiddleware(req, res, next) {
  ktAuthStorage.run({ req, res }, () => next());
}

// Depo boşsa (örn. middleware zincirine girmemiş bir çağrı, ya da bir test ortamı)
// null döner — çağıran taraf bunu "bilet yok, legacy davran" olarak ele almalı.
function getCurrentRequestContext() {
  return ktAuthStorage.getStore() || null;
}

module.exports = {
  ktAuthContextMiddleware,
  getCurrentRequestContext,
};
