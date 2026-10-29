import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lowestPerSite, compareMultipliers, multiplier } from '../src/comparisonQuotes.ts'

test('one lowest known multiplier per site, including zero and tied groups', () => {
  const quotes = [{ id: 1, siteId: 1 }, { id: 2, siteId: 1, groupMultiplier: '0.5' }, { id: 3, siteId: 1, groupMultiplier: 0 }, { id: 4, siteId: 2 }, { id: 5, siteId: 2 }, { id: 6, siteId: 3, groupMultiplier: 1 }, { id: 7, siteId: 3, groupMultiplier: 1 }]
  assert.deepEqual(lowestPerSite(quotes).map(q => q.id), [3, 4, 6])
  assert.equal(quotes.length, 7)
})

test('multiplier sorting keeps missing and invalid values last in either direction', () => {
  const quotes = [{ id: 1 }, { id: 2, groupMultiplier: '0.25' }, { id: 3, groupMultiplier: 2 }, { id: 4, groupMultiplier: 0 }]
  assert.deepEqual([...quotes].sort(compareMultipliers).map(q => q.id), [4, 2, 3, 1])
  assert.deepEqual([...quotes].sort((a, b) => compareMultipliers(a, b, true)).map(q => q.id), [3, 2, 4, 1])
  for (const value of [null, '', -1, 'invalid', Infinity]) assert.equal(multiplier({ id: 1, groupMultiplier: value }), null)
})
