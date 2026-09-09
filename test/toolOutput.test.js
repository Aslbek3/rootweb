// Tool natijasini klientga uzatish mantiqi.
//
// Avval `tool_result` hodisasida faqat `{id, isError}` yuborilardi — xom
// chiqish (masalan `pm2 logs` natijasi) foydalanuvchiga UMUMAN yetib
// bormasdi. Endi u yuboriladi, lekin ikki xil chegara bilan: jonli klientga
// kattaroq, diskdagi tarixga ancha kichik nusxa.

const test = require('node:test');
const assert = require('node:assert');
const { extractToolOutput, clampOutput } = require('../server/sessionManager');

test('extractToolOutput turli shakllarni matnga keltiradi', () => {
  assert.strictEqual(extractToolOutput('oddiy satr'), 'oddiy satr');
  assert.strictEqual(extractToolOutput(undefined), '');
  assert.strictEqual(extractToolOutput(null), '');
  assert.strictEqual(extractToolOutput(42), '');
  assert.strictEqual(extractToolOutput([]), '');
  assert.strictEqual(
    extractToolOutput([{ type: 'text', text: 'birinchi' }, { type: 'text', text: 'ikkinchi' }]),
    'birinchi\nikkinchi',
  );
  // Rasm bloklari o'rniga belgi qo'yiladi, tashlab yuborilmaydi
  assert.strictEqual(
    extractToolOutput([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]),
    'a\n[rasm]\nb',
  );
  // Notanish bloklar chiqishni buzmaydi
  assert.strictEqual(extractToolOutput([{ type: 'nomalum' }, { type: 'text', text: 'x' }]), 'x');
});

test('clampOutput qisqa matnga tegmaydi', () => {
  const r = clampOutput('salom', 1000);
  assert.strictEqual(r.output, 'salom');
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.fullLength, undefined);
});

test('clampOutput bo\'sh kirishni xavfsiz qaytaradi', () => {
  assert.deepStrictEqual(clampOutput('', 100), { output: '', truncated: false });
  assert.deepStrictEqual(clampOutput(undefined, 100), { output: '', truncated: false });
});

test('clampOutput uzun matnning IKKALA uchini saqlaydi', () => {
  // Boshi ham, oxiri ham kerak: oxirida odatda xato xabari yoki oxirgi
  // loglar bo'ladi, boshida esa buyruq nima qilganini ko'rsatuvchi qism.
  const text = 'BOSH' + 'x'.repeat(5000) + 'OXIR';
  const r = clampOutput(text, 1000);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.fullLength, text.length);
  assert.ok(r.output.startsWith('BOSH'), 'boshi saqlanishi kerak');
  assert.ok(r.output.endsWith('OXIR'), 'oxiri saqlanishi kerak');
  assert.ok(r.output.includes('tashlab ketildi'), 'kesilgani aytilishi kerak');
  // Natija chegaradan bir oz katta bo'ladi (izoh matni qo'shilgani uchun),
  // lekin asl matndan ancha kichik qolishi shart.
  assert.ok(r.output.length < text.length / 4);
});

test('tarix nusxasi jonli nusxadan kichik bo\'ladi', () => {
  const text = 'y'.repeat(50 * 1024);
  const live = clampOutput(text, 16 * 1024);
  const hist = clampOutput(text, 2 * 1024);
  assert.ok(hist.output.length < live.output.length);
  assert.ok(live.truncated && hist.truncated);
});
