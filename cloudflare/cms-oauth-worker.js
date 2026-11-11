/**
 * GitHub OAuth proxy for Decap CMS on the Soul Searchers Worker.
 * Handles /auth and /callback, then serves the static Astro site.
 *
 * Secrets (Cloudflare dashboard → thenewsoulsearchersblogc → Settings →
 * Variables and Secrets):
 *   GITHUB_OAUTH_CLIENT_ID
 *   GITHUB_OAUTH_CLIENT_SECRET
 *   KIT_PASSWORD (unused while /kit is public)
 */

import {
  applyLooksToAsset,
  handleLooksPage,
  handleLooksRequest,
  looksSetCookie,
  looksStoreKind,
  looksStatsBindingInfo,
  looksToken,
  recordDocumentLook,
} from './page-looks.js';
import { handleKitRoom } from './kit-room.js';
import { handleHooksRequest } from './hooks-board.js';
import { handleFreshRide } from './fresh-ride.js';
import { handleFreshShop } from './fresh-shop.js';
import { handleFreshSite } from './fresh-site.js';
import { handleFreshHome } from './fresh-home.js';
import {
  describeResendKey,
  handleContactRequest,
  mailReady,
  mailVia,
  probeResendKey,
  resolveContactTo,
  resolveResendFrom,
  resolveResendKey,
  RESEND_KEY_BINDINGS,
} from './contact-mail.js';
import { handleRemarksRequest } from './kind-remarks.js';
import { handleMembersRequest } from './member-mail.js';
import { handlePostcardSharesRequest } from './postcard-shares.js';
import { handleStoodPlacesRequest } from './stood-places.js';
import { handleWeekStandRequest } from './week-stand.js';
import {
  applyPulseToAsset,
  handlePulseRequest,
  runPulseCron,
} from './thin-tires-pulse.js';

const PROVIDER = 'github';
const SCOPE = 'public_repo,user';

/** Public hosts that serve this Worker. .de stays the home for SEO + the editor. */
const SITE_HOSTS = new Set([
  'thenewsoulsearchers.de',
  'www.thenewsoulsearchers.de',
  'thenewsoulsearchers.com',
  'www.thenewsoulsearchers.com',
]);
const PRIMARY_HOST = 'thenewsoulsearchers.de';
const COM_HOSTS = new Set(['thenewsoulsearchers.com', 'www.thenewsoulsearchers.com']);

const ID_PATTERNS = [
  /^GITHUB_OAUTH_CLIENT_ID$/i,
  /^GITHUB_CLIENT_ID$/i,
  /^(GITHUB|OAUTH).*(CLIENT_?)?ID$/i,
  /CLIENT_?ID$/i,
];

const SECRET_PATTERNS = [
  /^GITHUB_OAUTH_CLIENT_SECRET$/i,
  /^GITHUB_CLIENT_SECRET$/i,
  /^(GITHUB|OAUTH).*SECRET$/i,
  /CLIENT_?SECRET$/i,
];

/**
 * Names drift when secrets are typed by hand, so match the documented names
 * first and fall back to anything unambiguous.
 * @param {Record<string, unknown>} env
 * @param {RegExp[]} patterns
 */
function pickByName(env, patterns) {
  const entries = Object.entries(env).filter(
    ([, value]) => typeof value === 'string' && value.trim() !== '',
  );
  for (const pattern of patterns) {
    const hit = entries.find(([key]) => pattern.test(key));
    if (hit) return { key: hit[0], value: String(hit[1]).trim() };
  }
  return null;
}

/**
 * @param {Record<string, unknown>} env
 * @returns {{ id: string, secret: string, idKey: string, secretKey: string } | null}
 */
function oauthCreds(env) {
  const secret = pickByName(env, SECRET_PATTERNS);
  const id = pickByName(
    // Never let the secret double as the client id.
    Object.fromEntries(Object.entries(env).filter(([key]) => key !== secret?.key)),
    ID_PATTERNS,
  );
  if (!id || !secret) return null;
  return { id: id.value, secret: secret.value, idKey: id.key, secretKey: secret.key };
}

/**
 * GitHub OAuth app client ids are public and fixed-length; client secrets are
 * 40 hex characters. Pasting the secret into the client id slot publishes it
 * in every /auth redirect, so name that mistake explicitly.
 * @param {string} id
 */
