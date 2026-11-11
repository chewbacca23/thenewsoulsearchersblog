import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleWeekStandRequest,
  isoWeekKey,
  parseStandBody,
  publicStands,
  validateStand,
  weekLabel,
} from './week-stand.js';

describe('week keys', () => {
  it('labels this week and last week', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    const thisWeek = isoWeekKey(now);
    assert.match(thisWeek, /^2026-W\d{2}$/);
    assert.equal(weekLabel(thisWeek, now), 'This week');
    assert.equal(weekLabel(isoWeekKey(now - 7 * 86400000), now), 'Last week');
  });
});

describe('validateStand', () => {
  it('wants a name and a place', () => {
    assert.match(validateStand({ name: '', place: 'Berlin', tip: '' }), /first name/i);
    assert.match(validateStand({ name: 'Henrik', place: '', tip: '' }), /stand/i);
    assert.equal(validateStand({ name: 'Henrik', place: 'Café Neulich', tip: 'Flat white after the rain' }), '');
  });

  it('keeps the wall kind', () => {
    assert.match(
      validateStand({ name: 'Alex', place: 'Berlin', tip: 'This place is stupid trash' }),
      /kind/i,
    );
  });
});

describe('handleWeekStandRequest', () => {
  it('stores a public stand in KV', async () => {
    const store = new Map();
    const env = {
      STATS: {
        async get(key) {
          return store.get(key) ?? null;
        },
        async put(key, value) {
          store.set(key, value);
        },
      },
    };

    const post = await handleWeekStandRequest(
      new Request('https://thenewsoulsearchers.de/api/week-stand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Hanna',
          place: 'Kaffeehaus Kreuzberg',
          tip: 'Window seat after a wet ride',
        }),
      }),
      env,
    );
    assert.equal(post.status, 200);
    const body = await post.json();
    assert.equal(body.ok, true);
    assert.equal(body.stand.place, 'Kaffeehaus Kreuzberg');

    const get = await handleWeekStandRequest(
      new Request('https://thenewsoulsearchers.de/api/week-stand'),
      env,
    );
    const listed = await get.json();
    assert.equal(listed.ok, true);
    assert.ok(listed.stands.some((row) => row.name === 'Hanna'));
    assert.equal(publicStands(listed.stands)[0].name, 'Hanna');
  });

  it('swallows honeypot posts', async () => {
    const res = await handleWeekStandRequest(
      new Request('https://thenewsoulsearchers.de/api/week-stand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parseStandBody({ name: 'Bot', place: 'Spam', website: 'http://x.test' })),
      }),
      {},
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).via, 'discard');
  });
});
