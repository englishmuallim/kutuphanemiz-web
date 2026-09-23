const assert = require('assert');
const { parseEokulStudentRows } = require('./js/api-client.js');

const rows = [
  ['No', 'Öğrenci No', 'Sınıf', 'Kayıt Durumu', 'Adı', 'Cinsiyet', 'Doğum Tarihi', 'Velisi', 'Telefon', 'Soyadı'],
  [null, '101', null, null, 'ABDULLAH BAVER', null, null, null, null, 'YILDIZ'],
  [null, '102', null, null, 'ELİF', null, null, null, null, 'KARA'],
  [null, '', null, null, 'BOŞ SATIR', null, null, null, null, ''],
  [null, '103', null, null, 'MEHMET', null, null, null, null, 'DEMİR'],
  [null, '104', null, null, 'AYŞE', null, null, null, null, 'KURT'],
  [null, '', null, null, '', null, null, null, null, '']
];

const parsed = parseEokulStudentRows(rows, '8', 'A');

console.log('Parsed rows:', JSON.stringify(parsed, null, 2));

assert.strictEqual(parsed.length, 4, 'Doğru sayıda öğrenci parse edilmelidir.');
assert.deepStrictEqual(
  parsed.map(item => item.student_no),
  ['101', '102', '103', '104'],
  'Öğrenci no doğru okunmalıdır.'
);
assert.deepStrictEqual(
  parsed.map(item => item.full_name),
  ['ABDULLAH BAVER YILDIZ', 'ELİF KARA', 'MEHMET DEMİR', 'AYŞE KURT'],
  'Ad ve soyad doğru birleştirilmelidir.'
);
assert.ok(parsed.every(item => item.grade === '8' && item.class_name === 'A'), 'Kademe ve şube doğru sabit olarak eklenmelidir.');
assert.ok(!parsed.some(item => item.student_no === ''), 'Boş öğrenci numarası satırı atlanmalıdır.');

console.log('E-Okul import test passed');
