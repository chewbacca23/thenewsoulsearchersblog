/**
 * Weekly ritual — “Where did you stand?”
 * First name + place (+ optional one-line tip). Public wall. Soft and kind.
 *
 * GET  /api/week-stand  → { ok, week, stands }
 * POST /api/week-stand  { name, place, tip?, website? }
 */

import { cleanLine, deliverContact } from './contact-mail.js';
import { isKindMessage } from './kind-remarks.js';

export const MAX_NAME = 40;
export const MAX_PLACE = 80;
export const MAX_TIP = 140;
export const LIST_LIMIT = 48;
export const STORE_LIMIT = 120;
export const RATE_WINDOW_SEC = 60 * 60;
export const RATE_MAX = 6;
export const STANDS_LIST_KEY = 'week-stand:list';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function clientKey(request) {
  const cf = /** @type {{ colo?: string }} */ (request.cf || {});
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    'unknown';
  return `week-stand:rate:${ip}:${cf.colo || 'xx'}`;
}

/**
 * @param {any} env
 * @param {string} key
 */
async function underRateLimit(env, key) {
  const kv = env?.STATS;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return true;
  const now = Date.now();
  let hits = [];
  try {
    const raw = await kv.get(key);
    hits = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(hits)) hits = [];
  } catch {
    hits = [];
  }
  hits = hits.filter((t) => typeof t === 'number' && now - t < RATE_WINDOW_SEC * 1000);
  if (hits.length >= RATE_MAX) return false;
  hits.push(now);
  await kv.put(key, JSON.stringify(hits), { expirationTtl: RATE_WINDOW_SEC + 60 });
  return true;
}

/** Berlin calendar day as YYYY-MM-DD. */
export function berlinYmd(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((part) => part.type === type)?.value || '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** ISO week key in Berlin time, e.g. 2026-W46. */
export function isoWeekKey(ms = Date.now()) {
  const [y, m, d] = berlinYmd(ms).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function weekLabel(week, nowMs = Date.now()) {
  const key = String(week || '');
  if (!key) return 'This week';
  if (key === isoWeekKey(nowMs)) return 'This week';
  if (key === isoWeekKey(nowMs - 7 * 86400000)) return 'Last week';
  return key.replace('-W', ' · week ');
}

/**
 * @param {unknown} body
 */
export function parseStandBody(body) {
  const data = body && typeof body === 'object' ? body : {};
  return {
    name: cleanLine(data.name, MAX_NAME),
    place: cleanLine(data.place, MAX_PLACE),
    tip: cleanLine(data.tip || data.message || '', MAX_TIP),
    website: cleanLine(data.website || data.company, 80),
  };
}

/**
 * @param {{ name: string, place: string, tip: string }} fields
 */
export function validateStand(fields) {
  if (!fields.name || fields.name.length < 2) return 'A first name, please.';
  if (!fields.place || fields.place.length < 2) return 'Where did you stand?';
  if (/https?:\/\//i.test(fields.name) || /https?:\/\//i.test(fields.place)) {
    return 'Keep links out — just a name and a place.';
  }
  if (fields.tip && !isKindMessage(fields.tip)) {
    return 'This site only keeps kind words.';
  }
  if (!isKindMessage(`${fields.name} ${fields.place}`)) {
    return 'This site only keeps kind words.';
  }
  return '';
}

/**
 * @param {any} env
 */
export async function readWeekStands(env) {
  const kv = env?.STATS;
  if (!kv || typeof kv.get !== 'function') return [];
  try {
    const raw = await kv.get(STANDS_LIST_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * @param {any} env
 * @param {{ name: string, place: string, tip: string }} fields
 * @param {number} [nowMs]
 */
export async function saveWeekStand(env, fields, nowMs = Date.now()) {
  const kv = env?.STATS;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    const err = new Error('Week stand storage is not wired.');
    // @ts-expect-error code
    err.code = 'E_STAND_KV';
    throw err;
  }
  const entry = {
    id: `${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name: fields.name,
    place: fields.place,
    tip: fields.tip || '',
    week: isoWeekKey(nowMs),
    at: new Date(nowMs).toISOString(),
  };
  let list = await readWeekStands(env);
  list = [entry, ...list].slice(0, STORE_LIMIT);
  await kv.put(STANDS_LIST_KEY, JSON.stringify(list));
  return entry;
}

/**
 * @param {Array<{ name?: string, place?: string, tip?: string, week?: string, at?: string }>} stands
 * @param {number} [nowMs]
 */
export function publicStands(stands, nowMs = Date.now()) {
  return (Array.isArray(stands) ? stands : [])
    .filter((row) => row && row.name && row.place)
    .slice(0, LIST_LIMIT)
    .map((row) => ({
      id: String(row.id || ''),
      name: String(row.name || '').slice(0, MAX_NAME),
      place: String(row.place || '').slice(0, MAX_PLACE),
      tip: String(row.tip || '').slice(0, MAX_TIP),
      week: String(row.week || ''),
      weekLabel: weekLabel(row.week, nowMs),
      at: String(row.at || ''),
    }));
}

/**
 * @param {any} env
 * @param {{ name: string, place: string, tip: string }} fields
 */
export async function notifyWeekStand(env, fields) {
  await deliverContact(env, {
    name: fields.name || 'Week stand',
    email: 'hello@thenewsoulsearchers.de',
    message: [
      'Someone left a weekly stand.',
      '',
      `Name: ${fields.name}`,
      `Place: ${fields.place}`,
      fields.tip ? `Tip: ${fields.tip}` : '',
      '',
      'See the wall: https://thenewsoulsearchers.de/stand',
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleWeekStandRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/week-stand' && url.pathname !== '/api/week-stand/') {
    return null;
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  if (request.method === 'GET') {
    const stands = publicStands(await readWeekStands(env));
    return json({
      ok: true,
      week: isoWeekKey(),
      weekLabel: weekLabel(isoWeekKey()),
      count: stands.length,
      stands,
    });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'POST a first name and a place.' }, 405);
  }

  if (!(await underRateLimit(env, clientKey(request)))) {
    return json({ ok: false, error: 'Easy, rider. Wait a little, then try again.' }, 429);
  }

  const fields = parseStandBody(await readJson(request));
  if (fields.website) {
    return json({ ok: true, via: 'discard' });
  }

  const problem = validateStand(fields);
  if (problem) return json({ ok: false, error: problem }, 400);

  try {
    const saved = await saveWeekStand(env, fields);
    try {
      await notifyWeekStand(env, fields);
    } catch (mailErr) {
      console.error('week stand notify failed', mailErr);
    }
    return json({
      ok: true,
      stand: {
        ...saved,
        weekLabel: weekLabel(saved.week),
      },
    });
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : '';
    if (code === 'E_STAND_KV') {
      return json(
        { ok: false, error: 'The weekly stand is not wired on the Worker yet.', code },
        503,
      );
    }
    console.error('week stand save failed', error);
    return json({ ok: false, error: 'Could not keep that just now.' }, 502);
  }
}
