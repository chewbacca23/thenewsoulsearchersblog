import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import worker from './cms-oauth-worker.js';
import {
  applyLook,
  berlinDay,
  countryLabel,
  emptyLooks,
  fillLooksInHtml,
  handleLooksPage,
  handleLooksRequest,
  isAdminPath,
  isStatsKvBinding,
  lookFromRequest,
  looksDashboardPage,
  looksSetCookie,
  looksStoreKind,
  looksToken,
  memoryLooksStore,
  recordDocumentLook,
  recordLook,
  sanitizeCountry,
  sanitizeFrom,
  sanitizePath,
  fromSiteHref,
  looksFromRows,
  looksBarsHtml,
  recentDayBars,
  recentMonthBars,
  recentWeekBars,
  shouldCountDocument,
  shouldRecordPath,
  summarizeLooks,
} from './page-looks.js';

const LOOKS_SECRET = 'test-looks-secret';

async function looksAuthEnv(extra = {}) {
  const token = await looksToken(LOOKS_SECRET);
  return {
    GITHUB_OAUTH_CLIENT_SECRET: LOOKS_SECRET,
    cookie: looksSetCookie(token, { secure: false }).split(';')[0],
    ...extra,
  };
}

function withLooksCookie(url, cookie, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('cookie', cookie);
  return new Request(url, { ...init, headers });
}

const SITE_LOOKS = `<html><body>
<p class="card-num" data-looks="today">—</p>
<p class="card-num" data-looks="week">—</p>
<p class="card-num" data-looks="month">—</p>
<p class="card-num" data-looks="year">—</p>
<p class="card-num" data-looks="total">—</p>
<ol class="looks-bars" data-looks-days><li class="empty">no days</li></ol>
<ol class="looks-bars" data-looks-weeks><li class="empty">no weeks</li></ol>
<ol class="looks-bars" data-looks-months><li class="empty">no months</li></ol>
<span data-looks-recent-count>—</span>
<ol class="pages" data-looks-recent><li class="empty">no recent</li></ol>
<script type="application/json" data-looks-recent-json>[]</script>
<ol class="pages" data-looks-years><li class="empty">no years</li></ol>
<ol class="pages" data-looks-pages><li class="empty">none</li></ol>
<ol class="pages" data-looks-cities><li class="empty">no city</li></ol>
<ol class="pages" data-looks-countries><li class="empty">no country</li></ol>
<ol class="pages" data-looks-from><li class="empty">no from</li></ol>
<footer>Looks</footer>
</body></html>`;

describe('sanitizePath', () => {
  it('keeps a public page and drops traversal', () => {
    assert.equal(sanitizePath('/stories/nice?x=1'), '/stories/nice');
    assert.equal(sanitizePath('now'), '/now');
    assert.equal(sanitizePath('/foo/../secret'), '');
  });
});

describe('isAdminPath', () => {
  it('marks the editor page so Looks can sit in the bar', () => {
    assert.equal(isAdminPath('/admin'), true);
    assert.equal(isAdminPath('/admin/'), true);
    assert.equal(isAdminPath('/admin/index.html'), true);
    assert.equal(isAdminPath('/looks'), false);
  });
});

describe('shouldRecordPath', () => {
  it('counts rides and skips the editor', () => {
    assert.equal(shouldRecordPath('/'), true);
    assert.equal(shouldRecordPath('/now'), true);
    assert.equal(shouldRecordPath('/stories/nice'), true);
    assert.equal(shouldRecordPath('/admin'), false);
    assert.equal(shouldRecordPath('/admin/index.html'), false);
    assert.equal(shouldRecordPath('/looks'), false);
    assert.equal(shouldRecordPath('/kit'), true);
    assert.equal(shouldRecordPath('/logo.svg'), false);
    assert.equal(shouldRecordPath('/logo.png'), false);
  });
});

