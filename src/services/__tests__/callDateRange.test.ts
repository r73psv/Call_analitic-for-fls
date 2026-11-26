import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCallDateRange,
  filterCallsByDateRange,
  isValidYmdDate,
} from '../callDateRange.js';

const FIXED_NOW = new Date('2026-04-15T12:00:00+04:00');
const TZ = 'Europe/Samara';

test('parseCallDateRange resolves day, week, month, and all presets accurately in salon timezone', () => {
  const all = parseCallDateRange('all', TZ, FIXED_NOW);
  assert.equal(all.valid, true);
  assert.equal(all.preset, 'all');
  assert.equal(all.startYmd, null);
  assert.equal(all.endYmd, null);

  const day = parseCallDateRange('day', TZ, FIXED_NOW);
  assert.equal(day.valid, true);
  assert.equal(day.preset, 'day');
  assert.equal(day.startYmd, '2026-04-15');
  assert.equal(day.endYmd, '2026-04-15');

  const week = parseCallDateRange('week', TZ, FIXED_NOW);
  assert.equal(week.valid, true);
  assert.equal(week.preset, 'week');
  assert.equal(week.startYmd, '2026-04-09');
  assert.equal(week.endYmd, '2026-04-15');

  const month = parseCallDateRange('month', TZ, FIXED_NOW);
  assert.equal(month.valid, true);
  assert.equal(month.preset, 'month');
  assert.equal(month.startYmd, '2026-03-17');
  assert.equal(month.endYmd, '2026-04-15');
});

test('parseCallDateRange validates custom YYYY-MM-DD:YYYY-MM-DD ranges and rejects malformed input', () => {
  const custom = parseCallDateRange('2026-04-01:2026-04-10', TZ, FIXED_NOW);
  assert.equal(custom.valid, true);
  assert.equal(custom.startYmd, '2026-04-01');
  assert.equal(custom.endYmd, '2026-04-10');

  // Reversed bounds are safely normalized
  const reversed = parseCallDateRange('2026-04-10:2026-04-01', TZ, FIXED_NOW);
  assert.equal(reversed.valid, true);
  assert.equal(reversed.startYmd, '2026-04-01');
  assert.equal(reversed.endYmd, '2026-04-10');

  // Invalid calendar dates & arbitrary strings are rejected
  assert.equal(isValidYmdDate('2026-02-30'), false);
  assert.equal(parseCallDateRange('2026-02-30', TZ, FIXED_NOW).valid, false);
  assert.equal(parseCallDateRange('invalid_range', TZ, FIXED_NOW).valid, false);
  assert.equal(parseCallDateRange(':', TZ, FIXED_NOW).valid, false);
});

test('filterCallsByDateRange returns only calls matching the requested day/week/month period', () => {
  const calls = [
    { call_id: 'c-today', timestamp: '2026-04-15T09:30:00+04:00' },
    { call_id: 'c-3days', timestamp: '2026-04-12T18:00:00+04:00' },
    { call_id: 'c-15days', timestamp: '2026-03-31T11:00:00+04:00' },
    { call_id: 'c-old', timestamp: '2026-02-10T10:00:00+04:00' },
  ];

  const dayIds = filterCallsByDateRange(calls, parseCallDateRange('day', TZ, FIXED_NOW), TZ).map((c) => c.call_id);
  assert.deepEqual(dayIds, ['c-today']);

  const weekIds = filterCallsByDateRange(calls, parseCallDateRange('week', TZ, FIXED_NOW), TZ).map((c) => c.call_id);
  assert.deepEqual(weekIds, ['c-today', 'c-3days']);

  const monthIds = filterCallsByDateRange(calls, parseCallDateRange('month', TZ, FIXED_NOW), TZ).map((c) => c.call_id);
  assert.deepEqual(monthIds, ['c-today', 'c-3days', 'c-15days']);

  const allIds = filterCallsByDateRange(calls, parseCallDateRange('all', TZ, FIXED_NOW), TZ).map((c) => c.call_id);
  assert.deepEqual(allIds, ['c-today', 'c-3days', 'c-15days', 'c-old']);
});
