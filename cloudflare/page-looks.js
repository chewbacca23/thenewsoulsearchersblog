/**
 * Anonymous page opens for Henrik's Looks dashboard.
 * No cookies, no names. One count per open of a public page.
 * Also fills the private free-members roster (emails stay off the public site).
 */

import { membersListHtml, readMemberList } from './member-mail.js';
import {
  postcardSharesListHtml,
  readPostcardShares,
} from './postcard-shares.js';

const STORE_KEY = 'looks-v1';
const SKIP = new Set([
  '/admin',
  '/auth',
  '/callback',
  '/cms-status',
  '/api/looks',
  '/looks',
  '/looks/',
  '/members',
  '/members/',
  '/rss.xml',
  '/sitemap-index.xml',
  '/sitemap-0.xml',
  '/robots.txt',
  '/favicon.ico',
  '/logo.svg',
  '/logo.png',
  '/og.svg',
]);

export function berlinDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function berlinYear(now = new Date()) {
  return berlinDay(now).slice(0, 4);
}

export function berlinMonth(now = new Date()) {
  return berlinDay(now).slice(0, 7);
}

/** Month label for charts (Oct 26). */
export function berlinMonthLabel(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return '—';
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'short',
    year: '2-digit',
  }).format(at);
}

/** Keep the last N single opens so Henrik can see real hits, not only totals. */
export const RECENT_LOOKS_LIMIT = 10;

export function emptyLooks() {
  return { total: 0, days: {}, paths: {}, countries: {}, cities: {}, from: {}, recent: [] };
}

export function sanitizePath(raw) {
  if (typeof raw !== 'string') return '/';
  let path = raw.split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (path.includes('..')) return '';
  if (path.length > 120) return '';
  return path || '/';
}

export function shouldRecordPath(path) {
  if (!path) return false;
  if (SKIP.has(path)) return false;
  if (path.startsWith('/admin')) return false;
  if (path.startsWith('/api/')) return false;
  if (/\.[a-z0-9]{1,8}$/i.test(path)) return false;
  // Scanners / junk — keep the proof feed readable.
  if (path.includes('/.git') || path.includes('/wp-') || path.includes('/php')) return false;
  if (path.startsWith('/.') || path.startsWith('/_')) return false;
  return true;
}

export function applyLook(data, path, day, extras = {}) {
  const next = {
    total: Number(data.total) || 0,
    days: { ...(data.days || {}) },
    paths: { ...(data.paths || {}) },
    countries: { ...(data.countries || {}) },
    cities: { ...(data.cities || {}) },
    from: { ...(data.from || {}) },
    recent: Array.isArray(data.recent) ? [...data.recent] : [],
  };
  next.total += 1;
  next.days[day] = (Number(next.days[day]) || 0) + 1;
  next.paths[path] = (Number(next.paths[path]) || 0) + 1;
  if (extras.country) {
    next.countries[extras.country] = (Number(next.countries[extras.country]) || 0) + 1;
  }
  if (extras.city) {
    next.cities[extras.city] = (Number(next.cities[extras.city]) || 0) + 1;
  }
  if (extras.from) {
    next.from[extras.from] = (Number(next.from[extras.from]) || 0) + 1;
  }
  const at =
    extras.at instanceof Date
      ? extras.at
      : extras.at
        ? new Date(extras.at)
        : new Date();
  const entry = {
    t: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(),
    path,
  };
  if (extras.country) entry.country = extras.country;
  if (extras.city) entry.city = extras.city;
  if (extras.from) entry.from = extras.from;
  if (extras.ip) entry.ip = extras.ip;
  next.recent.push(entry);
  if (next.recent.length > RECENT_LOOKS_LIMIT) {
    next.recent = next.recent.slice(-RECENT_LOOKS_LIMIT);
  }
  return next;
}

export function yearTotals(days) {
  const byYear = {};
  for (const [day, count] of Object.entries(days || {})) {
    const year = String(day).slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;
    byYear[year] = (Number(byYear[year]) || 0) + (Number(count) || 0);
  }
  return Object.entries(byYear)
    .map(([name, looks]) => ({ name, looks }))
    .sort((a, b) => b.name.localeCompare(a.name) || b.looks - a.looks);
}

/** Short Berlin weekday for chart labels (Mo, Tu, …). */
export function berlinWeekdayLabel(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ''));
  if (!match) return '—';
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(at);
}

/** Day/month for week range labels (3 Sep). */
export function berlinShortDate(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ''));
  if (!match) return '—';
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    day: 'numeric',
    month: 'short',
  }).format(at);
}

/**
 * Last N Berlin calendar days for the day chart (oldest → newest).
 * @param {Record<string, number>} days
 * @param {Date} [now]
 * @param {number} [count]
 */
export function recentDayBars(days, now = new Date(), count = 14) {
  const bars = [];
  const n = Math.max(1, Math.min(31, Number(count) || 14));
  for (let i = n - 1; i >= 0; i--) {
    const at = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const day = berlinDay(at);
    bars.push({
      day,
      label: berlinWeekdayLabel(day),
      looks: Number(days?.[day]) || 0,
    });
  }
  return bars;
}

/**
 * Last N rolling 7-day weeks ending today (oldest → newest).
 * @param {Record<string, number>} days
 * @param {Date} [now]
 * @param {number} [count]
 */
export function recentWeekBars(days, now = new Date(), count = 8) {
  const bars = [];
  const n = Math.max(1, Math.min(26, Number(count) || 8));
  for (let w = n - 1; w >= 0; w--) {
    let looks = 0;
    let start = '';
    let end = '';
    for (let d = 6; d >= 0; d--) {
      const at = new Date(now.getTime() - (w * 7 + d) * 24 * 60 * 60 * 1000);
      const day = berlinDay(at);
      if (!start) start = day;
      end = day;
      looks += Number(days?.[day]) || 0;
    }
    bars.push({
      start,
      end,
      label: `${berlinShortDate(start)}–${berlinShortDate(end)}`,
      looks,
    });
  }
  return bars;
}

/**
 * Last N Berlin calendar months (oldest → newest).
 * @param {Record<string, number>} days
 * @param {Date} [now]
 * @param {number} [count]
 */
export function recentMonthBars(days, now = new Date(), count = 12) {
  const bars = [];
  const n = Math.max(1, Math.min(24, Number(count) || 12));
  const [y0, m0] = berlinDay(now).split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    let y = y0;
    let m = m0 - i;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    const month = `${y}-${String(m).padStart(2, '0')}`;
    let looks = 0;
    for (const [day, value] of Object.entries(days || {})) {
      if (String(day).startsWith(month)) looks += Number(value) || 0;
    }
    bars.push({
      month,
      label: berlinMonthLabel(month),
      looks,
    });
  }
  return bars;
}

