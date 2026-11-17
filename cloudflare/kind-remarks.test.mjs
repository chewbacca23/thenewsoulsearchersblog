import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AWESOME_LABEL,
  POSITIVE_LEAD,
  handleRemarksRequest,
  injectKindRemarks,
  isKindMessage,
  isPositiveMessage,
  normalizeRemarkPath,
  parseRemarkBody,
  validateRemark,
} from './kind-remarks.js';

describe('normalizeRemarkPath', () => {
  it('keeps a clean public path', () => {
    assert.equal(normalizeRemarkPath('/stories/nice'), '/stories/nice');
    assert.equal(normalizeRemarkPath('/stories/nice/'), '/stories/nice');
    assert.equal(normalizeRemarkPath(''), '');
  });

  it('drops admin, auth, looks, and api paths', () => {
    assert.equal(normalizeRemarkPath('/admin'), '');
    assert.equal(normalizeRemarkPath('/admin/index.html'), '');
    assert.equal(normalizeRemarkPath('/auth'), '');
    assert.equal(normalizeRemarkPath('/callback'), '');
    assert.equal(normalizeRemarkPath('/looks'), '');
    assert.equal(normalizeRemarkPath('/api/remarks'), '');
  });

  it('reads a path out of a full URL', () => {
    assert.equal(
      normalizeRemarkPath('https://thenewsoulsearchers.de/week'),
      '/week',
    );
  });
});

describe('isKindMessage', () => {
  it('accepts a warm line', () => {
    assert.equal(isKindMessage('Beautiful climb — thank you for sharing.'), true);
    assert.equal(isKindMessage('Schöner Tag auf dem Rad.'), true);
  });

  it('rejects rude or hostile words', () => {
    assert.equal(isKindMessage('This is stupid and I hate it.'), false);
    assert.equal(isKindMessage('Was für ein Arschloch.'), false);
  });

  it('rejects links and markup', () => {
    assert.equal(isKindMessage('Visit https://spam.example for more'), false);
    assert.equal(isKindMessage('Click www.bad.example now please'), false);
    assert.equal(isKindMessage('<script>alert(1)</script> hello'), false);
  });

  it('stays softer than the remark filter', () => {
    assert.equal(isKindMessage('Window seat after a wet ride'), true);
    assert.equal(isPositiveMessage('Window seat after a wet ride'), false);
  });
});

describe('isPositiveMessage', () => {
  it('needs a warm English or German cue', () => {
    assert.equal(isPositiveMessage('Beautiful climb — thank you for sharing.'), true);
    assert.equal(isPositiveMessage('Schöner Tag auf dem Rad.'), true);
    assert.equal(isPositiveMessage('Danke, das war wunderschön.'), true);
    assert.equal(isPositiveMessage('Loved the coast road.'), true);
    assert.equal(isPositiveMessage('I rode along the coast today.'), false);
  });

  it('rejects lectures even when a warm word is mixed in', () => {
    assert.equal(isPositiveMessage('You should love this sport more.'), false);
    assert.equal(isPositiveMessage('Let me explain why the sunset was beautiful.'), false);
    assert.equal(isPositiveMessage('Du solltest dankbar sein.'), false);
  });

  it('rejects a negated warm word', () => {
    assert.equal(isPositiveMessage('This is not great at all.'), false);
    assert.equal(isPositiveMessage('Das war nicht schön.'), false);
  });
});

describe('parseRemarkBody and validateRemark', () => {
  it('trims fields and keeps a clean note', () => {
    const fields = parseRemarkBody({
      path: '/about/',
      name: '  Ana  ',
      message: '  Loved the coast road.  ',
      website: '',
    });
    assert.equal(fields.path, '/about');
    assert.equal(fields.name, 'Ana');
    assert.equal(fields.message, 'Loved the coast road.');
    assert.equal(validateRemark(fields), '');
  });

  it('refuses a honeypot-free rude note', () => {
    const fields = parseRemarkBody({
      path: '/about',
      name: '',
      message: 'You suck at this.',
    });
    assert.match(validateRemark(fields), /kind words/i);
  });

  it('asks for a longer message', () => {
    const fields = parseRemarkBody({ path: '/', message: 'Hi' });
    assert.match(validateRemark(fields), /at least/i);
  });

  it('refuses a lecture and a flat note', () => {
    const lecture = parseRemarkBody({
      path: '/',
      message: 'Let me explain why you should train harder.',
    });
    assert.match(validateRemark(lecture), /positive thoughts/i);
    const flat = parseRemarkBody({
      path: '/',
      message: 'I rode along the coast today.',
    });
    assert.match(validateRemark(flat), /positive thoughts/i);
  });
});

