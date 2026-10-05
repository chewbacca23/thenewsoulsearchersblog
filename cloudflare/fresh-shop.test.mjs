import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { parseMarkdownFile, parseSimpleYaml } from './fresh-ride.js';
import {
  fillShopInHtml,
  handleFreshShop,
  isShopPath,
  productFromMarkdown,
  shopSlugsFromHtml,
} from './fresh-shop.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('isShopPath', () => {
  it('marks the public shop page', () => {
    assert.equal(isShopPath('/shop'), true);
    assert.equal(isShopPath('/shop/'), true);
    assert.equal(isShopPath('/about'), false);
    assert.equal(isShopPath('/admin/'), false);
  });
});

describe('folded shop blurb', () => {
  it('reads the live crest markdown from GitHub-style YAML', () => {
    const raw = readFileSync('src/content/shop/woven-crest-patch.md', 'utf8');
    const parsed = parseMarkdownFile(raw);
    assert.match(parsed.data.blurb, /in production now/);
    assert.match(parsed.data.blurb, /about two weeks/);
    assert.equal(parsed.data.title, 'Woven crest patch');
    assert.equal(parsed.data.limit, '50 worldwide');
  });

  it('keeps the rest of a wrapped shop note, not only the first line', () => {
    const raw = `---
title: "Stickers are here ;) "
blurb: There are some crisp stickers here these are made in sweden came to
  berlin and be with you for a fiver each sticker, they are heavy outdoor
  stickers and are 6,5 cm by 10 cm tall ;) help yourselves ;)
photo: /stories/img_6620-2.jpeg
mailSubject: Shop
order: 0
draft: false
---
`;
    const product = productFromMarkdown('stickers-are-here', raw);
    assert.match(product.blurb, /came to berlin/);
    assert.match(product.blurb, /6,5 cm by 10 cm/);
    const html = fillShopInHtml(
      '<ul class="product-list"><li class="product" data-shop-slug="stickers-are-here"><h2 class="product-title">Old</h2><p class="product-blurb">There are some crisp stickers here these are made in sweden came to</p></li></ul>',
      [product],
    );
    assert.match(html, /came to berlin/);
    assert.match(html, /help yourselves/);
  });

  it('folds >- paragraphs into one blurb', () => {
    const yaml = parseSimpleYaml('blurb: >-\n  First line\n  still first.\n\n  Second bit.\nphoto: ""\n');
    assert.equal(yaml.blurb, 'First line still first.\n\nSecond bit.');
    assert.equal(yaml.photo, '');
  });
});

describe('fillShopInHtml', () => {
  it('paints a GitHub Save over a stale baked shop page', () => {
    const html = fillShopInHtml(
      `<ul class="product-list" data-astro-cid-abc123>
        <li class="product" data-shop-slug="woven-crest-patch" data-astro-cid-abc123>
          <img class="product-photo product-photo--crest" src="/logo.png" width="627" height="1000" alt="crest" />
          <h2 class="product-title">Woven crest patch</h2>
          <p class="product-blurb">Old wait line.</p>
        </li>
      </ul>`,
      [
        productFromMarkdown(
          'woven-crest-patch',
          `---
title: Woven crest patch
blurb: >-
  They are in production now and will arrive in about two weeks.
limit: 50 worldwide
mailSubject: Patch
order: 0
draft: false
---
`,
        ),
      ],
    );
    assert.match(html, /in production now and will arrive in about two weeks/);
    assert.doesNotMatch(html, /Old wait line/);
    assert.match(html, /data-astro-cid-abc123/);
    assert.match(html, /50 worldwide/);
    assert.match(html, /src="\/logo.png"/);
    assert.match(html, /height="1000"/);
  });

  it('updates a baked card that has no slug instead of duplicating it', () => {
    const html = fillShopInHtml(
      `<ul class="product-list">
        <li class="product">
          <img class="product-photo product-photo--crest" src="/logo.png" width="627" height="1000" alt="crest" />
          <h2 class="product-title">Woven crest patch</h2>
          <p class="product-blurb">Old wait line.</p>
        </li>
      </ul>`,
      [
        productFromMarkdown(
          'woven-crest-patch',
          `---
title: Woven crest patch
blurb: They are in production now.
limit: 50 worldwide
draft: false
---
`,
        ),
      ],
    );
    assert.match(html, /in production now/);
    assert.doesNotMatch(html, /Old wait line/);
    assert.equal((html.match(/class="product"/g) || []).length, 1);
    assert.match(html, /src="\/logo.png"/);
  });

  it('collapses a duplicated crest card back to one', () => {
    const html = fillShopInHtml(
      `<ul class="product-list">
        <li class="product"><img src="/logo.png" width="627" height="1000" alt="crest" /><h2 class="product-title">Woven crest patch</h2><p class="product-blurb">Old.</p></li>
        <li class="product" data-shop-slug="woven-crest-patch"><img src="/logo.png" /><h2 class="product-title">Woven crest patch</h2><p class="product-blurb">New.</p></li>
      </ul>`,
      [
        productFromMarkdown(
          'woven-crest-patch',
          `---
title: Woven crest patch
blurb: They are in production now.
draft: false
---
`,
        ),
      ],
    );
    assert.equal((html.match(/<li /g) || []).length, 1);
    assert.match(html, /in production now/);
    assert.match(html, /src="\/logo.png"/);
    assert.match(html, /height="1000"/);
  });
});

describe('shopSlugsFromHtml', () => {
  it('reads slugs already on the page', () => {
    assert.deepEqual(
      shopSlugsFromHtml('<li data-shop-slug="woven-crest-patch"></li>'),
      ['woven-crest-patch'],
    );
  });
});

describe('handleFreshShop', () => {
  it('fills /shop from GitHub when the baked HTML is behind', async () => {
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.includes('api.github.com')) {
        return new Response(
          JSON.stringify([{ name: 'woven-crest-patch.md', type: 'file' }]),
          { status: 200 },
        );
      }
      if (href.endsWith('woven-crest-patch.md')) {
        return new Response(
          `---
title: Woven crest patch
blurb: They are in production now and will arrive in about two weeks.
limit: 50 worldwide
mailSubject: Patch
draft: false
---
`,
          { status: 200 },
        );
      }
      return new Response('nope', { status: 404 });
    };

    const res = await handleFreshShop(new Request('https://thenewsoulsearchers.de/shop/'), {
      ASSETS: {
        fetch: async () =>
          new Response(
            '<ul class="product-list"><li class="product" data-shop-slug="woven-crest-patch"><img class="product-photo product-photo--crest" src="/logo.png" width="627" height="1000" alt="crest" /><p class="product-blurb">Old wait line.</p></li></ul>',
            { headers: { 'content-type': 'text/html' } },
          ),
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /in production now/);
    assert.doesNotMatch(body, /Old wait line/);
    assert.match(body, /src="\/logo.png"/);
    assert.match(body, /height="1000"/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});