export function summarizeLooks(data, now = new Date()) {
  const days = data.days || {};
  const today = berlinDay(now);
  const thisYear = berlinYear(now);
  const thisMonth = berlinMonth(now);
  const weekDays = [];
  for (let i = 6; i >= 0; i--) {
    const at = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    weekDays.push(berlinDay(at));
  }
  const week = weekDays.reduce((sum, day) => sum + (Number(days[day]) || 0), 0);
  const years = yearTotals(days);
  const year = years.find((row) => row.name === thisYear)?.looks || 0;
  const month = Object.entries(days).reduce((sum, [day, value]) => {
    if (String(day).startsWith(thisMonth)) return sum + (Number(value) || 0);
    return sum;
  }, 0);
  const pages = Object.entries(data.paths || {})
    .map(([path, looks]) => ({ path, looks: Number(looks) || 0 }))
    .sort((a, b) => b.looks - a.looks || a.path.localeCompare(b.path))
    .slice(0, 12);
  const countries = topNamedCounts(data.countries, countryLabel);
  const cities = topNamedCounts(data.cities, (key) => key, 24);
  const from = topNamedCounts(data.from);
  const dayBars = recentDayBars(days, now, 14);
  const weekBars = recentWeekBars(days, now, 8);
  const monthBars = recentMonthBars(days, now, 12);
  const recent = recentLooks(data.recent);
  return {
    today: Number(days[today]) || 0,
    week,
    month,
    year,
    total: Number(data.total) || 0,
    years,
    pages,
    countries,
    cities,
    from,
    recent,
    dayBars,
    weekBars,
    monthBars,
  };
}

/** Newest-first single opens for the proof feed. */
export function recentLooks(recent) {
  const list = Array.isArray(recent) ? recent : [];
  return [...list]
    .filter((row) => row && typeof row === 'object' && typeof row.path === 'string')
    .map((row) => ({
      t: typeof row.t === 'string' ? row.t : '',
      path: row.path,
      country: typeof row.country === 'string' ? row.country : '',
      city: typeof row.city === 'string' ? row.city : '',
      from: typeof row.from === 'string' ? row.from : '',
      ip: typeof row.ip === 'string' ? row.ip : '',
    }))
    .reverse();
}

/** Visitor IP for the private Latest opens feed (CF-Connecting-IP). */
export function sanitizeIp(raw) {
  const value = String(raw || '')
    .split(',')[0]
    .trim();
  if (!value || value.length > 45) return '';
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    const parts = value.split('.').map((n) => Number(n));
    if (parts.every((n) => n >= 0 && n <= 255)) return value;
    return '';
  }
  // IPv6 (compressed forms ok)
  if (/^[0-9a-f:]+$/i.test(value) && value.includes(':')) return value.toLowerCase();
  return '';
}

function topNamedCounts(map, label = (key) => key, limit = 12) {
  const n = Math.max(1, Math.min(48, Number(limit) || 12));
  return Object.entries(map || {})
    .map(([key, looks]) => ({ name: label(key), looks: Number(looks) || 0 }))
    .sort((a, b) => b.looks - a.looks || a.name.localeCompare(b.name))
    .slice(0, n);
}

const COUNTRY_NAMES = {
  AT: 'Austria',
  AU: 'Australia',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CN: 'China',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  HR: 'Croatia',
  HU: 'Hungary',
  IE: 'Ireland',
  IN: 'India',
  IT: 'Italy',
  JP: 'Japan',
  KR: 'South Korea',
  LU: 'Luxembourg',
  NL: 'Netherlands',
  NO: 'Norway',
  NZ: 'New Zealand',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SE: 'Sweden',
  SI: 'Slovenia',
  SK: 'Slovakia',
  T1: 'Tor',
  TR: 'Turkey',
  UA: 'Ukraine',
  US: 'United States',
  XX: 'Unknown',
};

export function countryLabel(code) {
  const key = String(code || '').toUpperCase();
  return COUNTRY_NAMES[key] || key;
}

export function sanitizeCountry(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$|^T1$/.test(code)) return '';
  return code;
}

/** Approximate city from Cloudflare IP geo (~60–80% city accuracy; Cologne, Freiburg, …). */
export function sanitizeCity(raw) {
  const value = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value || value.length > 60) return '';
  if (/^unknown$/i.test(value)) return '';
  // Letters, marks, spaces, hyphen, apostrophe, period — drop junk
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(value)) return '';
  return value;
}

const FROM_NAMES = {
  'instagram.com': 'Instagram',
  'l.instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
  'm.facebook.com': 'Facebook',
  'l.facebook.com': 'Facebook',
  'google.com': 'Google',
  'google.de': 'Google',
  'google.fr': 'Google',
  'google.it': 'Google',
  'google.nl': 'Google',
  'bing.com': 'Bing',
  'duckduckgo.com': 'DuckDuckGo',
  't.co': 'X',
  'twitter.com': 'X',
  'x.com': 'X',
  'youtube.com': 'YouTube',
  'linkedin.com': 'LinkedIn',
  'reddit.com': 'Reddit',
  'bsky.app': 'Bluesky',
};

/** Home pages for the friendly names we store. Click Opens that site. */
const FROM_HOME = {
  Instagram: 'https://www.instagram.com/',
  Facebook: 'https://www.facebook.com/',
  Google: 'https://www.google.com/',
  Bing: 'https://www.bing.com/',
  DuckDuckGo: 'https://duckduckgo.com/',
  X: 'https://x.com/',
  YouTube: 'https://www.youtube.com/',
  LinkedIn: 'https://www.linkedin.com/',
  Reddit: 'https://www.reddit.com/',
  Bluesky: 'https://bsky.app/',
};

const OWN_HOSTS = new Set([
  'thenewsoulsearchers.de',
  'www.thenewsoulsearchers.de',
  'thenewsoulsearchers.com',
  'www.thenewsoulsearchers.com',
  'localhost',
  '127.0.0.1',
]);

export function sanitizeFrom(referer, pageUrl) {
  if (!referer) return 'Typed or bookmark';
  try {
    const from = new URL(referer);
    let host = from.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    let here = '';
    try {
      here = new URL(pageUrl).hostname.toLowerCase();
      if (here.startsWith('www.')) here = here.slice(4);
    } catch {
      here = '';
    }
    if (OWN_HOSTS.has(host) || host === here) return 'On this site';
    if (FROM_NAMES[host]) return FROM_NAMES[host];
    if (host.endsWith('.google.com') || /^google\.[a-z.]+$/.test(host)) return 'Google';
    if (host.length > 80) return host.slice(0, 80);
    return host || 'Typed or bookmark';
  } catch {
    return 'Typed or bookmark';
  }
}

/** URL to open for a stored “what sent them” label. Empty if there is nowhere useful to go. */
export function fromSiteHref(name) {
  const key = String(name || '').trim();
  if (!key || key === 'Typed or bookmark' || key === 'On this site') return '';
  if (FROM_HOME[key]) return FROM_HOME[key];
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(key) && !key.includes('/')) {
    return `https://${key.toLowerCase()}/`;
  }
  return '';
}

export function lookFromRequest(request) {
  return {
    country: sanitizeCountry(request.cf?.country),
    city: sanitizeCity(request.cf?.city),
    from: sanitizeFrom(request.headers.get('referer'), request.url),
    ip: sanitizeIp(
      request.headers.get('cf-connecting-ip') ||
        request.headers.get('true-client-ip') ||
        request.headers.get('x-real-ip'),
    ),
  };
}

export function memoryLooksStore(seed = null) {
  let value = seed;
  return {
    async load() {
      return value ? structuredClone(value) : emptyLooks();
    },
    async save(data) {
      value = structuredClone(data);
    },
  };
}

