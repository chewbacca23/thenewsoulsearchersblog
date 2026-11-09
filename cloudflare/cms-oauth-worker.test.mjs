import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker, { testables } from './cms-oauth-worker.js';

const {
  handleAuth,
  handleCallback,
  oauthCreds,
  statusPage,
  originAllowed,
  redirectComEditorToDe,
} = testables;

describe('dot-com twin domain', () => {
  it('allows .com origins for public APIs', () => {
    assert.equal(originAllowed('https://thenewsoulsearchers.com'), true);
    assert.equal(originAllowed('https://www.thenewsoulsearchers.com'), true);
    assert.equal(originAllowed('https://evil.example'), false);
  });

  it('sends .com editor paths over to .de', () => {
    const res = redirectComEditorToDe(new URL('https://thenewsoulsearchers.com/admin/'));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://thenewsoulsearchers.de/admin/');
    assert.equal(redirectComEditorToDe(new URL('https://thenewsoulsearchers.com/pulse')), null);
    assert.equal(redirectComEditorToDe(new URL('https://thenewsoulsearchers.de/admin/')), null);
  });
});

const creds = { id: 'client-id-test', secret: 'client-secret-test' };

describe('oauthCreds', () => {
  it('reads GITHUB_OAUTH_* names', () => {
    assert.deepEqual(
      oauthCreds({ GITHUB_OAUTH_CLIENT_ID: 'abc', GITHUB_OAUTH_CLIENT_SECRET: 'xyz' }),
      {
        id: 'abc',
        secret: 'xyz',
        idKey: 'GITHUB_OAUTH_CLIENT_ID',
        secretKey: 'GITHUB_OAUTH_CLIENT_SECRET',
      },
    );
  });

  it('returns null when secrets are missing', () => {
    assert.equal(oauthCreds({}), null);
    assert.equal(oauthCreds({ GITHUB_OAUTH_CLIENT_ID: 'abc' }), null);
  });

  it('tolerates hand-typed name variants', () => {
    const creds = oauthCreds({ GITHUB_OAUTH_ID: 'abc', GITHUB_OAUTH_SECRET: 'xyz' });
    assert.deepEqual({ id: creds.id, secret: creds.secret }, { id: 'abc', secret: 'xyz' });

    const bare = oauthCreds({ CLIENT_ID: 'abc', CLIENT_SECRET: 'xyz' });
    assert.deepEqual({ id: bare.id, secret: bare.secret }, { id: 'abc', secret: 'xyz' });
  });

  it('never reuses the secret as the client id', () => {
    assert.equal(oauthCreds({ GITHUB_OAUTH_CLIENT_SECRET: 'xyz' }), null);
  });

  it('ignores blank and non-string bindings', () => {
    assert.equal(
      oauthCreds({ GITHUB_OAUTH_CLIENT_ID: '  ', GITHUB_OAUTH_CLIENT_SECRET: 'xyz' }),
      null,
    );
    assert.equal(oauthCreds({ ASSETS: {}, GITHUB_OAUTH_CLIENT_SECRET: 'xyz' }), null);
  });

  it('prefers the documented names over fuzzy matches', () => {
    const creds = oauthCreds({
      SOME_CLIENT_ID: 'wrong',
      GITHUB_OAUTH_CLIENT_ID: 'right',
      GITHUB_OAUTH_CLIENT_SECRET: 'xyz',
    });
    assert.equal(creds.id, 'right');
    assert.equal(creds.idKey, 'GITHUB_OAUTH_CLIENT_ID');
  });
});

