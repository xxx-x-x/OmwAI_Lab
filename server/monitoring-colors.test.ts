import assert from 'node:assert/strict'
import test from 'node:test'
import { monitoringColor } from '../src/monitoringColors.ts'

test('five colors include gray and preserve exact threshold boundaries', () => {
  for (const [rate, color] of [[100, 'up'], [99.999, 'light-green'], [95, 'light-green'], [94.999, 'orange'], [90, 'orange'], [50, 'orange'], [49.999, 'down'], [0, 'down']] as const) assert.equal(monitoringColor(rate, true), color)
  for (const rate of [null, NaN, Infinity, -1, 101]) assert.equal(monitoringColor(rate, true), 'unknown')
  for (const rate of [0, 50, 95, 100]) assert.equal(monitoringColor(rate, false), 'unknown')
})