export function kvLooksStore(kv) {
  return {
    async load() {
      const raw = await kv.get(STORE_KEY);
      if (!raw) return emptyLooks();
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return emptyLooks();
        return {
          total: Number(parsed.total) || 0,
          days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
          paths: parsed.paths && typeof parsed.paths === 'object' ? parsed.paths : {},
          countries:
            parsed.countries && typeof parsed.countries === 'object' ? parsed.countries : {},
          cities: parsed.cities && typeof parsed.cities === 'object' ? parsed.cities : {},
          from: parsed.from && typeof parsed.from === 'object' ? parsed.from : {},
          recent: Array.isArray(parsed.recent) ? parsed.recent.slice(-RECENT_LOOKS_LIMIT) : [],
        };
      } catch {
        return emptyLooks();
      }
    },
    async save(data) {
      await kv.put(STORE_KEY, JSON.stringify(data));
    },
  };
}

export function cacheLooksStore(cache = globalThis.caches?.default, requestUrl = 'https://thenewsoulsearchers.de/__internal/looks-v1') {
  return {
    async load() {
      if (!cache) return emptyLooks();
      const hit = await cache.match(requestUrl);
      if (!hit) return emptyLooks();
      try {
        return await hit.json();
      } catch {
        return emptyLooks();
      }
    },
    async save(data) {
      if (!cache) return;
      await cache.put(
        requestUrl,
        new Response(JSON.stringify(data), {
          headers: {
            'content-type': 'application/json',
            'cache-control': 'max-age=31536000',
          },
        }),
      );
    },
  };
}

/**
 * Cloudflare KV on a Worker is usually a real object with get/put.
 * Some dashboard binds show up as env.STATS before typeof methods look like
 * normal functions, so treat any non-fetch STATS object as KV.
 */
export function isStatsKvBinding(value) {
  if (!value || typeof value !== 'object') return false;
  // ASSETS / service bindings speak fetch and do not have KV get.
  if (typeof value.fetch === 'function' && typeof value.get !== 'function') return false;
  return true;
}

export function looksStoreFor(env) {
  if (isStatsKvBinding(env?.STATS)) {
    return kvLooksStore(env.STATS);
  }
  if (typeof caches !== 'undefined' && caches.default) {
    return cacheLooksStore();
  }
  if (!env.__memoryLooks) env.__memoryLooks = memoryLooksStore();
  return env.__memoryLooks;
}

/** Where Looks numbers live. Prefer kv — cache and memory can vanish on deploy. */
export function looksStoreKind(env) {
  if (isStatsKvBinding(env?.STATS)) return 'kv';
  if (typeof caches !== 'undefined' && caches.default) return 'cache';
  return 'memory';
}

/** Safe shape report for /cms-status — no KV values. */
export function looksStatsBindingInfo(env) {
  const value = env?.STATS;
  return {
    present: value != null,
    typeof: value == null ? 'missing' : typeof value,
    hasGet: typeof value?.get === 'function',
    hasPut: typeof value?.put === 'function',
    hasList: typeof value?.list === 'function',
    hasFetch: typeof value?.fetch === 'function',
    treatedAsKv: isStatsKvBinding(value),
  };
}

export async function recordLook(store, rawPath, now = new Date(), extras = {}) {
  const path = sanitizePath(rawPath);
  if (!shouldRecordPath(path)) return { recorded: false, path };
  const data = applyLook(await store.load(), path, berlinDay(now), { ...extras, at: now });
  await store.save(data);
  return { recorded: true, path, total: data.total };
}