describe('injectKindRemarks', () => {
  it('places the strip after main once', () => {
    const once = injectKindRemarks('<main>ride</main><script></script></body>');
    assert.match(once, /class="kind-remarks"/);
    assert.match(once, /<\/main>\s*<style>/);
    const twice = injectKindRemarks(once);
    assert.equal(twice, once);
    assert.match(once, new RegExp(POSITIVE_LEAD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(once, /data-kind-awesome/);
    assert.match(once, new RegExp(AWESOME_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

describe('handleRemarksRequest', () => {
  function memoryKv(start = {}) {
    const store = { ...start };
    return {
      async get(key) {
        return store[key] ?? null;
      },
      async put(key, value) {
        store[key] = value;
      },
      _store: store,
    };
  }

  it('returns an empty list for a fresh path', async () => {
    const res = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks?path=/about'),
      { STATS: memoryKv() },
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.deepEqual(data.remarks, []);
    assert.equal(data.awesome, 0);
  });

  it('saves a kind word and lists it back', async () => {
    const kv = memoryKv();
    const post = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/stories/demo',
          name: 'Lars',
          message: 'Great ride notes — keep going.',
        }),
      }),
      { STATS: kv },
    );
    assert.equal(post.status, 200);
    const saved = await post.json();
    assert.equal(saved.ok, true);
    assert.equal(saved.remark.message, 'Great ride notes — keep going.');

    const get = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks?path=/stories/demo'),
      { STATS: kv },
    );
    const listed = await get.json();
    assert.equal(listed.count, 1);
    assert.equal(listed.remarks.length, 1);
    assert.equal(listed.remarks[0].name, 'Lars');

    const elsewhere = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks?path=/about'),
      { STATS: kv },
    );
    const shared = await elsewhere.json();
    assert.equal(shared.count, 1);
    assert.equal(shared.remarks[0].name, 'Lars');
    assert.equal(shared.awesome, 0);
  });

  it('folds per-page words into one box with a count', async () => {
    const kv = memoryKv({
      'remarks:path:/': JSON.stringify([
        {
          id: 'home1',
          name: 'Ada',
          message: 'Lovely home page, thank you.',
          at: '2026-11-01T10:00:00.000Z',
        },
      ]),
      'remarks:path:/about': JSON.stringify([
        {
          id: 'about1',
          name: 'Bea',
          message: 'Kind words for the about page.',
          at: '2026-11-02T10:00:00.000Z',
        },
      ]),
    });
    kv.list = async ({ prefix }) => ({
      keys: Object.keys(kv._store)
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
    });

    const home = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks?path=/'),
      { STATS: kv },
    );
    const homeData = await home.json();
    assert.equal(homeData.count, 2);
    assert.deepEqual(
      homeData.remarks.map((item) => item.name),
      ['Bea', 'Ada'],
    );

    const again = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks?path=/about'),
      { STATS: kv },
    );
    const aboutData = await again.json();
    assert.equal(aboutData.count, 2);
  });

  it('pretends success for a filled honeypot', async () => {
    const res = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/',
          message: 'Nice site, brother.',
          website: 'http://bot.test',
        }),
      }),
      { STATS: memoryKv() },
    );
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.via, 'discard');
  });

  it('rejects a rude post before saving', async () => {
    const kv = memoryKv();
    const res = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/',
          message: 'This blog is stupid trash.',
        }),
      }),
      { STATS: kv },
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /kind words/i);
    assert.match(data.error, /positive thoughts/i);
    assert.equal(Object.keys(kv._store).filter((k) => k.startsWith('remarks:path:')).length, 0);
    assert.equal(JSON.stringify(kv._store).includes('stupid'), false);
  });

  it('publishes an awesome tap straight into the public count', async () => {
    const kv = memoryKv();
    const post = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/about', kind: 'awesome' }),
      }),
      { STATS: kv },
    );
    assert.equal(post.status, 200);
    const saved = await post.json();
    assert.equal(saved.ok, true);
    assert.equal(saved.awesome, 1);
    assert.equal(kv._store['remarks:awesome:/about'], '1');

    const again = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/about', kind: 'awesome' }),
      }),
      { STATS: kv },
    );
    assert.equal((await again.json()).awesome, 2);

    const get = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks?path=/about'),
      { STATS: kv },
    );
    const listed = await get.json();
    assert.equal(listed.awesome, 2);
    assert.deepEqual(listed.remarks, []);
    assert.equal(listed.queue, undefined);
  });

  it('discards a honeypot awesome tap without counting', async () => {
    const kv = memoryKv();
    const res = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/about',
          kind: 'awesome',
          website: 'http://bot.test',
        }),
      }),
      { STATS: kv },
    );
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.via, 'discard');
    assert.equal(kv._store['remarks:awesome:/about'], undefined);
  });

  it('refuses a lecture and never stores the text', async () => {
    const kv = memoryKv();
    const message = 'Let me explain why you should train harder on this climb.';
    const res = await handleRemarksRequest(
      new Request('https://thenewsoulsearchers.de/api/remarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/stories/demo', message }),
      }),
      { STATS: kv },
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /positive thoughts/i);
    const blob = JSON.stringify(kv._store);
    assert.equal(blob.includes('explain'), false);
    assert.equal(blob.includes(message), false);
    assert.equal(
      Object.keys(kv._store).some(
        (key) => key.startsWith('remarks:path:') || key.startsWith('remarks:awesome:'),
      ),
      false,
    );
  });
});