describe('summarizeLooks', () => {
  it('adds today, the week, the year, and the busiest pages', () => {
    const today = berlinDay(new Date('2026-09-04T12:00:00+02:00'));
    const data = applyLook(emptyLooks(), '/', today, {
      country: 'DE',
      city: 'Cologne',
      from: 'Instagram',
    });
    const next = applyLook(data, '/now', today, {
      country: 'FR',
      city: 'Paris',
      from: 'Instagram',
    });
    const extra = applyLook(next, '/now', today, {
      country: 'DE',
      city: 'Cologne',
      from: 'Google',
    });
    const withOld = {
      ...extra,
      days: { ...extra.days, '2025-12-31': 7 },
      total: extra.total + 7,
    };
    const summary = summarizeLooks(withOld, new Date('2026-09-04T12:00:00+02:00'));
    assert.equal(summary.today, 3);
    assert.equal(summary.week, 3);
    assert.equal(summary.month, 3);
    assert.equal(summary.year, 3);
    assert.equal(summary.total, 10);
    assert.deepEqual(summary.years, [
      { name: '2026', looks: 3 },
      { name: '2025', looks: 7 },
    ]);
    assert.deepEqual(summary.pages[0], { path: '/now', looks: 2 });
    assert.deepEqual(summary.countries[0], { name: 'Germany', looks: 2 });
    assert.deepEqual(summary.cities[0], { name: 'Cologne', looks: 2 });
    assert.deepEqual(summary.from[0], { name: 'Instagram', looks: 2 });
    assert.equal(summary.dayBars.length, 14);
    assert.equal(summary.dayBars.at(-1).looks, 3);
    assert.equal(summary.weekBars.length, 8);
    assert.equal(summary.weekBars.at(-1).looks, 3);
    assert.equal(summary.monthBars.length, 12);
    assert.equal(summary.monthBars.at(-1).month, '2026-09');
    assert.equal(summary.monthBars.at(-1).looks, 3);
    assert.equal(summary.monthBars.find((row) => row.month === '2025-12')?.looks, 7);
    assert.equal(summary.recent.length, 3);
    assert.equal(summary.recent[0].path, '/now');
    assert.equal(summary.recent[0].from, 'Google');
    assert.equal(summary.recent[2].path, '/');
  });
});

describe('recentDayBars and recentWeekBars', () => {
  it('builds day and week chart rows for Henrik', () => {
    const now = new Date('2026-09-04T12:00:00+02:00');
    const today = berlinDay(now);
    const days = { [today]: 5, '2026-09-03': 2 };
    const dayBars = recentDayBars(days, now, 3);
    assert.equal(dayBars.length, 3);
    assert.equal(dayBars.at(-1).day, today);
    assert.equal(dayBars.at(-1).looks, 5);
    assert.equal(dayBars.at(-2).looks, 2);

    const weekBars = recentWeekBars(days, now, 2);
    assert.equal(weekBars.length, 2);
    assert.equal(weekBars.at(-1).looks, 7);
    assert.match(weekBars.at(-1).label, /–/);
  });
});

describe('recentMonthBars', () => {
  it('sums Berlin calendar months oldest to newest', () => {
    const now = new Date('2026-09-04T12:00:00+02:00');
    const days = {
      '2026-09-01': 2,
      '2026-09-04': 5,
      '2026-08-20': 3,
      '2026-07-01': 1,
    };
    const monthBars = recentMonthBars(days, now, 3);
    assert.equal(monthBars.length, 3);
    assert.equal(monthBars[0].month, '2026-07');
    assert.equal(monthBars[0].looks, 1);
    assert.equal(monthBars[1].month, '2026-08');
    assert.equal(monthBars[1].looks, 3);
    assert.equal(monthBars[2].month, '2026-09');
    assert.equal(monthBars[2].looks, 7);
    assert.match(monthBars[2].label, /Sep/);
  });
});

