process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const assert = require('assert');
const controller = require('./src/controllers/libraryController');

assert.strictEqual(typeof controller.buildDuplicateStudentError, 'function');
assert.strictEqual(
  controller.buildDuplicateStudentError({ full_name: 'Ali Veli' }),
  'Bu numarada zaten kayıtlı bir öğrenci var: Ali Veli'
);

console.log('student duplicate helper test passed');