export async function readLooks(store, now = new Date()) {
  return summarizeLooks(await store.load(), now);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const LOOKS_COOKIE = 'ss_looks';
const LOOKS_MESSAGE = 'soul-searchers-looks';

function looksSecret(env) {
  const value =
    env?.GITHUB_OAUTH_CLIENT_SECRET ||
    env?.GITHUB_CLIENT_SECRET ||
    env?.CLIENT_SECRET;
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bits = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function looksToken(secret) {
  if (!secret) return '';
  return hmacHex(secret, LOOKS_MESSAGE);
}

export function cookieValue(header, name) {
  if (!header) return '';
  for (const part of String(header).split(';')) {
    const trimmed = part.trim();
    const cut = trimmed.indexOf('=');
    if (cut === -1) continue;
    if (trimmed.slice(0, cut) === name) return trimmed.slice(cut + 1);
  }
  return '';
}

export function looksSetCookie(token, { secure = true } = {}) {
  return `${LOOKS_COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${
    secure ? '; Secure' : ''
  }`;
}

export async function requestHasLooksAccess(request, env) {
  const secret = looksSecret(env);
  const token = await looksToken(secret);
  if (!token) return false;
  return cookieValue(request.headers.get('cookie'), LOOKS_COOKIE) === token;
}

export function looksGatePage() {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>The Soul Searchers</title>
  <style>
    body { font-family: "Sofia Sans Condensed", "Sofia Sans Extra Condensed", "Arial Narrow", sans-serif; background: #0c1218; color: #d7e0e8;
      max-width: 28rem; margin: 4rem auto; padding: 0 1.2rem; line-height: 1.5; }
    a { color: #f0c27a; }
  </style>
</head>
<body>
  <p>Nothing to see here.</p>
  <p><a href="/">Home</a></p>
</body>
</html>`,
    {
      status: 401,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}

export function isLooksPath(pathname) {
  return pathname === '/looks' || pathname === '/looks/';
}

export function isMembersPath(pathname) {
  return pathname === '/members' || pathname === '/members/';
}

export function isPrivateDeskPath(pathname) {
  return isLooksPath(pathname) || isMembersPath(pathname);
}

export function isAdminPath(pathname) {
  return pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/index.html';
}

export function shouldFillLooks(pathname) {
  return isLooksPath(pathname) || isMembersPath(pathname) || isAdminPath(pathname);
}

/**
 * Soft filter so Looks leans toward people, not crawlers.
 * Misses clever scrapers; catches the usual search / social / AI bots.
 * @param {string} userAgent
 */
export function isLikelyBot(userAgent) {
  const ua = String(userAgent || '').trim();
  if (!ua) return true;
  return (
    /\b(bot|spider|crawler|crawl|slurp|fetch|monitor|preview|scanner|scrapy|headless)\b/i.test(
      ua,
    ) ||
    /\b(googlebot|bingbot|yandex|baidu|duckduck|applebot|semrush|ahrefs|mj12|dotbot|rogerbot|petalbot|bytespider)\b/i.test(
      ua,
    ) ||
    /\b(gptbot|claudebot|anthropic|chatgpt|openai|perplexity|ccbot|amazonbot|meta-externalagent)\b/i.test(
      ua,
    ) ||
    /\b(facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|pinterest)\b/i.test(
      ua,
    ) ||
    /\b(curl|wget|python-requests|python-urllib|go-http-client|libwww|httpclient|java\/|okhttp|axios\/|node-fetch|postman)\b/i.test(
      ua,
    ) ||
    /\b(pingdom|uptimerobot|statuscake|site24x7|newrelic|datadog|phantomjs|puppeteer|selenium|playwright)\b/i.test(
      ua,
    )
  );
}

export function shouldCountDocument(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const dest = (request.headers.get('sec-fetch-dest') || '').toLowerCase();
  if (dest && dest !== 'document' && dest !== 'empty') return false;
  const path = new URL(request.url).pathname;
  if (/\.[a-z0-9]{1,8}$/i.test(path)) return false;
  // Cloudflare verified bots (when the header is present).
  const verified = (request.headers.get('cf-verified-bot') || '').toLowerCase();
  if (verified === 'true' || verified === '1') return false;
  if (isLikelyBot(request.headers.get('user-agent') || '')) return false;
  return true;
}

export async function recordDocumentLook(request, env) {
  if (!shouldCountDocument(request)) return { recorded: false };
  try {
    return await recordLook(
      looksStoreFor(env),
      new URL(request.url).pathname,
      new Date(),
      lookFromRequest(request),
    );
  } catch {
    return { recorded: false };
  }
}

export function looksDashboardPage(summary, members = [], shares = []) {
  const today = Number(summary?.today) || 0;
  const week = Number(summary?.week) || 0;
  const month = Number(summary?.month) || 0;
  const year = Number(summary?.year) || 0;
  const total = Number(summary?.total) || 0;
  const rows = looksPageRows(summary?.pages);
  const recentRows = looksRecentRows(
    summary?.recent,
    'Open any public page in another tab, then refresh — a row shows here.',
  );
  const countryRows = looksNamedRows(
    summary?.countries,
    'Country shows after someone opens a page.',
  );
  const cityRows = looksNamedRows(
    summary?.cities,
    'City shows after someone opens a page (approximate — Cologne, Freiburg, …).',
  );
  const fromRows = looksFromRows(
    summary?.from,
    'The site that sent them shows after someone opens a page.',
  );
  const yearRows = looksNamedRows(
    summary?.years,
    'Years show once people have opened the site.',
  );
  const dayBars = looksBarsHtml(
    summary?.dayBars,
    'Day bars show once people have opened the site.',
  );
  const weekBars = looksBarsHtml(
    summary?.weekBars,
    'Week bars show once people have opened the site.',
    { wideLabel: true },
  );
  const monthBars = looksBarsHtml(
    summary?.monthBars,
    'Month bars show once people have opened the site.',
    { wideLabel: true },
  );
  const memberCount = Array.isArray(members) ? members.length : 0;
  const memberRows = membersListHtml(members);
  const shareCount = Array.isArray(shares) ? shares.length : 0;
  const shareRows = postcardSharesListHtml(shares);

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Looks · The Soul Searchers</title>
  <link rel="icon" type="image/png" href="/logo.png" />
  <style>
    :root { --ink:#0c1218; --fog:#d7e0e8; --paper:#eef3f7; --amber:#d4a35a; --amber-hot:#f0c27a; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:var(--fog); background:var(--ink);
      font-family: "Sofia Sans Condensed", "Sofia Sans Extra Condensed", "Arial Narrow", sans-serif; }
    a { color: inherit; }
    a:hover { color: var(--amber-hot); }
    .site-shell { width: min(46rem, calc(100% - 2rem)); margin: 0 auto; padding: 2.5rem 0 4rem; font-variant-numeric: tabular-nums lining-nums; }
    .eyebrow { margin:0 0 .4rem; letter-spacing:.16em; text-transform:uppercase; font-size:.78rem; color:var(--amber); font-weight:700; }
    h1 { margin:0 0 .75rem; font-family:"Sofia Sans Extra Condensed","Arial Narrow",sans-serif; font-weight:300; font-size: clamp(2rem, 4vw, 2.8rem); color:var(--paper); }
    .lead { margin:0 0 1.75rem; color:rgba(215,224,232,.72); }
    .looks-board { --crt:#ffb000; --crt-dim:#c47a00; --crt-bg:#070904; margin:0 0 2.25rem; position:relative; isolation:isolate; overflow:hidden; padding:.95rem .85rem 1.1rem; border-radius:.35rem; border:3px solid #2a2a22; background:radial-gradient(ellipse 90% 70% at 50% 40%,rgba(255,176,0,.07),transparent 70%),var(--crt-bg); box-shadow:inset 0 0 0 1px #111,inset 0 0 40px rgba(0,0,0,.85),0 0 18px rgba(255,176,0,.08); }
    .looks-board::before { content:""; position:absolute; inset:0; z-index:3; pointer-events:none; background:repeating-linear-gradient(to bottom,rgba(0,0,0,.18) 0,rgba(0,0,0,.18) 1px,transparent 1px,transparent 3px); opacity:.55; }
    .looks-board::after { content:""; position:absolute; inset:0; z-index:4; pointer-events:none; background:radial-gradient(ellipse 75% 65% at 50% 45%,transparent 40%,rgba(0,0,0,.55) 100%); }
    .looks-board-mark { position:relative; z-index:2; margin:0 0 .85rem; color:var(--crt); font-family:"Courier New","Lucida Console",ui-monospace,monospace; font-size:.78rem; font-weight:700; letter-spacing:.22em; text-transform:uppercase; text-align:center; text-shadow:0 0 8px rgba(255,176,0,.55); }
    .looks-board-row { position:relative; z-index:2; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:.55rem; }
    @media (max-width:719px) { .looks-board-row { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    .looks-bay { display:flex; flex-direction:column; align-items:center; gap:.45rem; min-width:0; overflow:hidden; }
    .looks-bay-label { margin:0; color:var(--crt-dim); font-family:"Courier New","Lucida Console",ui-monospace,monospace; font-size:.6rem; font-weight:700; letter-spacing:.16em; text-transform:uppercase; text-align:center; text-shadow:0 0 6px rgba(255,176,0,.25); }
    .card-num { margin:0; max-width:100%; overflow:hidden; color:var(--crt); font-family:"Courier New","Lucida Console",ui-monospace,monospace; font-size:1.25rem; font-weight:700; line-height:1; }
    .card-num.is-solari { display:flex; justify-content:center; }
    .solari-row { display:inline-flex; gap:3px; align-items:center; justify-content:center; max-width:100%; }
    .solari-flap { position:relative; flex:0 0 auto; width:22px; height:34px; display:inline-flex; align-items:center; justify-content:center; border-radius:2px; border:1px solid rgba(255,176,0,.18); background:linear-gradient(180deg,#12180c 0%,#0a0e06 48%,#050703 52%,#0c1208 100%); box-shadow:inset 0 1px 0 rgba(255,176,0,.08),inset 0 -1px 0 rgba(0,0,0,.7),0 0 6px rgba(255,176,0,.12); overflow:hidden; perspective:240px; }
    .solari-flap::after { content:""; position:absolute; left:0; right:0; top:50%; z-index:2; height:2px; margin-top:-1px; background:rgba(0,0,0,.92); pointer-events:none; }
    .solari-flap-text { position:relative; z-index:1; color:var(--crt); font-family:"Courier New","Lucida Console",ui-monospace,monospace; font-size:18px; font-weight:700; line-height:1; text-shadow:0 0 6px rgba(255,176,0,.65); transform-origin:50% 50%; }
    .solari-flap.is-flipping .solari-flap-text { animation:solari-tick .3s ease-in-out; }
    @keyframes solari-tick { 0%{transform:rotateX(0)} 45%{transform:rotateX(-90deg)} 55%{transform:rotateX(-90deg)} 100%{transform:rotateX(0)} }
    @media (max-width:719px) { .solari-flap{width:18px;height:28px} .solari-flap-text{font-size:15px} }
    @media (prefers-reduced-motion:reduce) { .solari-flap.is-flipping .solari-flap-text{animation:none} }
    h2 { margin:2.35rem 0 .55rem; padding:0; font-family:"Sofia Sans Extra Condensed","Arial Narrow",sans-serif; font-size:1.15rem; font-weight:300; letter-spacing:.06em; text-transform:uppercase; }
    ol { margin:0; padding:0; list-style:none; border:1px solid rgba(215,224,232,.14); border-radius:0; overflow:hidden; background:rgba(8,12,17,.4); }
    li { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:1rem; align-items:baseline; padding:.72rem .95rem; border-top:1px solid rgba(215,224,232,.09); font-variant-numeric:tabular-nums; }
    li:first-child { border-top:0; }
    li a { color:var(--paper); text-decoration:underline; text-decoration-color:rgba(240,194,122,.35); text-underline-offset:.18em; }
    li a:hover { color: var(--amber-hot); text-decoration-color: var(--amber-hot); }
    li span:last-child { color:var(--amber-hot); font-family:"Sofia Sans Extra Condensed","Arial Narrow",sans-serif; font-size:1.05rem; font-weight:300; text-align:right; min-width:3ch; }
    li .looks-name { color:var(--paper); font-weight:400; }
    .looks-recent-main { display:flex; flex-direction:column; gap:.2rem; min-width:0; }
    .looks-recent-meta { color:rgba(215,224,232,.62); font-size:.88rem; }
    .looks-recent-when { color:var(--amber-hot); font-family:"Sofia Sans Extra Condensed","Arial Narrow",sans-serif; font-size:.95rem; font-weight:300; text-align:right; white-space:nowrap; }
    .empty { color:rgba(215,224,232,.62); }
    .note { margin:.35rem 0 .75rem; color:rgba(215,224,232,.62); font-size:.9rem; }
    .looks-bars { position:relative; display:grid; grid-auto-flow:column; grid-auto-columns:minmax(2rem,1fr); align-items:end; gap:.35rem; margin:0; padding:1rem .75rem .75rem; list-style:none; border:1px solid rgba(215,224,232,.14); border-radius:0; min-height:13rem; overflow-x:auto; background:repeating-linear-gradient(to top,transparent 0,transparent calc(25% - 1px),rgba(215,224,232,.07) calc(25% - 1px),rgba(215,224,232,.07) 25%),rgba(8,12,17,.55); }
    .looks-line { position:absolute; left:.75rem; right:.75rem; top:1.85rem; bottom:1.55rem; margin:0; padding:0; list-style:none; pointer-events:none; z-index:2; }
    .looks-line-svg { display:block; width:100%; height:100%; overflow:visible; }
    .looks-line-dot { position:absolute; width:7px; height:7px; margin:-3.5px 0 0 -3.5px; border-radius:50%; background:#f0c27a; border:1.5px solid #0c1218; box-sizing:border-box; }
    .looks-bar { position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:.3rem; height:11rem; padding:0; border:0; min-width:0; }
    .looks-bar-label { color:rgba(215,224,232,.72); font-family:"Sofia Sans Extra Condensed","Arial Narrow",sans-serif; font-size:.7rem; font-weight:300; letter-spacing:.04em; text-align:center; line-height:1.15; max-width:100%; overflow:hidden; text-overflow:ellipsis; text-transform:uppercase; }
    .looks-bar-track { display:flex; flex-direction:column; justify-content:flex-end; width:100%; max-width:1.55rem; flex:1 1 auto; border-radius:0; border-bottom:1px solid rgba(215,224,232,.28); background:transparent; overflow:hidden; }
    .looks-bar-fill { display:block; width:100%; height:var(--looks-bar,0%); min-height:0; border-radius:0; background:rgba(212,163,90,.38); }
    .looks-bar-num { color:var(--amber-hot); font-family:"Sofia Sans Extra Condensed","Arial Narrow",sans-serif; font-weight:300; font-size:.82rem; letter-spacing:.02em; font-variant-numeric:tabular-nums; line-height:1; }
    .back { margin:1.5rem 0 0; }
    .back a { color:var(--amber-hot); font-weight:600; text-decoration:none; }
  </style>
</head>
<body>
  <main class="site-shell">
    <p class="eyebrow">Open counts</p>
    <h1>Looks</h1>
    <p class="lead">Opens per page, day, week, and month — Berlin calendar. No names. Private for you.</p>
    <div class="looks-board" role="group" aria-label="Summary counts">
      <p class="looks-board-mark" aria-hidden="true">◇ LOOKS TERMINAL · BERLIN ◇</p>
      <div class="looks-board-row">
        <article class="looks-bay"><p class="looks-bay-label">Today</p><p class="card-num" data-looks="today">${today}</p></article>
        <article class="looks-bay"><p class="looks-bay-label">7 days</p><p class="card-num" data-looks="week">${week}</p></article>
        <article class="looks-bay"><p class="looks-bay-label">Month</p><p class="card-num" data-looks="month">${month}</p></article>
        <article class="looks-bay"><p class="looks-bay-label">Year</p><p class="card-num" data-looks="year">${year}</p></article>
        <article class="looks-bay"><p class="looks-bay-label">Total</p><p class="card-num" data-looks="total">${total}</p></article>
      </div>
    </div>
    <h2>Latest opens <span>${Array.isArray(summary?.recent) ? summary.recent.length : 0}</span></h2>
    <p class="note">Each row is one real page open. Newest first — path, city, country, IP, referrer. City is Cloudflare IP geo (~60–80% right; VPN / mobile hubs can miss). Private for you. Open Home in another tab, refresh, and watch a row land.</p>
    <ol>${recentRows}</ol>
    <h2>14 days</h2>
    <p class="note">Berlin days. Column height ∝ opens.</p>
    <ol class="looks-bars" style="${LOOKS_BARS_LIST_STYLE}">${dayBars}</ol>
    <h2>8 weeks</h2>
    <p class="note">Each column = 7 days.</p>
    <ol class="looks-bars" style="${LOOKS_BARS_LIST_STYLE_WIDE}">${weekBars}</ol>
    <h2>12 months</h2>
    <p class="note">Berlin calendar months. Column height ∝ opens.</p>
    <ol class="looks-bars" style="${LOOKS_BARS_LIST_STYLE_WIDE}">${monthBars}</ol>
    <h2>Years</h2>
    <ol>${yearRows}</ol>
    <h2>Pages</h2>
    <ol>${rows}</ol>
    <h2>Cities</h2>
    <p class="note">From the visitor’s IP via Cloudflare geo — roughly <strong>60–80%</strong> right at city level (country is usually stronger). Think “this network looks like Chicago / Amsterdam,” not a GPS pin. VPN, corporate gateways, and mobile hubs can land on the wrong town.</p>
    <ol>${cityRows}</ol>
    <h2>Countries</h2>
    <p class="note">Same IP geo as cities, but country is typically more reliable than town (~90%+ in practice).</p>
    <ol>${countryRows}</ol>
    <h2>Referrers</h2>
    <ol>${fromRows}</ol>
    <h2>Free members <span data-members-count>${memberCount}</span></h2>
    <p class="lead" style="margin-top:-.35rem;margin-bottom:.85rem;font-size:.92rem">Private for you. Everyone who joined the free list, newest first.</p>
    <ol data-members-list>${memberRows}</ol>
    <h2>Postcards started <span data-postcard-shares-count>${shareCount}</span></h2>
    <p class="lead" style="margin-top:-.35rem;margin-bottom:.85rem;font-size:.92rem">Private for you. Someone tapped Send this ride — they send it themselves.</p>
    <ol data-postcard-shares-list>${shareRows}</ol>
    <p class="back"><a href="/">← Home</a> · <a href="/admin/">Editor</a></p>
  </main>
  <script>
  (function(){var D='0123456789',reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;function parseTarget(raw){var t=String(raw||'').trim();if(!t||t==='—'||t==='-'||t==='–')return null;var d=t.replace(/[^\\d]/g,'');if(!d)return null;return (d.replace(/^0+(?=\\d)/,'')||'0').slice(0,5);}function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}function flapHtml(ch){return '<span class="solari-flap" aria-hidden="true"><span class="solari-flap-text">'+ch+'</span></span>';}async function flipTo(flap,toCh){var text=flap.querySelector('.solari-flap-text');if(!text)return;if(reduce){text.textContent=toCh;return;}flap.classList.remove('is-flipping');void flap.offsetWidth;flap.classList.add('is-flipping');await wait(140);text.textContent=toCh;await wait(160);flap.classList.remove('is-flipping');}async function runFlap(flap,finalCh,delay){await wait(delay);var text=flap.querySelector('.solari-flap-text');if(!text)return;if(reduce||finalCh==='—'){text.textContent=finalCh;return;}var spins=3+Math.floor(Math.random()*3);for(var i=0;i<spins;i++){var next=i===spins-1?finalCh:D[Math.floor(Math.random()*10)];await flipTo(flap,next);}if(text.textContent!==finalCh)await flipTo(flap,finalCh);}function mount(el){if(!el||el.dataset.flapReady==='1'||!el.classList.contains('card-num'))return;var target=parseTarget(el.textContent);var chars=target?target.split(''):['—'];el.dataset.flapReady='1';el.setAttribute('aria-label',target||'—');el.classList.add('is-solari');el.innerHTML='<span class="solari-row">'+chars.map(flapHtml).join('')+'</span>';el.querySelectorAll('.solari-flap').forEach(function(flap,i){runFlap(flap,chars[i],60+i*90);});}document.querySelectorAll('.card-num[data-looks]').forEach(mount);})();
  </script>
</body>
</html>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}

export function looksPageRows(pages) {
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) {
    return '<li class="empty">Open Home or a ride, then refresh this page.</li>';
  }
  return list
    .map((row) => {
      const label = row.path === '/' ? 'Home' : escapeHtml(row.path);
      const href = escapeHtml(row.path);
      return `<li><a href="${href}">${label}</a><span>${Number(row.looks) || 0}</span></li>`;
    })
    .join('');
}

/** Berlin clock for one open (25 Oct, 21:05). */
export function berlinLookTime(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/**
 * Single opens, newest first — path + time + optional country / referrer.
 * @param {{ t?: string, path?: string, country?: string, from?: string }[]} recent
 * @param {string} emptyText
 */
export function looksRecentRows(recent, emptyText) {
  const list = Array.isArray(recent) ? recent : [];
  if (!list.length) {
    return `<li class="empty">${emptyText}</li>`;
  }
  return list
    .map((row) => {
      const path = row.path === '/' ? 'Home' : escapeHtml(row.path || '/');
      const href = escapeHtml(row.path || '/');
      const when = escapeHtml(berlinLookTime(row.t));
      const bits = [];
      if (row.city) bits.push(escapeHtml(row.city));
      if (row.country) bits.push(escapeHtml(countryLabel(row.country)));
      if (row.ip) bits.push(escapeHtml(row.ip));
      if (row.from) bits.push(escapeHtml(row.from));
      const meta = bits.length
        ? `<span class="looks-recent-meta">${bits.join(' · ')}</span>`
        : '';
      return (
        `<li class="looks-recent">` +
        `<span class="looks-recent-main">` +
        `<a href="${href}">${path}</a>${meta}` +
        `</span>` +
        `<span class="looks-recent-when">${when}</span>` +
        `</li>`
      );
    })
    .join('');
}

export function looksNamedRows(items, emptyText) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return `<li class="empty">${emptyText}</li>`;
  }
  return list
    .map(
      (row) =>
        `<li><span class="looks-name">${escapeHtml(row.name)}</span><span>${Number(row.looks) || 0}</span></li>`,
    )
    .join('');
}

export function looksFromRows(items, emptyText) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return `<li class="empty">${emptyText}</li>`;
  }
  return list
    .map((row) => {
      const label = escapeHtml(row.name);
      const count = Number(row.looks) || 0;
      const href = fromSiteHref(row.name);
      if (href) {
        return `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a><span>${count}</span></li>`;
      }
      return `<li><span class="looks-name">${label}</span><span>${count}</span></li>`;
    })
    .join('');
}

/**
 * Day/week/month Looks charts as upright columns plus a stock-ticker line
 * through the peaks. Inline styles on purpose: Worker-injected nodes miss
 * Astro scoped CSS, and a stale deploy without global.css still needs bars.
 * @param {{ label?: string, looks?: number }[]} bars
 * @param {string} emptyText
 * @param {{ wideLabel?: boolean }} [opts]
 */
export function looksBarsHtml(bars, emptyText, opts = {}) {
  const list = Array.isArray(bars) ? bars : [];
  if (!list.length) {
    return `<li class="empty" style="grid-column:1/-1;color:rgba(215,224,232,0.68)">${emptyText}</li>`;
  }
  const max = Math.max(1, ...list.map((row) => Number(row.looks) || 0));
  const n = list.length;
  const colMin = opts.wideLabel ? '3rem' : '2rem';
  const colStyle =
    'display:flex;flex-direction:column;align-items:center;justify-content:flex-end;' +
    `gap:0.3rem;height:11rem;padding:0;border:0;margin:0;list-style:none;min-width:${colMin};position:relative;z-index:1`;
  const labelStyle =
    'color:rgba(215,224,232,0.72);font-family:"Sofia Sans Extra Condensed","Arial Narrow",sans-serif;' +
    'font-size:0.7rem;font-weight:300;letter-spacing:0.04em;text-align:center;line-height:1.15;' +
    'max-width:100%;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase';
  const trackStyle =
    'display:flex;flex-direction:column;justify-content:flex-end;width:100%;max-width:1.55rem;' +
    'flex:1 1 auto;border-radius:0;border-bottom:1px solid rgba(215,224,232,0.28);' +
    'background:transparent;overflow:hidden';
  const numStyle =
    'color:#f0c27a;font-family:"Sofia Sans Extra Condensed","Arial Narrow",sans-serif;' +
    'font-weight:300;font-size:0.82rem;letter-spacing:0.02em;font-variant-numeric:tabular-nums;line-height:1';

  // Stock-ticker line through bar tops (viewBox 0–100; y=0 is peak).
  // x sits in the middle of each column slot — not stretched edge-to-edge.
  const pts = list.map((row, i) => {
    const looks = Number(row.looks) || 0;
    const x = ((i + 0.5) / n) * 100;
    const y = 100 - (looks / max) * 100;
    return { x, y, looks };
  });
  const linePoints = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const areaPoints =
    `${pts[0].x.toFixed(2)},100 ` +
    linePoints +
    ` ${pts[pts.length - 1].x.toFixed(2)},100`;
  // CSS dots (not SVG <circle>): preserveAspectRatio="none" stretches the chart
  // SVG, which turns vector circles into ovals — real round markers stay round.
  const dots = pts
    .map((p) => {
      const left = p.x.toFixed(2);
      const top = p.y.toFixed(2);
      return (
        `<span class="looks-line-dot" style="position:absolute;left:${left}%;top:${top}%;` +
        `width:7px;height:7px;margin:-3.5px 0 0 -3.5px;border-radius:50%;` +
        `background:#f0c27a;border:1.5px solid #0c1218;box-sizing:border-box"></span>`
      );
    })
    .join('');
  const lineOverlay =
    `<li class="looks-line" aria-hidden="true" style="position:absolute;left:0.75rem;right:0.75rem;` +
    `top:1.85rem;bottom:1.55rem;margin:0;padding:0;list-style:none;pointer-events:none;z-index:2">` +
    `<svg class="looks-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" ` +
    `style="display:block;width:100%;height:100%;overflow:visible">` +
    `<polygon points="${areaPoints}" fill="rgba(240,194,122,0.12)" />` +
    `<polyline points="${linePoints}" fill="none" stroke="#f0c27a" stroke-width="1.75" ` +
    `stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />` +
    `</svg>${dots}</li>`;

  const columns = list
    .map((row) => {
      const looks = Number(row.looks) || 0;
      const pct = Math.round((looks / max) * 100);
      const label = escapeHtml(row.label || '—');
      const fillStyle =
        `display:block;width:100%;height:${pct}%;min-height:${looks > 0 ? '0.28rem' : '0'};` +
        'border-radius:0;background:rgba(212,163,90,0.38)';
      return (
        `<li class="looks-bar" style="${colStyle}">` +
        `<span class="looks-bar-num" style="${numStyle}">${looks}</span>` +
        `<span class="looks-bar-track" style="${trackStyle}" aria-hidden="true">` +
        `<span class="looks-bar-fill" style="${fillStyle}"></span>` +
        `</span>` +
        `<span class="looks-bar-label" style="${labelStyle}">${label}</span>` +
        `</li>`
      );
    })
    .join('');

  return lineOverlay + columns;
}

