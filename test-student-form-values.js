const assert = require('assert');
const { buildStudentPayload } = require('./js/api-client.js');

const payload = buildStudentPayload({
  no: '7001',
  name: 'Yeni Öğrenci',
  grade: '7',
  className: '7C'
});

assert.deepStrictEqual(payload, {
  no: '7001',
  name: 'Yeni Öğrenci',
  grade: '7',
  className: '7C'
});

console.log('student form accepts new grade/class values:', payload);
console.log('student form values test passed');