function describeClientId(id) {
  if (/^[0-9a-f]{40}$/i.test(id)) {
    return 'WARNING: this is 40 hex characters, the shape of a GitHub client SECRET, not a client id. Replace it, then rotate the secret on GitHub — it has been exposed in redirect URLs.';
  }
  if (/^Ov23[A-Za-z0-9]{16}$/.test(id)) return 'looks like a GitHub client id';
  if (/^Iv1\.[0-9a-f]{16}$/i.test(id)) return 'looks like a GitHub client id';
  if (/^[0-9a-f]{20}$/i.test(id)) return 'looks like a GitHub client id';
  return 'does NOT look like a GitHub client id';
}

/**
 * Report which binding names this Worker can actually see. Names only — no
 * values — so it is safe to open in a browser and paste into a chat.
 * @param {Record<string, unknown>} env
 */
async function statusPage(env) {
  const creds = oauthCreds(env);
  const stringKeys = Object.keys(env)
    .filter((key) => typeof env[key] === 'string')
    .sort();
  const otherKeys = Object.keys(env)
    .filter((key) => typeof env[key] !== 'string')
    .sort();

  const idShape = creds ? describeClientId(creds.id) : 'n/a';
  const looksStorage = looksStoreKind(env);
  const statsBinding = looksStatsBindingInfo(env);

  const mailOn = mailReady(env);
  const mailPath = mailVia(env);
  const resolvedKey = resolveResendKey(env);
  const seesResendName = RESEND_KEY_BINDINGS.some((name) => stringKeys.includes(name));
  const mailKeyShape = describeResendKey(resolvedKey.raw || env?.RESEND_API_KEY, resolvedKey.binding);
  const mailKeyProbe = mailPath === 'resend' ? await probeResendKey(env) : { ok: false, status: 0, detail: 'n/a' };

  let mailHint =
    'Mail is ready. Hard-refresh /contact and send a short test — look for Sent.';
  if (!mailOn) {
    if (seesResendName) {
      mailHint =
        'A Resend binding exists but is empty. Prefer a new secret named SOUL_RESEND_KEY on thenewsoulsearchersblogc.';
    } else if (stringKeys.length === 0) {
      mailHint =
        'This Worker sees no text secrets. Put SOUL_RESEND_KEY on thenewsoulsearchersblogc (not a sibling Worker, not Build vars).';
    } else {
      mailHint =
        'OAuth keys are on this Worker, but no Resend key is. Add secret SOUL_RESEND_KEY on thenewsoulsearchersblogc.';
    }
  } else if (mailKeyProbe && mailKeyProbe.ok === false && !mailKeyShape.startsWithRe) {
    mailHint =
      'The saved key still does not start with re_. Ignore RESEND_API_KEY. Create secret SOUL_RESEND_KEY with a fresh re_… value (wrangler secret put SOUL_RESEND_KEY --name thenewsoulsearchersblogc).';
  } else if (mailKeyProbe && mailKeyProbe.ok === false && mailKeyShape.length > 0 && mailKeyShape.length < 20) {
    mailHint =
      'Resend key is too short. Create SOUL_RESEND_KEY with the full re_… token via wrangler secret put.';
  } else if (mailKeyProbe && mailKeyProbe.ok === false && mailKeyProbe.status === 401) {
    mailHint =
      'Resend rejected this API key (401). Create a fresh key, put it in SOUL_RESEND_KEY on thenewsoulsearchersblogc, refresh until mailKeyProbe.ok is true.';
  } else if (mailKeyProbe && mailKeyProbe.ok === false && mailKeyProbe.status) {
    mailHint = `Resend probe failed (${mailKeyProbe.status}): ${mailKeyProbe.detail}. Fix the key on ${mailKeyProbe.binding || 'SOUL_RESEND_KEY'}, then refresh this page.`;
  } else if (mailKeyProbe && mailKeyProbe.ok) {
    mailHint =
      'Resend accepted the key. Hard-refresh /contact and send a short test — look for Sent.';
  }
  const mailToNow = resolveContactTo(env);
  if (
    mailKeyProbe &&
    mailKeyProbe.ok &&
    mailToNow.toLowerCase().endsWith('@thenewsoulsearchers.de')
  ) {
    mailHint =
      'Key is fine. If Resend still Bounces to henrik@thenewsoulsearchers.de, Strato is rejecting same-domain mail from Resend (anti-spoof). Soften root SPF (-all → ~all, add include:amazonses.com) or set CONTACT_INBOX to a Gmail you read on the laptop.';
  }

  const body = {
    loginWired: Boolean(creds),
    clientIdBinding: creds ? creds.idKey : null,
    clientIdShape: idShape,
    clientSecretBinding: creds ? creds.secretKey : null,
    clientSecretLength: creds ? creds.secret.length : 0,
    looksStorage,
    looksDurable: looksStorage === 'kv',
    statsBinding,
    mailWired: mailOn,
    mailVia: mailPath,
    mailTo: mailToNow,
    mailFrom: mailPath === 'resend' ? resolveResendFrom(env) : 'hello@thenewsoulsearchers.de',
    mailKeyBinding: resolvedKey.binding,
    mailKeyShape,
    mailKeyProbe,
    mailHint,
    // Helps Henrik: Resend dashboard / wrong Worker can show re_… while THIS
    // live Worker still holds a different 8-char scrap.
    whereThisJsonComesFrom:
      'thenewsoulsearchers.de → Worker thenewsoulsearchersblogc (name ends with c). If Cloudflare UI shows re_… on another Worker, that is not this JSON.',
    textBindingsVisibleToWorker: stringKeys,
    otherBindingsVisibleToWorker: otherKeys,
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** @param {string} origin */
function callbackUrl(origin) {
  return `${origin}/callback`;
}

/**
 * @param {string} origin
 * @returns {boolean}
 */
function originAllowed(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return false;
    }
    if (SITE_HOSTS.has(hostname)) return true;
    if (hostname.endsWith('.workers.dev')) return true;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Keep GitHub OAuth + Looks login on .de so one callback URL stays enough.
 * @param {URL} url
 * @returns {Response | null}
 */
function redirectComEditorToDe(url) {
  if (!COM_HOSTS.has(url.hostname)) return null;
  const path = url.pathname;
  const editorPath =
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/auth' ||
    path === '/callback' ||
    path === '/looks' ||
    path.startsWith('/looks/') ||
    path === '/members';
  if (!editorPath) return null;
  const next = new URL(url.toString());
  next.protocol = 'https:';
  next.hostname = PRIMARY_HOST;
  return Response.redirect(next.toString(), 302);
}

/**
 * Say which of the two likely mistakes this actually is, rather than
 * repeating generic setup steps the reader has already followed.
 * @param {Record<string, unknown>} env
 */
function diagnosisHtml(env) {
  const names = Object.keys(env).filter((key) => typeof env[key] === 'string' && env[key] !== '');

  if (names.length === 0) {
    return `<p class="diag"><strong>What this Worker sees:</strong> no variables or secrets at all.</p>
  <p class="diag">So the two keys are somewhere else. Either they went on a different Worker
  (the dashboard also lists <code>thenewsoulsearchersblog</code> without the <code>c</code>,
  plus <code>bloga</code>, <code>blogb</code>, <code>bl</code>, <code>blo</code> — only
  <code>thenewsoulsearchersblogc</code> is on the domain), or they were added under
  <strong>Build</strong> variables, which never reach the running site.</p>`;
  }

  return `<p class="diag"><strong>What this Worker sees:</strong>
  <code>${names.map((n) => n.replace(/[<>&]/g, '')).join('</code>, <code>')}</code></p>
  <p class="diag">The right Worker has the values, but the names did not match a client id
  <em>and</em> a client secret. Rename them to <code>GITHUB_OAUTH_CLIENT_ID</code> and
  <code>GITHUB_OAUTH_CLIENT_SECRET</code>.</p>`;
}

/** @param {Record<string, unknown>} env */
function missingSecretsPage(env = {}) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CMS login not wired yet</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; background: #0c1218; color: #eef3f7;
      max-width: 40rem; margin: 2rem auto; padding: 0 1.2rem; line-height: 1.45; }
    h1 { color: #f0c27a; font-size: 1.25rem; }
    ol { padding-left: 1.2rem; }
    code { color: #f0c27a; }
    a { color: #8ec8ff; }
    .diag { background: rgba(30, 40, 48, 0.92); border: 1px solid rgba(240, 194, 122, 0.35);
      border-radius: 8px; padding: 0.7rem 0.9rem; margin: 0.6rem 0; }
  </style>
</head>
<body>
  <h1>One GitHub app, then two Cloudflare secrets</h1>
  ${diagnosisHtml(env)}
  <p>The editor is ready. GitHub login still needs credentials (not in git — you add them in the dashboards).</p>
  <p><strong>A. GitHub OAuth app</strong></p>
  <ol>
    <li>Open <a href="https://github.com">github.com</a> as <code>chewbacca23</code></li>
    <li>Photo (top right) → <strong>Settings</strong></li>
    <li>Bottom of the left list → <strong>Developer settings</strong></li>
    <li><strong>OAuth Apps</strong> → <strong>New OAuth App</strong></li>
    <li>Application name: <code>Soul Searchers CMS</code></li>
    <li>Homepage URL: <code>https://thenewsoulsearchers.de</code></li>
    <li>Authorization callback URL: <code>https://thenewsoulsearchers.de/callback</code></li>
    <li><strong>Register application</strong> → copy the Client ID</li>
    <li><strong>Generate a new client secret</strong> → copy it (once)</li>
  </ol>
  <p><strong>B. Cloudflare secrets</strong></p>
  <ol>
    <li>Open <a href="https://dash.cloudflare.com">dash.cloudflare.com</a></li>
    <li><strong>Workers</strong> → <strong>thenewsoulsearchersblogc</strong> (the live journal Worker — the one with a <code>c</code>, not the shop)</li>
    <li><strong>Settings</strong> → <strong>Variables and Secrets</strong> — the runtime one. Values added under <strong>Build</strong> do not reach the live site.</li>
    <li>Name <code>GITHUB_OAUTH_CLIENT_ID</code>, type Text, paste the Client ID → Save</li>
    <li><strong>Add</strong> again: name <code>GITHUB_OAUTH_CLIENT_SECRET</code>, type <strong>Secret</strong>, paste the secret → Save</li>
  </ol>
  <p><strong>Stuck?</strong> Open <a href="/cms-status">/cms-status</a>. It lists the binding names this Worker can actually see — never the values — so you can tell “wrong Worker” from “wrong name” instead of guessing.</p>
  <p>Then close this window, open <a href="https://thenewsoulsearchers.de/admin/">thenewsoulsearchers.de/admin/</a> (not www), and click <strong>Login with GitHub</strong> again.</p>
</body>
</html>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

/** @param {URL} url @param {{ id: string, secret: string }} creds */
function handleAuth(url, creds) {
  const provider = url.searchParams.get('provider');
  if (provider && provider !== PROVIDER) {
    return new Response('Invalid provider', { status: 400 });
  }

  const origin = url.origin;
  const state = crypto.randomUUID();
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', creds.id);
  authorize.searchParams.set('redirect_uri', callbackUrl(origin));
  authorize.searchParams.set('scope', SCOPE);
  authorize.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      'cache-control': 'no-store',
      'set-cookie': `cms_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

/**
 * @param {string} status
 * @param {Record<string, unknown>} content
 */
function callbackHtml(status, content) {
  const payload = JSON.stringify(content);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Authorizing…</title></head>
<body>
<p>Logging you into the Soul Searchers editor…</p>
<script>
(function () {
  function allowed(origin) {
    try {
      var host = new URL(origin).hostname;
      return (
        host === "thenewsoulsearchers.de" ||
        host === "www.thenewsoulsearchers.de" ||
        host === "thenewsoulsearchers.com" ||
        host === "www.thenewsoulsearchers.com" ||
        host.endsWith(".workers.dev") ||
        host === "localhost" ||
        host === "127.0.0.1"
      );
    } catch (e) {
      return false;
    }
  }
  function receiveMessage(e) {
    if (!allowed(e.origin)) return;
    window.opener.postMessage(
      "authorization:github:${status}:" + ${JSON.stringify(payload)},
      e.origin
    );
    window.removeEventListener("message", receiveMessage, false);
  }
  window.addEventListener("message", receiveMessage, false);
  window.opener.postMessage("authorizing:github", "*");
})();
</script>
</body>
</html>`;
}

/**
 * @param {URL} url
 * @param {{ id: string, secret: string }} creds
 */
async function handleCallback(url, creds) {
  const ghError = url.searchParams.get('error');
  if (ghError) {
    const html = callbackHtml('error', {
      error: ghError,
      errorDescription: url.searchParams.get('error_description') || 'GitHub login was cancelled.',
    });
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return new Response('Missing code', { status: 400 });
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: creds.id,
      client_secret: creds.secret,
      code,
      redirect_uri: callbackUrl(url.origin),
    }),
  });

  const data = await tokenRes.json().catch(() => ({}));
  if (!data.access_token) {
    const html = callbackHtml('error', {
      error: data.error || 'token_exchange_failed',
      errorDescription: data.error_description || 'GitHub did not return an access token.',
    });
    return new Response(html, {
      status: 400,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const html = callbackHtml('success', { token: data.access_token, provider: PROVIDER });
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  };
  const token = await looksToken(creds.secret);
  if (token) {
    headers['set-cookie'] = looksSetCookie(token, { secure: url.protocol === 'https:' });
  }
  return new Response(html, { headers });
}

export default {
  /**
   * Thin tires pulse — every 3rd calendar day at 06:00 UTC.
   * @param {ScheduledController} controller
   * @param {Record<string, unknown>} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(controller, env, ctx) {
    const job = runPulseCron(env);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
    else await job;
  },

  /**
   * @param {Request} request
   * @param {{ ASSETS?: { fetch: (request: Request) => Promise<Response> }, GITHUB_OAUTH_CLIENT_ID?: string, GITHUB_OAUTH_CLIENT_SECRET?: string, GITHUB_CLIENT_ID?: string, GITHUB_CLIENT_SECRET?: string }} env
   */
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      const comEditor = redirectComEditorToDe(url);
      if (comEditor) return comEditor;

      if (url.pathname === '/cms-status') return await statusPage(env);

      const pulseApi = await handlePulseRequest(request, env);
      if (pulseApi) return pulseApi;

      const kit = await handleKitRoom(request, env);
      if (kit) return kit;

      const contact = await handleContactRequest(request, env);
      if (contact) return contact;

      const remarks = await handleRemarksRequest(request, env);
      if (remarks) return remarks;

      const members = await handleMembersRequest(request, env);
      if (members) return members;

      const postcardShares = await handlePostcardSharesRequest(request, env);
      if (postcardShares) return postcardShares;

      const stoodPlaces = await handleStoodPlacesRequest(request, env);
      if (stoodPlaces) return stoodPlaces;

      const weekStand = await handleWeekStandRequest(request, env);
      if (weekStand) return weekStand;

      const hooks = await handleHooksRequest(request, env);
      if (hooks) return hooks;

      const looks = await handleLooksRequest(request, env);
      if (looks) return looks;

      // Await real page opens so Looks → open Home → refresh sees the new row.
      // Background only for non-document fetches (css, etc. already skipped).
      const lookJob = recordDocumentLook(request, env);
      const fetchDest = (request.headers.get('sec-fetch-dest') || '').toLowerCase();
      if (fetchDest === 'document' || fetchDest === '' || fetchDest === 'empty') {
        await lookJob;
      } else if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(lookJob);
      } else {
        await lookJob;
      }

      const freshRide = await handleFreshRide(request, env);
      if (freshRide) return freshRide;

      const freshShop = await handleFreshShop(request, env);
      if (freshShop) return freshShop;

      const freshSite = await handleFreshSite(request, env);
      if (freshSite) return freshSite;

      const freshHome = await handleFreshHome(request, env);
      if (freshHome) return freshHome;

      if (url.pathname === '/auth' || url.pathname === '/callback') {
        const creds = oauthCreds(env);
        if (!creds) return missingSecretsPage(env);
        if (url.pathname === '/auth') return handleAuth(url, creds);
        return handleCallback(url, creds);
      }

      if (env.ASSETS) {
        const asset = await env.ASSETS.fetch(request);
        try {
          let next = asset;
          try {
            const withPulse = await applyPulseToAsset(request, env, next);
            if (withPulse) next = withPulse;
          } catch {
            /* keep asset */
          }
          const filled = await applyLooksToAsset(request, env, next);
          return filled || next;
        } catch {
          return asset;
        }
      }

      const looksPage = await handleLooksPage(request, env);
      if (looksPage) return looksPage;
      return new Response('Not found', { status: 404 });
    } catch {
      if (env?.ASSETS) {
        try {
          return await env.ASSETS.fetch(request);
        } catch {
          /* fall through */
        }
      }
      return new Response('The Soul Searchers will be right back.', {
        status: 503,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'retry-after': '8',
        },
      });
    }
  },
};

export const testables = {
  oauthCreds,
  originAllowed,
  redirectComEditorToDe,
  SITE_HOSTS,
  PRIMARY_HOST,
  callbackUrl,
  handleAuth,
  handleCallback,
  missingSecretsPage,
  statusPage,
  pickByName,
};
