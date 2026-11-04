import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FRESH_DAYS, anyFresh, isFresh } from './fresh.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('isFresh', () => {
  it('marks something posted today as new', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    assert.equal(isFresh(new Date('2026-11-04T08:00:00Z'), now), true);
  });

  it(`stays new through day ${FRESH_DAYS - 1}`, () => {
    const now = new Date('2026-11-04T12:00:00Z');
    assert.equal(isFresh(new Date(now.valueOf() - (FRESH_DAYS - 1) * DAY), now), true);
  });

  it(`drops after ${FRESH_DAYS} days`, () => {
    const now = new Date('2026-11-04T12:00:00Z');
    assert.equal(isFresh(new Date(now.valueOf() - FRESH_DAYS * DAY), now), false);
  });

  it('rejects future and empty dates', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    assert.equal(isFresh(new Date('2026-11-05T12:00:00Z'), now), false);
    assert.equal(isFresh(null, now), false);
    assert.equal(isFresh(undefined, now), false);
    assert.equal(isFresh('', now), false);
  });
});

describe('anyFresh', () => {
  it('is true when one date in the list is still new', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    assert.equal(anyFresh([new Date('2026-10-01'), new Date('2026-11-03')], now), true);
    assert.equal(anyFresh([new Date('2026-10-01'), new Date('2026-09-01')], now), false);
  });
});
