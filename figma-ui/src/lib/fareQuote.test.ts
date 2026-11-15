import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOOKING_FEE_PCT, bookingFeeFor, quoteTotals } from './fareQuote.ts'

test('defaults to the 4% booking fee', () => {
  assert.equal(BOOKING_FEE_PCT, 4)
  assert.equal(bookingFeeFor(200), 8)
})

test('R200 ride: rider pays R208 (R200 fare + R8 booking fee)', () => {
  // The owner's example: R5 commission + R8 fee = R13 to Vura, driver R195.
  assert.deepEqual(quoteTotals(200), { fare: 200, bookingFee: 8, total: 208 })
})

test('rounds the fee to the nearest cent, like the server', () => {
  assert.deepEqual(quoteTotals(20), { fare: 20, bookingFee: 0.8, total: 20.8 })
  assert.deepEqual(quoteTotals(12.34), { fare: 12.34, bookingFee: 0.49, total: 12.83 })
  assert.deepEqual(quoteTotals(5), { fare: 5, bookingFee: 0.2, total: 5.2 })
})

test('a fully discounted fare is free: no fee on R0', () => {
  assert.deepEqual(quoteTotals(0), { fare: 0, bookingFee: 0, total: 0 })
})

test('never returns fractional cents or a negative total', () => {
  const q = quoteTotals(99.99)
  assert.equal(q.fare, 99.99)
  assert.equal(q.bookingFee, 4)
  assert.equal(q.total, 103.99)
  assert.deepEqual(quoteTotals(-50), { fare: 0, bookingFee: 0, total: 0 })
  assert.deepEqual(quoteTotals(Number.NaN), { fare: 0, bookingFee: 0, total: 0 })
})