describe('looksBarsHtml', () => {
  it('scales upright columns against the busiest day', () => {
    const html = looksBarsHtml(
      [
        { label: 'Mon', looks: 2 },
        { label: 'Tue', looks: 4 },
      ],
      'empty',
    );
    assert.match(html, /height:50%/);
    assert.match(html, /height:100%/);
    assert.match(html, /looks-bar-num"[^>]*>4</);
    assert.match(html, /flex-direction:column/);
    assert.match(html, /looks-line/);
    assert.match(html, /<polyline /);
    assert.match(html, /looks-line-dot/);
    assert.match(html, /border-radius:50%/);
    assert.match(html, /rgba\(212,163,90,0\.38\)/);
  });

  it('puts each stock-ticker dot in the middle of its column', () => {
    const html = looksBarsHtml(
      [
        { label: 'Mon', looks: 2 },
        { label: 'Tue', looks: 4 },
        { label: 'Wed', looks: 3 },
      ],
      'empty',
    );
    // Three equal slots → centers at 16.67%, 50%, 83.33%
    assert.match(html, /left:16\.67%/);
    assert.match(html, /left:50\.00%/);
    assert.match(html, /left:83\.33%/);
    assert.match(html, /points="16\.67,[^"]+ 50\.00,[^"]+ 83\.33,/);
  });
});

describe('sanitizeFrom', () => {
  it('names Instagram and skips our own site', () => {
    assert.equal(
      sanitizeFrom('https://www.instagram.com/p/abc', 'https://thenewsoulsearchers.de/now'),
      'Instagram',
    );
    assert.equal(
      sanitizeFrom('https://thenewsoulsearchers.de/now', 'https://thenewsoulsearchers.de/'),
      'On this site',
    );
    assert.equal(sanitizeFrom('', 'https://thenewsoulsearchers.de/now'), 'Typed or bookmark');
    assert.equal(sanitizeCountry('de'), 'DE');
    assert.equal(countryLabel('DE'), 'Germany');
  });
});

describe('fromSiteHref', () => {
  it('opens Instagram and Facebook, and skips typed visits', () => {
    assert.equal(fromSiteHref('Instagram'), 'https://www.instagram.com/');
    assert.equal(fromSiteHref('Facebook'), 'https://www.facebook.com/');
    assert.equal(fromSiteHref('goldsprint.de'), 'https://goldsprint.de/');
    assert.equal(fromSiteHref('Typed or bookmark'), '');
    assert.equal(fromSiteHref('On this site'), '');
  });
});

describe('looksFromRows', () => {
  it('turns What sent them into clickable site links', () => {
    const html = looksFromRows(
      [
        { name: 'Instagram', looks: 4 },
        { name: 'Typed or bookmark', looks: 2 },
      ],
      'none',
    );
    assert.match(html, /href="https:\/\/www\.instagram\.com\/"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, />Instagram</);
    assert.match(html, /class="looks-name">Typed or bookmark</);
    assert.doesNotMatch(html, /Typed or bookmark<\/a>/);
  });
});

describe('isStatsKvBinding', () => {
  it('accepts STATS objects and rejects fetch-only bindings', () => {
    assert.equal(
      isStatsKvBinding({ get: async () => null, put: async () => {} }),
      true,
    );
    assert.equal(isStatsKvBinding({}), true);
    assert.equal(isStatsKvBinding({ fetch: async () => new Response('') }), false);
    assert.equal(isStatsKvBinding(undefined), false);
  });
});

describe('looksStoreKind', () => {
  it('prefers durable KV over cache', () => {
    assert.equal(
      looksStoreKind({ STATS: { get: async () => null, put: async () => {} } }),
      'kv',
    );
    assert.ok(['cache', 'memory'].includes(looksStoreKind({})));
  });
});

describe('recordLook', () => {
  it('writes a public look and ignores /admin', async () => {
    const store = memoryLooksStore();
    const ok = await recordLook(store, '/stories/nice', new Date('2026-09-04T12:00:00+02:00'));
    const skip = await recordLook(store, '/admin/index.html');
    assert.equal(ok.recorded, true);
    assert.equal(skip.recorded, false);
    const summary = await store.load();
    assert.equal(summary.total, 1);
    assert.equal(summary.paths['/stories/nice'], 1);
  });
});

describe('GET/POST /api/looks', () => {
  it('counts a look then returns the dashboard numbers', async () => {
    const auth = await looksAuthEnv({ STATS: memoryKv() });
    const post = await handleLooksRequest(
      new Request('https://thenewsoulsearchers.de/api/looks', {
        method: 'POST',
        headers: { origin: 'https://thenewsoulsearchers.de', 'content-type': 'text/plain' },
        body: '/now',
      }),
      auth,
    );
    assert.equal(post.status, 204);

    const get = await handleLooksRequest(
      withLooksCookie('https://thenewsoulsearchers.de/api/looks', auth.cookie),
      auth,
    );
    const body = await get.json();
    assert.equal(body.total, 1);
    assert.equal(body.pages[0].path, '/now');
  });

  it('keeps Looks private until login cookie is set', async () => {
    const env = { STATS: memoryKv(), GITHUB_OAUTH_CLIENT_SECRET: LOOKS_SECRET };
    await handleLooksRequest(
      new Request('https://thenewsoulsearchers.de/api/looks', {
        method: 'POST',
        headers: { origin: 'https://thenewsoulsearchers.de', 'content-type': 'text/plain' },
        body: '/now',
      }),
      env,
    );
    const closedApi = await handleLooksRequest(
      new Request('https://thenewsoulsearchers.de/api/looks'),
      env,
    );
    assert.equal(closedApi.status, 401);

    const closedPage = await handleLooksPage(
      new Request('https://thenewsoulsearchers.de/looks'),
      env,
    );
    assert.equal(closedPage.status, 401);
    const closedHtml = await closedPage.text();
    assert.match(closedHtml, /Nothing to see here/);
    assert.doesNotMatch(closedHtml, /GitHub/);

    const closedMembers = await handleLooksPage(
      new Request('https://thenewsoulsearchers.de/members'),
      env,
    );
    assert.equal(closedMembers.status, 401);
    assert.match(await closedMembers.text(), /Nothing to see here/);

    const auth = await looksAuthEnv({ STATS: env.STATS });
    const open = await handleLooksRequest(
      withLooksCookie('https://thenewsoulsearchers.de/api/looks', auth.cookie),
      auth,
    );
    assert.equal(open.status, 200);
    assert.equal((await open.json()).total, 1);

    const page = await handleLooksPage(
      withLooksCookie('https://thenewsoulsearchers.de/looks', auth.cookie),
      auth,
    );
    assert.equal(page.status, 200);
    assert.match(await page.text(), /\/now/);

    await auth.STATS.put(
      'members:list',
      JSON.stringify([{ id: '1', email: 'rider@example.com', name: 'Lars', at: '2026-10-15T12:00:00.000Z' }]),
    );
    const membersPage = await handleLooksPage(
      withLooksCookie('https://thenewsoulsearchers.de/members', auth.cookie),
      auth,
    );
    assert.equal(membersPage.status, 200);
    const membersHtml = await membersPage.text();
    assert.match(membersHtml, /rider@example\.com/);
    assert.match(membersHtml, /Lars/);

    const site = await handleLooksPage(
      withLooksCookie('https://thenewsoulsearchers.de/looks', auth.cookie),
      {
        ...auth,
        ASSETS: {
          fetch: async () =>
            new Response(SITE_LOOKS, { headers: { 'content-type': 'text/html' } }),
        },
      },
    );
    const siteHtml = await site.text();
    assert.match(siteHtml, /<footer>Looks<\/footer>/);
    assert.match(siteHtml, /\/now/);
  });

  it('is reachable through the Worker entrypoint', async () => {
    const auth = await looksAuthEnv({
      STATS: memoryKv(),
      ASSETS: {
        fetch: async () =>
          new Response(SITE_LOOKS, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      },
    });
    await worker.fetch(
      new Request('https://thenewsoulsearchers.de/now', {
        headers: { 'sec-fetch-dest': 'document' },
      }),
      auth,
    );
    const closed = await worker.fetch(new Request('https://thenewsoulsearchers.de/api/looks'), auth);
    assert.equal(closed.status, 401);

    const res = await worker.fetch(
      withLooksCookie('https://thenewsoulsearchers.de/api/looks', auth.cookie),
      auth,
    );
    const body = await res.json();
    assert.equal(body.total, 1);

    const open = await worker.fetch(
      withLooksCookie('https://thenewsoulsearchers.de/looks', auth.cookie),
      auth,
    );
    const html = await open.text();
    assert.match(html, /data-looks="today">1</);
    assert.match(html, /\/now/);
    assert.match(html, /<footer>Looks<\/footer>/);

    const editor = await worker.fetch(
      withLooksCookie('https://thenewsoulsearchers.de/admin/', auth.cookie),
      {
        ...auth,
        ASSETS: {
          fetch: async () =>
            new Response(
              '<a class="cms-looks" href="/looks">Looks <span data-looks="today">—</span></a>',
              { headers: { 'content-type': 'text/html' } },
            ),
        },
      },
    );
    assert.match(await editor.text(), /data-looks="today">1</);

    const editorPublic = await worker.fetch(new Request('https://thenewsoulsearchers.de/admin/'), {
      ...auth,
      ASSETS: {
        fetch: async () =>
          new Response(
            '<a class="cms-looks" href="/looks">Looks <span data-looks="today">—</span></a>',
            { headers: { 'content-type': 'text/html' } },
          ),
      },
    });
    assert.match(await editorPublic.text(), /data-looks="today">—</);
  });

  it('counts a real page open without /api/looks', async () => {
    const auth = await looksAuthEnv({ STATS: memoryKv() });
    const counted = await recordDocumentLook(
      new Request('https://thenewsoulsearchers.de/now', {
        headers: { 'sec-fetch-dest': 'document' },
      }),
      auth,
    );
    assert.equal(counted.recorded, true);
    const page = await handleLooksPage(
      withLooksCookie('https://thenewsoulsearchers.de/looks', auth.cookie),
      auth,
    );
    assert.match(await page.text(), /\/now/);
  });

  it('stores country and the site that sent them', async () => {
    const auth = await looksAuthEnv({ STATS: memoryKv() });
    const request = new Request('https://thenewsoulsearchers.de/now', {
      headers: {
        'sec-fetch-dest': 'document',
        referer: 'https://www.instagram.com/',
      },
    });
    Object.defineProperty(request, 'cf', { value: { country: 'DE', city: 'Cologne' } });
    assert.deepEqual(lookFromRequest(request), {
      country: 'DE',
      city: 'Cologne',
      from: 'Instagram',
      ip: '',
    });
    const withIp = new Request('https://thenewsoulsearchers.de/now', {
      headers: {
        'sec-fetch-dest': 'document',
        referer: 'https://www.instagram.com/',
        'cf-connecting-ip': '203.0.113.10',
      },
    });
    Object.defineProperty(withIp, 'cf', { value: { country: 'DE', city: 'Freiburg' } });
    assert.equal(lookFromRequest(withIp).ip, '203.0.113.10');
    assert.equal(lookFromRequest(withIp).city, 'Freiburg');
    await recordDocumentLook(withIp, auth);
    const html = await (
      await handleLooksPage(
        withLooksCookie('https://thenewsoulsearchers.de/looks', auth.cookie),
        auth,
      )
    ).text();
    assert.match(html, /Germany/);
    assert.match(html, /Freiburg/);
    assert.match(html, /href="https:\/\/www\.instagram\.com\/"/);
    assert.match(html, />Instagram</);
  });
});

describe('shouldCountDocument', () => {
  it('counts a page open and skips a photo', () => {
    assert.equal(
      shouldCountDocument(new Request('https://thenewsoulsearchers.de/now')),
      true,
    );
    assert.equal(
      shouldCountDocument(new Request('https://thenewsoulsearchers.de/stories/img_5940.jpg')),
      false,
    );
  });
});

describe('fillLooksInHtml', () => {
  it('writes the counts into the site page', () => {
    const html = fillLooksInHtml(SITE_LOOKS, {
      today: 2,
      week: 5,
      month: 11,
      year: 8,
      total: 9,
      years: [{ name: '2026', looks: 8 }],
      pages: [{ path: '/', looks: 4 }],
      countries: [{ name: 'Germany', looks: 3 }],
      cities: [{ name: 'Cologne', looks: 2 }],
      from: [{ name: 'Instagram', looks: 2 }],
      recent: [
        {
          t: '2026-09-04T10:05:00.000Z',
          path: '/stories/nice',
          country: 'DE',
          city: 'Cologne',
          from: 'Instagram',
        },
      ],
      dayBars: [
        { label: 'Wed', looks: 1 },
        { label: 'Thu', looks: 2 },
      ],
      weekBars: [{ label: '1–7 Sep', looks: 5 }],
      monthBars: [{ label: 'Sep 26', looks: 11 }],
    });
    assert.match(html, /data-looks="today">2</);
    assert.match(html, /data-looks="week">5</);
    assert.match(html, /data-looks="month">11</);
    assert.match(html, /data-looks="year">8</);
    assert.match(html, /data-looks="total">9</);
    assert.match(html, /Home/);
    assert.match(html, /Germany/);
    assert.match(html, /Cologne/);
    assert.match(html, /class="looks-name">2026</);
    assert.match(html, /href="https:\/\/www\.instagram\.com\/"/);
    assert.match(html, />Instagram</);
    assert.match(html, /looks-bar-label"[^>]*>Thu</);
    assert.match(html, /1–7 Sep/);
    assert.match(html, /Sep 26/);
    assert.match(html, /width:100%/);
    assert.match(html, /looks-recent/);
    assert.match(html, /\/stories\/nice/);
    assert.match(html, /looks-recent-when/);
    assert.match(html, /data-looks-recent-count[^>]*>1</);
    assert.match(html, /data-looks-recent-json[^>]*>\[/);
    assert.match(html, /<footer>Looks<\/footer>/);
  });
});

describe('looksDashboardPage', () => {
  it('prints the numbers in the HTML', async () => {
    const html = await looksDashboardPage({
      today: 2,
      week: 5,
      month: 11,
      year: 8,
      total: 9,
      years: [{ name: '2026', looks: 8 }],
      pages: [{ path: '/', looks: 4 }],
    }).text();
    assert.match(html, />2</);
    assert.match(html, />5</);
    assert.match(html, />11</);
    assert.match(html, />8</);
    assert.match(html, />9</);
    assert.match(html, /looks-bay-label">Month</);
    assert.match(html, /looks-bay-label">Year</);
    assert.match(html, /looks-board/);
    assert.match(html, /<h2>12 months<\/h2>/);
    assert.match(html, /<h2>Years<\/h2>/);
    assert.match(html, /<h2>Cities<\/h2>/);
    assert.match(html, /data-looks="month"/);
    assert.match(html, /data-looks="today"/);
    assert.match(html, /Home/);
    const withFrom = await looksDashboardPage({
      today: 1,
      week: 1,
      year: 1,
      total: 1,
      years: [{ name: '2026', looks: 1 }],
      pages: [],
      countries: [{ name: 'France', looks: 1 }],
      cities: [{ name: 'Freiburg', looks: 1 }],
      from: [{ name: 'Google', looks: 1 }],
    }).text();
    assert.match(withFrom, /France/);
    assert.match(withFrom, /Freiburg/);
    assert.match(withFrom, /href="https:\/\/www\.google\.com\/"/);
    assert.match(withFrom, />Google</);
  });
});

function memoryKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, value);
    },
  };
}