/** List shell styles so the chart box shows even without global.css. */
export const LOOKS_BARS_LIST_STYLE =
  'position:relative;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(2rem,1fr);align-items:end;' +
  'gap:0.35rem;margin:0 0 0.5rem;padding:1rem 0.75rem 0.75rem;list-style:none;min-height:13rem;' +
  'overflow-x:auto;border:1px solid rgba(215,224,232,0.14);border-radius:0;' +
  'background:repeating-linear-gradient(to top,transparent 0,transparent calc(25% - 1px),' +
  'rgba(215,224,232,0.07) calc(25% - 1px),rgba(215,224,232,0.07) 25%),rgba(8,12,17,0.55)';

export const LOOKS_BARS_LIST_STYLE_WIDE = LOOKS_BARS_LIST_STYLE.replace(
  'minmax(2rem,1fr)',
  'minmax(3rem,1fr)',
);


export function fillLooksInHtml(html, summary, members = [], shares = []) {
  const today = String(Number(summary?.today) || 0);
  const week = String(Number(summary?.week) || 0);
  const month = String(Number(summary?.month) || 0);
  const year = String(Number(summary?.year) || 0);
  const total = String(Number(summary?.total) || 0);
  const memberCount = String(Array.isArray(members) ? members.length : 0);
  const shareCount = String(Array.isArray(shares) ? shares.length : 0);
  const rows = looksPageRows(summary?.pages);
  const recentRows = looksRecentRows(
    summary?.recent,
    'Open any public page in another tab, then refresh — a row shows here.',
  );
  const countryRows = looksNamedRows(
    summary?.countries,
    'Country shows after someone opens a page.',
  );
  const cityRows = looksNamedRows(
    summary?.cities,
    'City shows after someone opens a page (approximate — Cologne, Freiburg, …).',
  );
  const fromRows = looksFromRows(
    summary?.from,
    'The site that sent them shows after someone opens a page.',
  );
  const yearRows = looksNamedRows(
    summary?.years,
    'Years show once people have opened the site.',
  );
  const dayBars = looksBarsHtml(
    summary?.dayBars,
    'Day bars show once people have opened the site.',
  );
  const weekBars = looksBarsHtml(
    summary?.weekBars,
    'Week bars show once people have opened the site.',
    { wideLabel: true },
  );
  const monthBars = looksBarsHtml(
    summary?.monthBars,
    'Month bars show once people have opened the site.',
    { wideLabel: true },
  );
  const memberRows = membersListHtml(members);
  const shareRows = postcardSharesListHtml(shares);
  const recentList = Array.isArray(summary?.recent) ? summary.recent : [];
  const recentCount = String(recentList.length);
  // Embed JSON so the browser can paint the feed even if an HTML replace misses.
  const recentJson = escapeHtml(JSON.stringify(recentList));
  return String(html)
    .replace(/data-looks="today"([^>]*)>[\s\S]*?</, `data-looks="today"$1>${today}<`)
    .replace(/data-looks="week"([^>]*)>[\s\S]*?</, `data-looks="week"$1>${week}<`)
    .replace(/data-looks="month"([^>]*)>[\s\S]*?</, `data-looks="month"$1>${month}<`)
    .replace(/data-looks="year"([^>]*)>[\s\S]*?</, `data-looks="year"$1>${year}<`)
    .replace(/data-looks="total"([^>]*)>[\s\S]*?</, `data-looks="total"$1>${total}<`)
    .replace(
      /data-looks-recent-count([^>]*)>[\s\S]*?</,
      `data-looks-recent-count$1>${recentCount}<`,
    )
    .replace(
      /data-members-count([^>]*)>[\s\S]*?</,
      `data-members-count$1>${memberCount}<`,
    )
    .replace(
      /data-postcard-shares-count([^>]*)>[\s\S]*?</,
      `data-postcard-shares-count$1>${shareCount}<`,
    )
    .replace(
      /<ol([^>]*data-looks-recent[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${recentRows}</ol>`,
    )
    .replace(
      /(<script[^>]*data-looks-recent-json[^>]*>)[\s\S]*?(<\/script>)/,
      `$1${recentJson}$2`,
    )
    .replace(
      /<ol([^>]*data-looks-years[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${yearRows}</ol>`,
    )
    .replace(
      /<ol([^>]*data-looks-days[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1 style="${LOOKS_BARS_LIST_STYLE}">${dayBars}</ol>`,
    )
    .replace(
      /<ol([^>]*data-looks-weeks[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1 style="${LOOKS_BARS_LIST_STYLE_WIDE}">${weekBars}</ol>`,
    )
    .replace(
      /<ol([^>]*data-looks-months[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1 style="${LOOKS_BARS_LIST_STYLE_WIDE}">${monthBars}</ol>`,
    )
    .replace(
      /<ol([^>]*data-looks-pages[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${rows}</ol>`,
    )
    .replace(
      /<ol([^>]*data-looks-cities[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${cityRows}</ol>`,
    )
    .replace(
      /<ol([^>]*data-looks-countries[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${countryRows}</ol>`,
    )
    .replace(
      /<ol([^>]*data-looks-from[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${fromRows}</ol>`,
    )
    .replace(
      /<ol([^>]*data-members-list[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${memberRows}</ol>`,
    )
    .replace(
      /<ol([^>]*data-postcard-shares-list[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${shareRows}</ol>`,
    );
}

async function safeReadLooks(env) {
  try {
    return await readLooks(looksStoreFor(env));
  } catch {
    return summarizeLooks(emptyLooks());
  }
}

async function fetchDeskAsset(request, env, paths) {
  if (!env?.ASSETS?.fetch) return null;
  for (const path of paths) {
    const url = new URL(request.url);
    url.pathname = path;
    const asset = await env.ASSETS.fetch(
      new Request(url, { method: 'GET', headers: request.headers }),
    );
    if (asset.ok) return asset;
    const location = asset.headers.get('location');
    if (asset.status >= 300 && asset.status < 400 && location) {
      const next = await env.ASSETS.fetch(
        new Request(new URL(location, url), { method: 'GET', headers: request.headers }),
      );
      if (next.ok) return next;
    }
  }
  return null;
}

async function fetchLooksAsset(request, env) {
  return fetchDeskAsset(request, env, ['/looks', '/looks/', '/looks/index.html']);
}

async function fetchMembersAsset(request, env) {
  return fetchDeskAsset(request, env, ['/members', '/members/', '/members/index.html']);
}

export function fillMembersInHtml(html, members = []) {
  const memberCount = String(Array.isArray(members) ? members.length : 0);
  const memberRows = membersListHtml(members);
  return String(html)
    .replace(
      /data-members-count([^>]*)>[\s\S]*?</,
      `data-members-count$1>${memberCount}<`,
    )
    .replace(
      /<ol([^>]*data-members-list[^>]*)>[\s\S]*?<\/ol>/,
      `<ol$1>${memberRows}</ol>`,
    );
}

export async function applyLooksToAsset(request, env, asset) {
  const url = new URL(request.url);
  if (!shouldFillLooks(url.pathname)) return asset;
  const privateDesk = isPrivateDeskPath(url.pathname);
  if (!asset || !asset.ok) return privateDesk ? null : asset;
  if (!(await requestHasLooksAccess(request, env))) {
    return privateDesk ? looksGatePage() : asset;
  }
  const type = asset.headers.get('content-type') || '';
  if (type && !type.includes('html') && !type.includes('text')) return asset;
  let members = [];
  try {
    members = await readMemberList(env);
  } catch {
    members = [];
  }
  let shares = [];
  try {
    shares = await readPostcardShares(env);
  } catch {
    shares = [];
  }
  const raw = await asset.text();
  const html = isMembersPath(url.pathname)
    ? fillMembersInHtml(raw, members)
    : fillLooksInHtml(raw, await safeReadLooks(env), members, shares);
  const headers = new Headers(asset.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(html, { status: 200, headers });
}

export async function handleLooksPage(request, env) {
  const url = new URL(request.url);
  if (!isPrivateDeskPath(url.pathname)) return null;
  if (!(await requestHasLooksAccess(request, env))) return looksGatePage();

  if (isMembersPath(url.pathname)) {
    const asset = await fetchMembersAsset(request, env);
    const filled = await applyLooksToAsset(request, env, asset);
    if (filled) return filled;
    let members = [];
    try {
      members = await readMemberList(env);
    } catch {
      members = [];
    }
    return membersDashboardPage(members);
  }

  const asset = await fetchLooksAsset(request, env);
  const filled = await applyLooksToAsset(request, env, asset);
  if (filled) return filled;
  let members = [];
  try {
    members = await readMemberList(env);
  } catch {
    members = [];
  }
  let shares = [];
  try {
    shares = await readPostcardShares(env);
  } catch {
    shares = [];
  }
  return looksDashboardPage(await safeReadLooks(env), members, shares);
}

export function membersDashboardPage(members = []) {
  const memberCount = Array.isArray(members) ? members.length : 0;
  const memberRows = membersListHtml(members);
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Members · The Soul Searchers</title>
  <link rel="icon" type="image/png" href="/logo.png" />
  <style>
    :root { --ink:#0c1218; --fog:#d7e0e8; --paper:#eef3f7; --amber:#d4a35a; --amber-hot:#f0c27a; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:var(--fog); background:var(--ink);
      font-family: "Sofia Sans Condensed", "Sofia Sans Extra Condensed", "Arial Narrow", sans-serif; }
    a { color: inherit; }
    a:hover { color: var(--amber-hot); }
    .site-shell { width: min(40rem, calc(100% - 2rem)); margin: 0 auto; padding: 2.5rem 0 4rem; }
    .eyebrow { margin:0 0 .4rem; letter-spacing:.16em; text-transform:uppercase; font-size:.78rem; color:var(--amber); font-weight:700; }
    h1 { margin:0 0 .75rem; font-size: clamp(2rem, 4vw, 2.8rem); color:var(--paper); }
    .lead { margin:0 0 1.75rem; color:rgba(215,224,232,.75); }
    ol { margin:0 0 1.5rem; padding:0; list-style:none; border:1px solid rgba(215,224,232,.1); border-radius:1rem; overflow:hidden; }
    li { display:flex; justify-content:space-between; gap:1rem; padding:.9rem 1.15rem; border-top:1px solid rgba(215,224,232,.08); }
    li:first-child { border-top:0; }
    li a { color:var(--paper); text-decoration:underline; text-decoration-color:rgba(240,194,122,.45); text-underline-offset:.18em; }
    li span { color:var(--amber-hot); font-weight:600; }
    .empty { color:rgba(215,224,232,.68); }
    .back a { color:var(--amber-hot); font-weight:600; text-decoration:none; }
  </style>
</head>
<body>
  <main class="site-shell">
    <p class="eyebrow">Private</p>
    <h1>Free members <span data-members-count>${memberCount}</span></h1>
    <p class="lead">Only for you. Everyone who joined the free list, newest first.</p>
    <ol data-members-list>${memberRows}</ol>
    <p class="back"><a href="/looks">Looks</a> · <a href="/admin/">Editor</a> · <a href="/">Home</a></p>
  </main>
</body>
</html>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}

export async function handleLooksRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/looks') return null;

  const store = looksStoreFor(env);
  if (request.method === 'GET') {
    if (!(await requestHasLooksAccess(request, env))) {
      return new Response(JSON.stringify({ error: 'private' }), {
        status: 401,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }
    const summary = await readLooks(store);
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      const ok =
        host === 'thenewsoulsearchers.de' ||
        host === 'www.thenewsoulsearchers.de' ||
        host === 'thenewsoulsearchers.com' ||
        host === 'www.thenewsoulsearchers.com' ||
        host.endsWith('.workers.dev') ||
        host === 'localhost' ||
        host === '127.0.0.1';
      if (!ok) return new Response('No', { status: 403 });
    } catch {
      return new Response('No', { status: 403 });
    }
  }

  let path = url.searchParams.get('path') || '/';
  const contentType = request.headers.get('content-type') || '';
  try {
    const raw = await request.text();
    if (raw) {
      if (contentType.includes('application/json') || raw.trim().startsWith('{')) {
        const body = JSON.parse(raw);
        if (body && typeof body.path === 'string') path = body.path;
      } else {
        path = raw;
      }
    }
  } catch {
    /* sendBeacon can send the path as plain text */
  }

  const result = await recordLook(store, path);
  return new Response(result.recorded ? null : JSON.stringify(result), {
    status: result.recorded ? 204 : 200,
    headers: { 'cache-control': 'no-store' },
  });
}
