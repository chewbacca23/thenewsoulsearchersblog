/**
 * Thin tires pulse — every 2 days pull cycling RSS into KV + GitHub
 * markdown (Decap-editable), then inject live sections on /pulse and home.
 * Sections: road race men, road race women, cyclo-cross.
 */

const REPO = 'chewbacca23/thenewsoulsearchersblog';
const BRANCH = 'main';
const PULSE_KV_KEY = 'pulse:v1';
const PULSE_DIR = 'src/content/pulse';
const MAX_KEEP_PER_SECTION = 8;
const PICK_PER_SECTION = 2;
const FRESH_MS = 5 * 24 * 60 * 60 * 1000;

export const PULSE_SECTIONS = [
  { id: 'road-men', label: 'Road race — men' },
  { id: 'road-women', label: 'Road race — women' },
  { id: 'cyclo-cross', label: 'Cyclo-cross' },
];

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

const SKIP_NOISE =
  /\b(e-?bike|ebike|mtb|mountain bike|gravel|bmx|enduro|downhill)\b/i;
const CX_HIT =
  /cyclo-?\s*cross|cyclocross|\bcx\b|koppenberg|namur|dendermonde|overijse|world cup[\s\S]{0,24}cross|cross world/i;
const WOMEN_HIT =
  /\b(women'?s?|womens|woman|female|femmes?|ladies|girls|uci women|tour de france femmes|giro d['’]?italia women|vuelta.*women|women'?s worldtour|women'?s cycling)\b/i;

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

export function extractCategories(block) {
  const cats = [];
  const re = /<category\b[^>]*>([\s\S]*?)<\/category>/gi;
  let match;
  while ((match = re.exec(String(block || '')))) {
    const text = stripHtml(match[1]);
    if (text) cats.push(text);
  }
  return cats;
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

export function sectionLabel(id) {
  return PULSE_SECTIONS.find((row) => row.id === id)?.label || 'From the peloton';
}

/** Sort item into a hype section, or null if it does not belong. */
export function classifyPulseSection(item) {
  const title = String(item?.title || '');
  const note = String(item?.note || '');
  const link = String(item?.link || '');
  const cats = Array.isArray(item?.categories) ? item.categories.join(' ') : '';
  const hay = `${title} ${note} ${link} ${cats}`;
  if (!title || !item?.link) return null;
  if (CX_HIT.test(hay)) return 'cyclo-cross';
  if (WOMEN_HIT.test(hay)) return 'road-women';
  if (SKIP_NOISE.test(hay)) return null;
  return 'road-men';
}

/** @deprecated use classifyPulseSection — kept for older tests */
export function isRoadish(item) {
  return classifyPulseSection(item) != null;
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
    const categories = extractCategories(block);
    const base = {
      id: itemIdFromUrl(link),
      title,
      link,
      source: source || 'Cycling',
      note: description,
      image,
      pubDate,
      categories,
      draft: false,
    };
    return { ...base, section: classifyPulseSection(base) };
  });
}