describe('GET /cms-status', () => {
  it('lists binding names without leaking values', async () => {
    const res = await statusPage({
      ASSETS: {},
      GITHUB_OAUTH_CLIENT_ID: 'Ov23abcdefghijklmnop',
      GITHUB_OAUTH_CLIENT_SECRET: 'super-secret-value',
    });
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.doesNotMatch(raw, /super-secret-value/);
    assert.doesNotMatch(raw, /Ov23abcdefghijklmnop/);

    const body = JSON.parse(raw);
    assert.equal(body.loginWired, true);
    assert.equal(body.clientIdBinding, 'GITHUB_OAUTH_CLIENT_ID');
    assert.equal(body.clientSecretBinding, 'GITHUB_OAUTH_CLIENT_SECRET');
    assert.equal(body.clientSecretLength, 'super-secret-value'.length);
    assert.match(body.clientIdShape, /looks like a GitHub client id/);
    assert.deepEqual(body.textBindingsVisibleToWorker, [
      'GITHUB_OAUTH_CLIENT_ID',
      'GITHUB_OAUTH_CLIENT_SECRET',
    ]);
    assert.deepEqual(body.otherBindingsVisibleToWorker, ['ASSETS']);
  });

  it('shows an empty binding list when secrets landed on another Worker', async () => {
    const body = JSON.parse(await (await statusPage({ ASSETS: {} })).text());
    assert.equal(body.loginWired, false);
    assert.equal(body.clientIdBinding, null);
    assert.deepEqual(body.textBindingsVisibleToWorker, []);
  });

  it('warns when the client secret was pasted into the client id slot', async () => {
    const body = JSON.parse(
      await (
        await statusPage({
          // 40 hex characters: the shape of a GitHub client secret.
          GITHUB_OAUTH_CLIENT_ID: 'a'.repeat(40),
          GITHUB_OAUTH_CLIENT_SECRET: 'b'.repeat(40),
        })
      ).text(),
    );
    assert.match(body.clientIdShape, /client SECRET/);
    assert.match(body.clientIdShape, /rotate/);
  });

  it('accepts a real-shaped GitHub client id but not a 40-hex string', async () => {
    const ok = JSON.parse(
      await (
        await statusPage({
          GITHUB_OAUTH_CLIENT_ID: 'Ov23li8qq16feoZZ0VOo',
          GITHUB_OAUTH_CLIENT_SECRET: 'b'.repeat(40),
        })
      ).text(),
    );
    assert.equal(ok.clientIdShape, 'looks like a GitHub client id');
  });

  it('flags a client id that is not shaped like GitHub', async () => {
    const body = JSON.parse(
      await (
        await statusPage({
          GITHUB_OAUTH_CLIENT_ID: 'pasted-the-wrong-thing',
          GITHUB_OAUTH_CLIENT_SECRET: 'xyz',
        })
      ).text(),
    );
    assert.match(body.clientIdShape, /does NOT look like/);
  });

  it('reports Looks storage as cache or kv without leaking values', async () => {
    const cacheBody = JSON.parse(await (await statusPage({ ASSETS: {} })).text());
    assert.ok(['cache', 'memory'].includes(cacheBody.looksStorage));
    assert.equal(cacheBody.looksDurable, false);

    const kvBody = JSON.parse(
      await (
        await statusPage({
          ASSETS: {},
          STATS: { get: async () => null, put: async () => {} },
        })
      ).text(),
    );
    assert.equal(kvBody.looksStorage, 'kv');
    assert.equal(kvBody.looksDurable, true);
    assert.ok(kvBody.otherBindingsVisibleToWorker.includes('STATS'));
  });

  it('is reachable through the Worker entrypoint', async () => {
    const res = await worker.fetch(new Request('https://thenewsoulsearchers.de/cms-status'), {
      ASSETS: { fetch: async () => new Response('should not be used') },
    });
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(JSON.parse(await res.text()).loginWired, false);
  });

  it('reports whether contact mail is wired', async () => {
    const cold = JSON.parse(await (await statusPage({ ASSETS: {} })).text());
    assert.equal(cold.mailWired, false);
    assert.equal(cold.mailVia, 'none');
    assert.match(cold.mailHint, /no text secrets|RESEND_API_KEY/);

    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('{"data":[]}', { status: 200 });
    try {
      const hot = JSON.parse(
        await (
          await statusPage({
            ASSETS: {},
            RESEND_API_KEY: 're_testkey_abcdefghijklmnopqrstuvwxyz12',
          })
        ).text(),
      );
      assert.equal(hot.mailWired, true);
      assert.equal(hot.mailVia, 'resend');
      assert.equal(hot.mailKeyProbe.ok, true);
      assert.match(hot.mailHint, /Resend accepted|Mail is ready|send a short test/);
      assert.match(hot.mailKeyShape.shape, /looks like a Resend key/);
    } finally {
      globalThis.fetch = original;
    }

    const oauthOnly = JSON.parse(
      await (
        await statusPage({
          ASSETS: {},
          GITHUB_OAUTH_CLIENT_ID: 'Ov23li8qq16feoZZ0VOo',
          GITHUB_OAUTH_CLIENT_SECRET: 'b'.repeat(40),
        })
      ).text(),
    );
    assert.equal(oauthOnly.mailWired, false);
    assert.match(oauthOnly.mailHint, /SOUL_RESEND_KEY/);
  });

  it('tells Henrik when Resend rejects the key', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('unauthorized', { status: 401 });
    try {
      const body = JSON.parse(
        await (
          await statusPage({
            ASSETS: {},
            RESEND_API_KEY: 're_dead_key_value_here_xxxx',
          })
        ).text(),
      );
      assert.equal(body.mailWired, true);
      assert.equal(body.mailKeyProbe.ok, false);
      assert.equal(body.mailKeyProbe.status, 401);
      assert.match(body.mailHint, /Resend rejected this API key/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('GET /auth', () => {
  it('explains the click-by-click setup when secrets are missing', async () => {
    const res = await worker.fetch(new Request('https://thenewsoulsearchers.de/auth?provider=github'), {});
    assert.equal(res.status, 503);
    const html = await res.text();
    assert.match(html, /GITHUB_OAUTH_CLIENT_SECRET/);
    assert.match(html, /thenewsoulsearchers\.de\/callback/);
    assert.match(html, /thenewsoulsearchersblogc/);
  });

  it('says "no variables at all" when the keys went to another Worker', async () => {
    const res = await worker.fetch(
      new Request('https://thenewsoulsearchers.de/auth?provider=github'),
      { ASSETS: {} },
    );
    const html = await res.text();
    assert.match(html, /no variables or secrets at all/);
    assert.match(html, /Build/);
  });

  it('names the bindings it found when only the names are wrong', async () => {
    const res = await worker.fetch(
      new Request('https://thenewsoulsearchers.de/auth?provider=github'),
      { GITHUB_TOKEN_THING: 'value-should-not-appear' },
    );
    const html = await res.text();
    assert.match(html, /GITHUB_TOKEN_THING/);
    assert.doesNotMatch(html, /value-should-not-appear/);
    assert.doesNotMatch(html, /no variables or secrets at all/);
  });

  it('redirects to GitHub authorize with the live callback', async () => {
    const res = await worker.fetch(
      new Request('https://thenewsoulsearchers.de/auth?provider=github'),
      { GITHUB_OAUTH_CLIENT_ID: creds.id, GITHUB_OAUTH_CLIENT_SECRET: creds.secret },
    );
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get('location'));
    assert.equal(location.hostname, 'github.com');
    assert.equal(location.pathname, '/login/oauth/authorize');
    assert.equal(location.searchParams.get('client_id'), creds.id);
    assert.equal(location.searchParams.get('redirect_uri'), 'https://thenewsoulsearchers.de/callback');
    assert.equal(location.searchParams.get('scope'), 'public_repo,user');
    assert.ok(location.searchParams.get('state'));
  });

  it('rejects a non-github provider', async () => {
    const res = handleAuth(new URL('https://thenewsoulsearchers.de/auth?provider=gitlab'), creds);
    assert.equal(res.status, 400);
  });
});

describe('GET /callback', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns Decap postMessage HTML after a successful token exchange', async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://github.com/login/oauth/access_token');
      const body = JSON.parse(init.body);
      assert.equal(body.code, 'gh-code');
      assert.equal(body.redirect_uri, 'https://thenewsoulsearchers.de/callback');
      return new Response(JSON.stringify({ access_token: 'gho_test_token' }), {
        headers: { 'content-type': 'application/json' },
      });
    };

    const res = await handleCallback(
      new URL('https://thenewsoulsearchers.de/callback?code=gh-code'),
      creds,
    );
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /authorization:github:success:/);
    assert.match(html, /gho_test_token/);
    assert.match(html, /authorizing:github/);
    assert.match(res.headers.get('set-cookie') || '', /ss_looks=/);
  });

  it('returns Decap error HTML when GitHub denies login', async () => {
    const res = await handleCallback(
      new URL('https://thenewsoulsearchers.de/callback?error=access_denied'),
      creds,
    );
    const html = await res.text();
    assert.match(html, /authorization:github:error:/);
  });
});

describe('static assets fallback', () => {
  it('forwards non-oauth paths to ASSETS', async () => {
    const res = await worker.fetch(new Request('https://thenewsoulsearchers.de/admin/'), {
      ASSETS: {
        fetch: async () => new Response('admin-ok'),
      },
    });
    assert.equal(await res.text(), 'admin-ok');
  });

  it('fills an empty published ride from GitHub', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        '---\ntitle: Patches\nheadline: Patches\ncover: /stories/img_6440-2.jpg\ndraft: false\n---\nSitting in front of me are two small patches.\n',
        { status: 200 },
      );
    try {
      const res = await worker.fetch(
        new Request('https://thenewsoulsearchers.de/stories/the-most-wonderful-patches'),
        {
          ASSETS: {
            fetch: async () =>
              new Response('<h1>Patches</h1><div class="prose"></div>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
              }),
          },
        },
      );
      const html = await res.text();
      assert.match(html, /two small patches/);
      assert.match(html, /img_6440-2\.jpg/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
