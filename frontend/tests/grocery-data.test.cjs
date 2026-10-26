const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
function load(file) {
  const source = fs.readFileSync(path.join(__dirname, '../app/wholesale/grocery', file + '.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const result = {}; new Function('exports', 'require', compiled.outputText)(result, name => load(name.replace('./', ''))); return result
}
const { shortCode, searchProducts, exactProduct, kgToGrams, lineCents, available } = load('groceryData')
const base = { title: 'Lentils', unit_type: 'weight', price: '12.50', stock: 0, stock_grams: 50000, section: 'L' }
const products = [{ ...base, id: 1, short_code: 'L-23', image_url: '/lentils.png' }, { ...base, id: 2, title: 'Lentils red', short_code: 'L-234' }, { ...base, id: 3, title: 'Rice', short_code: 'R-01' }]
test('typing section or compact ID returns exact-first image-bearing suggestions', () => {
  assert.equal(shortCode('l23'), 'L-23'); assert.equal(shortCode('l-02'), 'L-02'); assert.equal(shortCode('l002'), 'L-02')
  assert.deepEqual(searchProducts(products, 'l23').map(p => p.short_code), ['L-23', 'L-234'])
  assert.equal(searchProducts(products, 'l')[0].image_url, '/lentils.png')
  assert.equal(exactProduct(products, 'l23').id, 1)
  assert.equal(exactProduct(products, 'l2'), undefined)
})
test('ambiguous names or code/barcode collisions never auto-select an arbitrary product', () => {
  assert.equal(exactProduct([...products, { ...base, id: 4, short_code: 'L-99' }], 'Lentils'), undefined)
  assert.equal(exactProduct([...products, { ...base, id: 4, short_code: 'L-99', barcode: 'L-23' }], 'L-23'), undefined)
})
test('kilograms convert to exact whole grams and reject subgram stock', () => {
  assert.equal(kgToGrams('25'), 25000); assert.equal(2 * kgToGrams('25'), 50000)
  assert.equal(kgToGrams('0.5'), 500); assert.equal(kgToGrams('49.5'), 49500)
  assert.equal(kgToGrams('0.0005'), null); assert.equal(kgToGrams('-1'), null)
})
test('weight line totals round half up in cents; unit prices never scale as kilograms', () => {
  assert.equal(lineCents(products[0], { variant_id: 1, grams: 500 }), 625)
  assert.equal(lineCents({ ...products[0], price: '5.01' }, { variant_id: 1, grams: 500 }), 251)
  assert.equal(lineCents({ ...products[0], unit_type: 'unit', price: '2.55' }, { variant_id: 1, quantity: 2 }), 510)
  assert.equal(available({ ...products[0], stock_grams: 500 }), 500)
})