export function pickPulseItems(candidates, existing = [], now = Date.now()) {
  const seen = new Set(
    (existing || []).map((row) => String(row.link || row.id || '').toLowerCase()).filter(Boolean),
  );
  const fresh = [];
  const pickedPerSection = Object.fromEntries(PULSE_SECTIONS.map((s) => [s.id, 0]));

  for (const raw of candidates) {
    const section = raw.section || classifyPulseSection(raw);
    if (!section) continue;
    const item = { ...raw, section };
    const key = String(item.link || item.id || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    const age = now - Date.parse(item.pubDate);
    if (Number.isFinite(age) && (age < 0 || age > FRESH_MS)) continue;
    if ((pickedPerSection[section] || 0) >= PICK_PER_SECTION) continue;
    seen.add(key);
    pickedPerSection[section] = (pickedPerSection[section] || 0) + 1;
    fresh.push(item);
  }

  const merged = [...fresh, ...(existing || [])].map((row) => ({
    ...row,
    section: row.section || classifyPulseSection(row) || 'road-men',
  }));

  const perSection = Object.fromEntries(PULSE_SECTIONS.map((s) => [s.id, []]));
  const urls = new Set();
  for (const row of merged) {
    const key = String(row.link || row.id || '').toLowerCase();
    if (!key || urls.has(key) || row.draft) continue;
    const section = row.section || 'road-men';
    if (!perSection[section]) continue;
    if (perSection[section].length >= MAX_KEEP_PER_SECTION) continue;
    urls.add(key);
    perSection[section].push(row);
  }

  const items = PULSE_SECTIONS.flatMap((s) => perSection[s.id]);
  return { added: fresh, items };
}

export function groupPulseBySection(items) {
  const list = Array.isArray(items) ? items.filter((row) => !row.draft) : [];
  return PULSE_SECTIONS.map((section) => ({
    ...section,
    items: list.filter((row) => (row.section || 'road-men') === section.id),
  }));
}

export function pulseMarkdown(item) {
  const title = String(item.title || 'Pulse').replace(/"/g, '\\"');
  const note = String(item.note || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  const section = item.section || classifyPulseSection(item) || 'road-men';
  const lines = [
    '---',
    `title: "${title}"`,
    `pubDate: ${String(item.pubDate || '').slice(0, 10)}`,
    `section: ${section}`,
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

const SECTION_KICKER = {
  'road-men': 'Peloton',
  'road-women': 'WorldTour',
  'cyclo-cross': 'Mud',
};

function pulseRestItemsHtml(list, dateFmt) {
  return list
    .map((item) => {
      const when = Number.isFinite(Date.parse(item.pubDate))
        ? dateFmt.format(new Date(item.pubDate))
        : '';
      const media = item.image
        ? `<a class="pulse-media" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">` +
          `<img class="pulse-thumb" src="${escapeHtml(item.image)}" alt="" width="320" height="200" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>`
        : `<span class="pulse-media pulse-media--blank" aria-hidden="true"></span>`;
      return (
        `<li class="pulse-item">` +
        media +
        `<div class="pulse-copy">` +
        `<p class="pulse-meta">${escapeHtml([item.source, when].filter(Boolean).join(' · '))}</p>` +
        `<h3 class="pulse-title"><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>` +
        (item.note ? `<p class="pulse-note">${escapeHtml(item.note)}</p>` : '') +
        `</div></li>`
      );
    })
    .join('');
}

export function pulseBoardHtml(items) {
  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  });
  const groups = groupPulseBySection(items);
  if (!groups.some((g) => g.items.length)) {
    return `<p class="empty">Thin tires news lands here every couple of days.</p>`;
  }
  return groups
    .map((group) => {
      const [lead, ...rest] = group.items;
      const count =
        group.items.length === 0
          ? 'Quiet'
          : `${group.items.length} ${group.items.length === 1 ? 'story' : 'stories'}`;
      const kicker = SECTION_KICKER[group.id] || 'Pulse';
      let feature = `<p class="empty">Quiet in this lane — check back in a couple of days.</p>`;
      if (lead) {
        const when = Number.isFinite(Date.parse(lead.pubDate))
          ? dateFmt.format(new Date(lead.pubDate))
          : '';
        const media = lead.image
          ? `<a class="pulse-feature-media" href="${escapeHtml(lead.link)}" target="_blank" rel="noopener noreferrer">` +
            `<img class="pulse-feature-img" src="${escapeHtml(lead.image)}" alt="" width="1200" height="675" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>`
          : `<div class="pulse-feature-media pulse-feature-media--blank" aria-hidden="true"></div>`;
        feature =
          `<article class="pulse-feature">` +
          media +
          `<div class="pulse-feature-copy">` +
          `<p class="pulse-meta">${escapeHtml([lead.source, when].filter(Boolean).join(' · '))}</p>` +
          `<h3 class="pulse-feature-title"><a href="${escapeHtml(lead.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lead.title)}</a></h3>` +
          (lead.note ? `<p class="pulse-note">${escapeHtml(lead.note)}</p>` : '') +
          `</div></article>`;
      }
      const restList = rest.length
        ? `<ol class="pulse-list">${pulseRestItemsHtml(rest, dateFmt)}</ol>`
        : '';
      return (
        `<section class="pulse-block pulse-block--${escapeHtml(group.id)}" data-pulse-section="${escapeHtml(group.id)}" id="pulse-panel-${escapeHtml(group.id)}" role="tabpanel" aria-labelledby="pulse-tab-${escapeHtml(group.id)}">` +
        `<header class="pulse-lane-head"><div>` +
        `<p class="pulse-lane-kicker">${escapeHtml(kicker)}</p>` +
        `<h2 id="pulse-${escapeHtml(group.id)}" class="pulse-heading">${escapeHtml(group.label)}</h2>` +
        `</div><p class="pulse-lane-count">${escapeHtml(count)}</p></header>` +
        feature +
        restList +
        `</section>`
      );
    })
    .join('');
}

/** Flat list for older inject markers — prefer pulseBoardHtml. */
export function pulseListHtml(items) {
  return pulseBoardHtml(items);
}

export function pulseTeaseHtml(items) {
  const groups = groupPulseBySection(items);
  const picks = [];
  for (const group of groups) {
    if (group.items[0]) {
      picks.push({
        ...group.items[0],
        sectionId: group.id,
        sectionLabel: group.label,
        kicker: SECTION_KICKER[group.id] || group.label,
      });
    }
  }
  if (!picks.length) {
    return `<li class="empty"><a href="/pulse">Thin tires</a> — road and CX when it lands.</li>`;
  }
  return picks
    .map((item) => {
      const media = item.image
        ? `<a class="pulse-tease-media" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">` +
          `<img src="${escapeHtml(item.image)}" alt="" width="640" height="400" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>`
        : `<span class="pulse-tease-media pulse-tease-media--blank" aria-hidden="true"></span>`;
      return (
        `<li class="pulse-tease-item pulse-tease-item--${escapeHtml(item.sectionId || 'road-men')}">` +
        media +
        `<div class="pulse-tease-copy">` +
        `<span class="pulse-tease-lane">${escapeHtml(item.kicker || sectionLabel(item.section))}</span>` +
        `<a class="pulse-tease-title" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>` +
        (item.source ? `<span class="pulse-tease-source">${escapeHtml(item.source)}</span>` : '') +
        `</div></li>`
      );
    })
    .join('');
}

function replaceTaggedElement(html, tag, attrNeedle, innerHtml) {
  const source = String(html);
  const openRe = new RegExp(`<${tag}\\b([^>]*${attrNeedle}[^>]*)>`, 'i');
  const open = openRe.exec(source);
  if (!open) return source;
  const startOpen = open.index;
  const afterOpen = startOpen + open[0].length;
  const openTag = new RegExp(`<${tag}\\b`, 'gi');
  const closeTag = new RegExp(`</${tag}\\s*>`, 'gi');
  openTag.lastIndex = afterOpen;
  closeTag.lastIndex = afterOpen;
  let depth = 1;
  let cursor = afterOpen;
  while (depth > 0) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const nextOpen = openTag.exec(source);
    const nextClose = closeTag.exec(source);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth -= 1;
    cursor = nextClose.index + nextClose[0].length;
    if (depth === 0) {
      return (
        source.slice(0, startOpen) +
        `<${tag}${open[1]}>${innerHtml}</${tag}>` +
        source.slice(cursor)
      );
    }
  }
  return source;
}

export function fillPulseInHtml(html, items) {
  const list = Array.isArray(items) ? items : [];
  let out = String(html);
  out = replaceTaggedElement(out, 'div', 'data-pulse-board', pulseBoardHtml(list));
  out = replaceTaggedElement(out, 'ol', 'data-pulse-list', pulseBoardHtml(list));
  out = replaceTaggedElement(out, 'ol', 'data-pulse-tease', pulseTeaseHtml(list));
  return out;
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
      sections: groupPulseBySection(items),
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
