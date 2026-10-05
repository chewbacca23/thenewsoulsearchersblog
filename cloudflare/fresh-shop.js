/**
 * Shop Save writes GitHub immediately. /shop is a baked Astro page, so the
 * Worker paints the products from main until Cloudflare rebuilds.
 */

import { escapeHtml, parseMarkdownFile } from './fresh-ride.js';

const REPO = 'chewbacca23/thenewsoulsearchersblog';
const BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/src/content/shop`;
const LIST = `https://api.github.com/repos/${REPO}/contents/src/content/shop?ref=${BRANCH}`;
const SHOP_MAIL = 'henrik@thenewsoulsearchers.de';
const CREST = '/logo.png';
const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

export function isShopPath(pathname) {
  return pathname === '/shop' || pathname === '/shop/';
}

export function shopSlugsFromHtml(html) {
  return [...String(html || '').matchAll(/data-shop-slug="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((slug) => SAFE_SLUG.test(slug));
}

function shopCid(html) {
  const list = String(html || '').match(/<ul[^>]*product-list[^>]*>/);
  const match = (list?.[0] || '').match(/data-astro-cid-[a-z0-9]+/);
  return match ? match[0] : '';
}

function open(tag, cid) {
  if (!cid) return `<${tag}`;
  return `<${tag} ${cid}`;
}

export function sortShopProducts(products) {
  return [...products].sort((a, b) => {
    const orderA = Number.isFinite(a.order) ? a.order : 0;
    const orderB = Number.isFinite(b.order) ? b.order : 0;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

export function productFromMarkdown(slug, raw) {
  const parsed = parseMarkdownFile(raw);
  if (parsed.data.draft === true) return null;
  const title = String(parsed.data.title || '').trim();
  if (!title) return null;
  const photo = String(parsed.data.photo || '').trim();
  return {
    slug,
    title,
    blurb: String(parsed.data.blurb || '').trim(),
    photo,
    limit: String(parsed.data.limit || '').trim(),
    mailSubject: String(parsed.data.mailSubject || 'Shop').trim() || 'Shop',
    order: Number.isFinite(parsed.data.order) ? parsed.data.order : 0,
  };
}

export function renderShopItems(products, cid = '') {
  return products
    .map((product) => {
      const usingCrest = !product.photo;
      const image = usingCrest ? CREST : product.photo;
      const mailto = `mailto:${SHOP_MAIL}?subject=${encodeURIComponent(product.mailSubject)}`;
      const photoClass = usingCrest ? 'product-photo product-photo--crest' : 'product-photo';
      const limit = product.limit
        ? `${open('p', cid)} class="product-limit">${escapeHtml(product.limit)}</p>`
        : '';
      const blurb = product.blurb
        ? `${open('p', cid)} class="product-blurb">${escapeHtml(product.blurb).replace(/\n/g, '<br />')}</p>`
        : '';
      return `${open('li', cid)} class="product" data-shop-slug="${escapeHtml(product.slug)}">
                  ${open('img', cid)}
                    class="${photoClass}"
                    src="${escapeHtml(image)}"
                    alt="${escapeHtml(usingCrest ? 'The Soul Searchers crest' : product.title)}"
                    width="627"
                    height="1000"
                    loading="lazy"
                    decoding="async"
                  />
                  ${open('div', cid)} class="product-copy">
                    ${open('h2', cid)} class="product-title">${escapeHtml(product.title)}</h2>
                    ${limit}
                    ${blurb}
                    ${open('div', cid)} class="cta-row">
                      ${open('a', cid)} class="btn btn-primary" href="${escapeHtml(mailto)}">
                        Email Henrik
                      </a>
                      ${open('a', cid)} class="btn btn-ghost" href="mailto:${SHOP_MAIL}">
                        ${SHOP_MAIL}
                      </a>
                    </div>
                  </div>
                </li>`;
    })
    .join('');
}

function replaceShopField(inner, className, value, tag = 'p') {
  const re = new RegExp(
    `(<${tag}[^>]*class="[^"]*${className}[^"]*"[^>]*)>([\\s\\S]*?)(</${tag}>)`,
  );
  if (!value) return inner.replace(re, '');
  if (re.test(inner)) return inner.replace(re, `$1>${value}$3`);
  return inner.replace(
    /(<\/h2>)/,
    `$1\n                    <${tag} class="${className}">${value}</${tag}>`,
  );
}

export function fillShopInHtml(html, products) {
  let source = String(html || '');
  if (!products.length) return source;

  if (products.length === 1) {
    const lis = source.match(/<li\b[^>]*class="[^"]*\bproduct\b[^"]*"[^>]*>[\s\S]*?<\/li>/g) || [];
    if (lis.length >= 1) {
      const painted = paintProductLi(lis[0], /^(<li\b[^>]*>)([\s\S]*)(<\/li>)$/, products[0]);
      if (/<ul[^>]*product-list/.test(source)) {
        return source.replace(/(<ul[^>]*product-list[^>]*>)([\s\S]*?)(<\/ul>)/, `$1${painted}$3`);
      }
    }
  }

  const missing = [];
  for (const product of products) {
    const slug = product.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const liRe = new RegExp(`(<li[^>]*data-shop-slug="${slug}"[^>]*>)([\\s\\S]*?)(<\/li>)`);
    if (!liRe.test(source)) {
      missing.push(product);
      continue;
    }
    source = paintProductLi(source, liRe, product);
  }
  if (missing.length === 1) {
    const lone = new RegExp(
      `(<li(?![^>]*data-shop-slug=)[^>]*class="[^"]*\\bproduct\\b[^"]*"[^>]*>)([\\s\\S]*?)(</li>)`,
    );
    if (lone.test(source)) {
      source = paintProductLi(source, lone, missing[0]);
      missing.shift();
    }
  }
  if (missing.length) {
    const items = renderShopItems(missing, shopCid(source));
    if (/<ul[^>]*product-list/.test(source)) {
      source = source.replace(/(<ul[^>]*product-list[^>]*>)([\s\S]*?)(<\/ul>)/, `$1$2${items}$3`);
    } else if (/class="[^"]*empty[^"]*"/.test(source)) {
      source = source.replace(
        /<p([^>]*class="[^"]*empty[^"]*"[^>]*)>[\s\S]*?<\/p>/,
        `<ul class="product-list">${items}</ul>`,
      );
    }
  }
  return source;
}

function paintProductLi(source, liRe, product) {
  const blurb = product.blurb
    ? escapeHtml(product.blurb).replace(/\n/g, '<br />')
    : '';
  return source.replace(liRe, (_, open, inner, close) => {
    inner = inner.replace(
      /(<h2[^>]*class="[^"]*product-title[^"]*"[^>]*>)[\s\S]*?(<\/h2>)/,
      `$1${escapeHtml(product.title)}$2`,
    );
    inner = replaceShopField(inner, 'product-limit', product.limit ? escapeHtml(product.limit) : '');
    inner = replaceShopField(inner, 'product-blurb', blurb);
    return `${open}${inner}${close}`;
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'soul-searchers-worker' },
  });
  if (!response.ok) return '';
  return response.text();
}

export async function listShopSlugs(html = '') {
  const fromPage = shopSlugsFromHtml(html);
  try {
    const response = await fetch(LIST, {
      headers: {
        'user-agent': 'soul-searchers-worker',
        accept: 'application/vnd.github+json',
      },
    });
    if (response.ok) {
      const items = await response.json();
      if (Array.isArray(items)) {
        const listed = items
          .filter((item) => item && item.type === 'file' && /\.md$/i.test(item.name || ''))
          .map((item) => String(item.name).replace(/\.md$/i, ''))
          .filter((slug) => SAFE_SLUG.test(slug));
        if (listed.length) return listed;
      }
    }
  } catch {
    // Raw files below still work for products already on the page.
  }
  const fallback = ['woven-crest-patch', ...fromPage];
  return [...new Set(fallback)].filter((slug) => SAFE_SLUG.test(slug));
}

export async function loadShopProducts(html = '') {
  const slugs = await listShopSlugs(html);
  const products = [];
  for (const slug of slugs) {
    try {
      const raw = await fetchText(`${RAW}/${encodeURIComponent(slug)}.md`);
      const product = raw ? productFromMarkdown(slug, raw) : null;
      if (product) products.push(product);
    } catch {
      // Skip a missing file and keep the rest.
    }
  }
  return sortShopProducts(products);
}

export async function handleFreshShop(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (!isShopPath(url.pathname)) return null;
  if (!env?.ASSETS?.fetch) return null;

  const asset = await env.ASSETS.fetch(request);
  if (!asset?.ok) return asset;
  const type = asset.headers.get('content-type') || '';
  if (type && !type.includes('html') && !type.includes('text')) return asset;

  const html = await asset.text();
  let products = [];
  try {
    products = await loadShopProducts(html);
  } catch {
    products = [];
  }
  if (!products.length) {
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': asset.headers.get('content-type') || 'text/html; charset=utf-8',
      },
    });
  }

  const filled = fillShopInHtml(html, products);
  const headers = new Headers(asset.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(filled, { status: 200, headers });
}
