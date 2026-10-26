const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../../lib/customer.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const exported = {}
new Function('exports', compiled.outputText)(exported)
const { customerApi, CustomerApiError, customerPriceCents, customerLineCents, gramsFromInput, customerStock, withCustomerCartLock, canPersistCustomerCartDraft, customerOrderQuantity, customerError } = exported

test('weight input preserves exact whole grams and rejects subgram or negative input', () => {
  assert.equal(gramsFromInput('0.125', 'kg'), 125)
  assert.equal(gramsFromInput('1.005', 'kg'), 1005)
  assert.equal(gramsFromInput('250', 'g'), 250)
  assert.equal(gramsFromInput('0.1255', 'kg'), null)
  assert.equal(gramsFromInput('250.5', 'g'), null)
  assert.equal(gramsFromInput('-1', 'kg'), null)
})

test('cash display uses integer cents and weight lines round to nearest cent', () => {
  assert.equal(customerPriceCents('12.30'), 1230)
  assert.equal(customerLineCents('12.30', 3, false), 3690)
  assert.equal(customerLineCents('12.30', 333, true), 410)
  assert.equal(customerLineCents('0.05', 100, true), 1)
  assert.equal(customerPriceCents('NaN'), 0)
  assert.equal(customerPriceCents('-3.00'), 0)
})

test('weight stock uses authoritative grams; unavailable stock cannot become purchasable', () => {
  const product = { unit_type: 'weight', stock_grams: 2345 }
  assert.equal(customerStock(product, { available: 2.345 }), 2345)
  assert.equal(customerStock(product, { available: 2.345, stock_grams: 0 }), 0)
  assert.equal(customerStock({ unit_type: 'unit' }, { available: 4 }), 4)
  assert.equal(customerStock({ unit_type: 'unit' }, { available: -1 }), 0)
})

test('order history renders unit lines with grams zero as quantities, and weight lines as kg', () => {
  assert.equal(customerOrderQuantity({ unit_type: 'unit', quantity: 1, grams: 0 }, 'en'), '1 ×')
  assert.equal(customerOrderQuantity({ unit_type: 'weight', quantity: 0, grams: 500 }, 'en'), '0.5 kg')
})

test('API uses customer cookie credentials and keeps merchant/variant identifiers opaque', async () => {
  const original = global.fetch
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ data: { id: 'order-1' } }) }
  }
  try {
    const body = { request_id: 'fixed-request', merchant_ref: 'opaque-shop', expected_total: '14.25', line_items: [{ product_id: 'store:001', variant_id: 'store:009', quantity: 2 }] }
    await customerApi.order(body)
    await customerApi.order(body)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.credentials, 'include')
    assert.equal(calls[0].options.body, calls[1].options.body)
    assert.deepEqual(JSON.parse(calls[0].options.body), body)
    assert.equal(calls[0].options.headers.Authorization, undefined)
  } finally { global.fetch = original }
})

test('network uncertainty retains a retryable request while validation failures are definitive', async () => {
  const original = global.fetch
  try {
    global.fetch = async () => { throw new Error('offline') }
    await assert.rejects(() => customerApi.order({}), error => error instanceof CustomerApiError && error.uncertain)
    global.fetch = async () => ({ ok: false, status: 409, json: async () => ({ detail: { error: 'request_in_progress' } }) })
    await assert.rejects(() => customerApi.order({}), error => error instanceof CustomerApiError && error.uncertain)
    global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ detail: { error: 'insufficient_stock' } }) })
    await assert.rejects(() => customerApi.order({}), error => error instanceof CustomerApiError && !error.uncertain)
  } finally { global.fetch = original }
})

test('price changes require reviewing the refreshed total before a new order', () => {
  const error = new CustomerApiError('price_changed', 422, 'price_changed')
  assert.equal(error.uncertain, false)
  assert.match(customerError(error, 'en'), /Review the total/)
  assert.match(customerError(error, 'ar'), /راجع المجموع/)
})

test('stale tab persistence cannot erase a pending checkout or resurrect a completed one', () => {
  assert.equal(canPersistCustomerCartDraft({ revision: 4, pending: { request_id: 'original' } }, { revision: 3, pending: null }), false)
  assert.equal(canPersistCustomerCartDraft({ revision: 4, pending: { request_id: 'original' } }, { revision: 4, pending: null }), false)
  assert.equal(canPersistCustomerCartDraft({ revision: 5, pending: null }, { revision: 4, pending: { request_id: 'original' } }), false)
  assert.equal(canPersistCustomerCartDraft({ revision: 4, pending: { request_id: 'original' } }, { revision: 4, pending: { request_id: 'replacement' } }), false)
  assert.equal(canPersistCustomerCartDraft({ revision: 4, pending: { request_id: 'original' } }, { revision: 4, pending: { request_id: 'original' } }), true)
})

test('concurrent checkout preparations use the same merchant lock and durable pending identity', async () => {
  const previous = Object.getOwnPropertyDescriptor(global, 'navigator')
  const calls = []
  let queue = Promise.resolve(), storedPending = null, created = 0
  Object.defineProperty(global, 'navigator', { configurable: true, value: { locks: {
    request(name, options, action) {
      calls.push({ name, options })
      const result = queue.then(action)
      queue = result.catch(() => {})
      return result
    },
  } } })
  try {
    const prepare = () => withCustomerCartLock('customer-uuid:merchant-ref', async () => {
      if (storedPending) return storedPending
      const request = `request-${++created}`
      await Promise.resolve()
      storedPending = request
      return request
    })
    const result = await Promise.all([prepare(), prepare()])
    assert.deepEqual(result, ['request-1', 'request-1'])
    assert.equal(created, 1)
    assert.equal(calls[0].name, calls[1].name)
    assert.equal(calls[0].options.mode, 'exclusive')
  } finally {
    if (previous) Object.defineProperty(global, 'navigator', previous)
    else delete global.navigator
  }
})
