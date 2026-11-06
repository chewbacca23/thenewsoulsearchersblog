/**
 * Thin tires pulse — every 3 days pull road-cycling RSS into KV + GitHub
 * markdown (Decap-editable), then inject the live list on /pulse and home.
 */

const REPO = 'chewbacca23/thenewsoulsearchersblog';
const BRANCH = 'main';
const PULSE_KV_KEY = 'pulse:v1';
const PULSE_DIR = 'src/content/pulse';
const MAX_KEEP = 24;
const PICK_PER_RUN = 5;
const FRESH_MS = 5 * 24 * 60 * 60 * 1000;

export const PULSE_FEEDS = [
  {
    source: 'Cyclingnews',
    url: 'https://airedale.futurecdn.net/feeds/en_US_feed_271bdec3.rss',
  },
  {
    source: 'Escape Collective',
    url: 'https://escapecollective.com/rss/',
  },
  {
    source: 'Cycling Weekly',
    url: 'https://www.cyclingweekly.com/feed',
  },
];

const SKIP_TITLE =
  /\b(e-?bike|ebike|mtb|mountain bike|gravel|cyclo-?cross|cyclocross|bmx|enduro|downhill)\b/i;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeXml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function tagText(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = String(block || '').match(re);
  return match ? decodeXml(match[1]) : '';
}

function attr(block, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  const match = String(block || '').match(re);
  return match ? match[1].trim() : '';
}

export function extractImage(block) {
  const media =
    attr(String(block).match(/<media:content\b[^>]*>/i)?.[0] || '', 'url') ||
    attr(String(block).match(/<media:thumbnail\b[^>]*>/i)?.[0] || '', 'url') ||
    attr(String(block).match(/<enclosure\b[^>]*type=["']image/i)?.[0] || '', 'url');
  if (media) return media;
  const htmlImg = String(block).match(/<img[^>]+src=["']([^"']+)["']/i);
  return htmlImg ? htmlImg[1].trim() : '';
}

export function itemIdFromUrl(url) {
  const path = String(url || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split(/[?#]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return path || `pulse-${Date.now()}`;
}

export function slugForItem(item) {
  const day = (item.pubDate || new Date().toISOString()).slice(0, 10);
  const base = String(item.title || 'pulse')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${day}-${base || 'item'}`;
}

export function parseRssItems(xml, source) {
  const chunks = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return chunks.map((block) => {
    const title = stripHtml(tagText(block, 'title'));
    const link = stripHtml(tagText(block, 'link')) || stripHtml(tagText(block, 'guid'));
    const description = stripHtml(tagText(block, 'description')).slice(0, 280);
    const pubRaw = tagText(block, 'pubDate') || tagText(block, 'dc:date');
    const pubMs = Date.parse(pubRaw);
    const pubDate = Number.isFinite(pubMs)
      ? new Date(pubMs).toISOString()
      : new Date().toISOString();
    const image = extractImage(block);
    return {
      id: itemIdFromUrl(link),
      title,
      link,
      source: source || 'Cycling',
      note: description,
      image,
      pubDate,
      draft: false,
    };
  });
}

export function isRoadish(item) {
  const title = String(item?.title || '');
  if (!title) return false;
  if (SKIP_TITLE.test(title)) return false;
  return Boolean(item.link);
}

export function pickPulseItems(candidates, existing = [], now = Date.now()) {
  const seen = new Set(
    (existing || []).map((row) => String(row.link || row.id || '').toLowerCase()).filter(Boolean),
  );
  const fresh = [];
  for (const item of candidates) {
    if (!isRoadish(item)) continue;
    const key = String(item.link || item.id || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    const age = now - Date.parse(item.pubDate);
    if (Number.isFinite(age) && (age < 0 || age > FRESH_MS)) continue;
    seen.add(key);
    fresh.push(item);
    if (fresh.length >= PICK_PER_RUN) break;
  }
  const merged = [...fresh, ...(existing || [])];
  const dedup = [];
  const urls = new Set();
  for (const row of merged) {
    const key = String(row.link || row.id || '').toLowerCase();
    if (!key || urls.has(key)) continue;
    if (row.draft) continue;
    urls.add(key);
    dedup.push(row);
    if (dedup.length >= MAX_KEEP) break;
  }
  return { added: fresh, items: dedup };
}

export function pulseMarkdown(item) {
  const title = String(item.title || 'Pulse').replace(/"/g, '\\"');
  const note = String(item.note || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  const lines = [
    '---',
    `title: "${title}"`,
    `pubDate: ${String(item.pubDate || '').slice(0, 10)}`,
    `source: "${String(item.source || '').replace(/"/g, '')}"`,
    `url: "${String(item.link || '').replace(/"/g, '')}"`,
    `image: "${String(item.image || '').replace(/"/g, '')}"`,
    'draft: false',
    'note: >-',
    note || '  ',
    '---',
    '',
  ];
  return lines.join('\n');
}

export function pulseListHtml(items) {
  const list = Array.isArray(items) ? items.filter((row) => !row.draft) : [];
  if (!list.length) {
    return `<li class="empty">Thin tires news lands here every few days.</li>`;
  }
  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  });
  return list
    .map((item) => {
      const when = Number.isFinite(Date.parse(item.pubDate))
        ? dateFmt.format(new Date(item.pubDate))
        : '';
      const img = item.image
        ? `<img class="pulse-thumb" src="${escapeHtml(item.image)}" alt="" width="320" height="200" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
        : '';
      return (
        `<li class="pulse-item">` +
        (img ? `<a class="pulse-media" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${img}</a>` : '') +
        `<div class="pulse-copy">` +
        `<p class="pulse-meta">${escapeHtml([item.source, when].filter(Boolean).join(' · '))}</p>` +
        `<h2 class="pulse-title"><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h2>` +
        (item.note ? `<p class="pulse-note">${escapeHtml(item.note)}</p>` : '') +
        `</div></li>`
      );
    })
    .join('');
}

export function pulseTeaseHtml(items) {
  const list = (Array.isArray(items) ? items.filter((row) => !row.draft) : []).slice(0, 3);
  if (!list.length) {
    return `<li class="empty"><a href="/pulse">Thin tires</a> — road news when it lands.</li>`;
  }
  return list
    .map((item) => {
      return (
        `<li class="pulse-tease-item">` +
        `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>` +
        `<span class="pulse-tease-source">${escapeHtml(item.source || '')}</span>` +
        `</li>`
      );
    })
    .join('');
}

export function fillPulseInHtml(html, items) {
  const list = Array.isArray(items) ? items : [];
  return String(html)
    .replace(/<ol([^>]*data-pulse-list[^>]*)>[\s\S]*?<\/ol>/, `<ol$1>${pulseListHtml(list)}</ol>`)
    .replace(
      /<ol([^>]*data-pulse-tease[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${pulseTeaseHtml(list)}</ol>`,
    );
}

function githubToken(env) {
  const keys = ['GITHUB_PULSE_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export async function readPulse(env) {
  try {
    const raw = await env?.STATS?.get?.(PULSE_KV_KEY, 'json');
    if (raw && Array.isArray(raw.items)) return raw.items;
  } catch {
    /* keep empty */
  }
  return [];
}

export async function writePulse(env, items, meta = {}) {
  if (!env?.STATS?.put) return;
  await env.STATS.put(
    PULSE_KV_KEY,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      items: Array.isArray(items) ? items : [],
      ...meta,
    }),
  );
}

async function fetchFeedXml(url) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/rss+xml, application/xml, text/xml, */*',
      'user-agent': 'SoulSearchersPulse/1.0 (+https://thenewsoulsearchers.de/pulse)',
    },
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return res.text();
}

export async function gatherCandidates(fetchXml = fetchFeedXml) {
  const all = [];
  for (const feed of PULSE_FEEDS) {
    try {
      const xml = await fetchXml(feed.url);
      all.push(...parseRssItems(xml, feed.source));
    } catch {
      /* skip dead feed */
    }
  }
  all.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  return all;
}

