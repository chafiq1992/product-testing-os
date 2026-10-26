const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

// Run the production pure scanner logic without adding another application runtime.
const source = fs.readFileSync(path.join(__dirname, '../app/wholesale/grocery/scanner.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const exportsObject = {}
new Function('exports', compiled.outputText)(exportsObject)
const { normalizeBarcode, validateBarcode, ScanStabilityGate } = exportsObject

test('GTIN checksums reject misreads and identity preserves leading zeroes', () => {
  assert.equal(validateBarcode('4006381333931', 'ean_13'), true)
  assert.equal(validateBarcode('4006381333932', 'ean_13'), false)
  assert.equal(validateBarcode('96385074', 'ean_8'), true)
  assert.equal(validateBarcode('96385075', 'ean_8'), false)
  assert.equal(validateBarcode('036000291452', 'upc_a'), true)
  assert.equal(normalizeBarcode('036000291452'), '0036000291452')
  assert.equal(normalizeBarcode('0036000291452'), '0036000291452')
  assert.equal(normalizeBarcode('0000123'), '0000123')
})

test('manual SKUs and Code 128 are accepted without stripping significant characters', () => {
  assert.equal(validateBarcode('SKU-A/02'), true)
  assert.equal(normalizeBarcode(' SKU-A/02 '), 'SKU-A/02')
  assert.equal(validateBarcode('12345678', 'code_128'), true)
  assert.equal(validateBarcode('12345678'), false)
  assert.equal(validateBarcode('4006381333931', 'qr_code'), false)
  assert.equal(validateBarcode(''), false)
  assert.equal(validateBarcode('a\nb'), false)
  assert.equal(validateBarcode('abc'), false)
  assert.equal(validateBarcode('AB CD'), false)
  assert.equal(validateBarcode('AB CD', 'code_128'), false)
  assert.equal(validateBarcode('a'.repeat(64)), true)
  assert.equal(validateBarcode('a'.repeat(65)), false)
})

test('camera requires two consecutive agreeing valid reads and suppresses a held label', () => {
  const gate = new ScanStabilityGate()
  assert.equal(gate.observe('4006381333931', 'ean_13', 0), null)
  assert.equal(gate.observe('4006381333931', 'ean_13', 100), '4006381333931')
  assert.equal(gate.observe('4006381333931', 'ean_13', 200), null)
  assert.equal(gate.observe('4006381333931', 'ean_13', 5000), null)
  assert.equal(gate.observe('4006381333931', 'ean_13', 5100), null)
  gate.observe(null, undefined, 5200)
  gate.observe(null, undefined, 5500)
  assert.equal(gate.observe('4006381333931', 'ean_13', 5600), null)
  assert.equal(gate.observe('4006381333931', 'ean_13', 5700), null)
})

test('removing a label or explicitly rearming permits a deliberate rescan', () => {
  const gate = new ScanStabilityGate()
  gate.observe('036000291452', 'upc_a', 0)
  assert.equal(gate.observe('0036000291452', 'ean_13', 100), '0036000291452')
  gate.observe(null, undefined, 200)
  gate.observe(null, undefined, 950)
  assert.equal(gate.observe('036000291452', 'upc_a', 1000), null)
  assert.equal(gate.observe('036000291452', 'upc_a', 1100), '0036000291452')
  gate.reset()
  assert.equal(gate.observe('036000291452', 'upc_a', 1200), null)
  assert.equal(gate.observe('036000291452', 'upc_a', 1300), '0036000291452')
})

test('interrupted reads and invalid frames never satisfy confirmation', () => {
  const gate = new ScanStabilityGate()
  gate.observe('4006381333931', 'ean_13', 0)
  gate.observe('4006381333932', 'ean_13', 100)
  assert.equal(gate.observe('4006381333931', 'ean_13', 200), null)
  assert.equal(gate.observe('4006381333931', 'ean_13', 1200), null)
  assert.equal(gate.observe('4006381333931', 'ean_13', 1300), '4006381333931')
})