async function githubPutFile(env, path, content, message) {
  const token = githubToken(env);
  if (!token) return { ok: false, reason: 'no-token' };
  const api = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'soul-searchers-pulse',
    'content-type': 'application/json',
  };
  let sha = '';
  try {
    const existing = await fetch(`${api}?ref=${BRANCH}`, { headers });
    if (existing.ok) {
      const body = await existing.json();
      sha = body.sha || '';
    }
  } catch {
    /* create */
  }
  const payload = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: BRANCH,
  };
  if (sha) payload.sha = sha;
  const res = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, reason: `github ${res.status} ${text.slice(0, 120)}` };
  }
  return { ok: true };
}

export async function commitPulseItems(env, items) {
  const results = [];
  for (const item of items) {
    const slug = slugForItem(item);
    const path = `${PULSE_DIR}/${slug}.md`;
    const result = await githubPutFile(
      env,
      path,
      pulseMarkdown(item),
      `Thin tires: ${String(item.title || slug).slice(0, 72)}`,
    );
    results.push({ slug, ...result });
  }
  return results;
}

export async function runPulseCron(env, deps = {}) {
  const fetchXml = deps.fetchXml || fetchFeedXml;
  const existing = await readPulse(env);
  const candidates = await gatherCandidates(fetchXml);
  const { added, items } = pickPulseItems(candidates, existing);
  await writePulse(env, items, { added: added.length });
  let commits = [];
  if (added.length) {
    try {
      commits = await commitPulseItems(env, added);
    } catch (error) {
      commits = [{ ok: false, reason: String(error?.message || error) }];
    }
  }
  return { added: added.length, total: items.length, commits };
}

function pulsePath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return path === '/pulse' || path === '/';
}

export async function applyPulseToAsset(request, env, asset) {
  const url = new URL(request.url);
  if (!pulsePath(url.pathname)) return asset;
  if (!asset || !asset.ok) return asset;
  const type = asset.headers.get('content-type') || '';
  if (type && !type.includes('html') && !type.includes('text')) return asset;
  const items = await readPulse(env);
  if (!items.length) return asset;
  const html = await asset.text();
  const filled = fillPulseInHtml(html, items);
  const headers = new Headers(asset.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(filled, { status: asset.status, headers });
}

export async function handlePulseRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/pulse' && request.method === 'GET') {
    const items = await readPulse(env);
    return Response.json({
      updatedAt: new Date().toISOString(),
      count: items.length,
      items,
    });
  }
  if (url.pathname === '/api/pulse/run' && request.method === 'POST') {
    const auth = request.headers.get('authorization') || '';
    const token = githubToken(env);
    if (!token || auth !== `Bearer ${token}`) {
      return new Response('Nope', { status: 401 });
    }
    const result = await runPulseCron(env);
    return Response.json(result);
  }
  return null;
}
