/**
 * Publish writes to GitHub immediately. The public Worker often keeps serving
 * the last successful Astro build, so a new ride looks empty (no story, no
 * photos) until Cloudflare rebuilds. When that static page is behind GitHub,
 * render the ride from the markdown on main, and fetch missing photos from
 * the same repo.
 */

import { planRidePhotos, safePhotoSrc } from './story-photos.js';

const REPO = 'chewbacca23/thenewsoulsearchersblog';
const BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const SAFE_FILE = /^[A-Za-z0-9._@ ()+-]+$/;
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/i;

export function storyImageName(pathname) {
  const match = String(pathname || '').match(/^\/stories\/([^/]+)$/);
  if (!match) return '';
  let name = match[1];
  try {
    name = decodeURIComponent(name);
  } catch {
    return '';
  }
  if (!IMAGE_EXT.test(name) || !SAFE_FILE.test(name) || name.includes('..')) return '';
  return name;
}

export function storySlug(pathname) {
  const match = String(pathname || '').match(/^\/stories\/([^/]+)$/);
  if (!match) return '';
  const slug = match[1];
  if (IMAGE_EXT.test(slug) || !SAFE_SLUG.test(slug)) return '';
  return slug;
}

export function journalSlug(pathname) {
  const match = String(pathname || '').match(/^\/journal\/([^/]+)$/);
  if (!match) return '';
  const slug = match[1];
  if (IMAGE_EXT.test(slug) || !SAFE_SLUG.test(slug)) return '';
  return slug;
}

export function unquote(value) {
  const text = String(value ?? '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  return text;
}

export function parseSimpleYaml(yaml) {
  const data = {};
  const lines = String(yaml || '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const keyed = lines[i].match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!keyed) {
      i += 1;
      continue;
    }
    const key = keyed[1];
    const rest = keyed[2];
    if (rest === '' && i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
      const items = [];
      i += 1;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s+-\s+/, '');
        const asField = item.match(/^image:\s*(.*)$/);
        if (asField) {
          items.push({ image: unquote(asField[1]) });
        } else if (item === '' && i + 1 < lines.length && /^\s+image:\s*/.test(lines[i + 1])) {
          i += 1;
          const nested = lines[i].match(/image:\s*(.*)$/);
          items.push({ image: unquote(nested?.[1] || '') });
        } else {
          items.push(unquote(item));
        }
        i += 1;
      }
      data[key] = items;
      continue;
    }
    if (/^[>|][+-]?\s*$/.test(rest)) {
      const fold = rest.startsWith('>');
      const block = [];
      i += 1;
      let indent = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '') {
          block.push('');
          i += 1;
          continue;
        }
        const lead = line.match(/^( +)/);
        if (!lead) break;
        if (!indent) indent = lead[1].length;
        if (lead[1].length < indent) break;
        block.push(line.slice(indent));
        i += 1;
      }
      while (block.length && block[block.length - 1] === '') block.pop();
      if (fold) {
        const paragraphs = [];
        let current = [];
        for (const line of block) {
          if (line === '') {
            if (current.length) paragraphs.push(current.join(' '));
            current = [];
          } else {
            current.push(line.trim());
          }
        }
        if (current.length) paragraphs.push(current.join(' '));
        data[key] = paragraphs.join('\n\n');
      } else {
        data[key] = block.join('\n');
      }
      continue;
    }
    if (rest === '[]') data[key] = [];
    else if (rest === 'true' || rest === 'false') data[key] = rest === 'true';
    else if (/^-?\d+$/.test(rest)) data[key] = Number(rest);
    else {
      const parts = [unquote(rest)];
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].trim() === '') {
          let k = j + 1;
          while (k < lines.length && lines[k].trim() === '') k += 1;
          if (k < lines.length && /^ +\S/.test(lines[k])) {
            parts.push('\n');
            j = k;
            continue;
          }
          break;
        }
        if (/^ +\S/.test(lines[j])) {
          parts.push(lines[j].trim());
          j += 1;
          continue;
        }
        break;
      }
      let text = '';
      for (const part of parts) {
        if (part === '\n') text += '\n\n';
        else text += (text && !text.endsWith('\n') ? ' ' : '') + part;
      }
      data[key] = text.replace(/[ \t]+/g, ' ').replace(/ *\n\n */g, '\n\n').trim();
      i = j;
      continue;
    }
    i += 1;
  }
  return data;
}

export function parseMarkdownFile(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: text.trim() };
  return { data: parseSimpleYaml(match[1]), body: match[2].replace(/^\r?\n/, '') };
}

export function galleryPaths(cover, gallery) {
  const items = [];
  if (typeof cover === 'string' && cover.trim()) items.push(cover.trim());
  const list = Array.isArray(gallery) ? gallery : [];
  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) items.push(entry.trim());
    else if (entry && typeof entry.image === 'string' && entry.image.trim()) {
      items.push(entry.image.trim());
    }
  }
  const seen = new Set();
  const unique = [];
  for (const path of items) {
    if (seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  return unique;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function renderImage(alt, src) {
  const photo = safePhotoSrc(src);
  if (!photo) return '';
  return `<figure><img src="${escapeHtml(photo)}" alt="${escapeHtml(alt)}" width="1200" height="900" loading="lazy" /></figure>`;
}

function renderList(lines, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  const items = lines
    .map((line) => line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''))
    .map((line) => `<li>${inlineMarkdown(line)}</li>`)
    .join('');
  return `<${tag}>${items}</${tag}>`;
}

export function renderMarkdown(markdown) {
  const source = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!source) return '';
  return source
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (trimmed.startsWith('![')) {
        const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
        if (!image) return '';
        const src = image[2].trim().replace(/\s+"[^"]*"\s*$/, '');
        return renderImage(image[1], src);
      }

      const lines = block.split('\n').filter((line) => line.trim() !== '');
      const first = lines[0] || '';
      const rest = lines.slice(1).map((line) => inlineMarkdown(line)).join('<br />');
      if (first.startsWith('### ')) {
        return `<h3>${inlineMarkdown(first.slice(4))}</h3>${rest ? `<p>${rest}</p>` : ''}`;
      }
      if (first.startsWith('## ')) {
        return `<h2>${inlineMarkdown(first.slice(3))}</h2>${rest ? `<p>${rest}</p>` : ''}`;
      }
      if (first.startsWith('# ')) {
        return `<h1>${inlineMarkdown(first.slice(2))}</h1>${rest ? `<p>${rest}</p>` : ''}`;
      }
      if (lines.length && lines.every((line) => /^\d+\.\s+/.test(line))) {
        return renderList(lines, true);
      }
      if (lines.length && lines.every((line) => /^[-*]\s+/.test(line))) {
        return renderList(lines, false);
      }
      return `<p>${lines.map((line) => inlineMarkdown(line)).join('<br />')}</p>`;
    })
    .join('\n');
}

export function staticLooksBehind(html, { body = '', photos = [] } = {}) {
  if (!html) return true;
  const text = String(html).replace(/<script[\s\S]*?<\/script>/gi, '');
  const story = String(body || '').trim();
  if (story.length >= 40) {
    const words = story
      .replace(/\s+/g, ' ')
      .split(' ')
      .map((word) => word.replace(/[^A-Za-zÀ-ÿ'-]/g, ''))
      .filter((word) => word.length > 4)
      .slice(0, 4);
    if (words.length && !words.some((word) => text.includes(word))) return true;
  }
  if (photos.length && !photos.some((photo) => text.includes(photo))) return true;
  return false;
}

export function githubRawPhoto(name) {
  return `${RAW}/public/stories/${encodeURIComponent(name)}`;
}

export function githubRawRide(slug) {
  return `${RAW}/src/content/stories/${encodeURIComponent(slug)}.md`;
}

export function githubRawNote(slug) {
  return `${RAW}/src/content/journal/${encodeURIComponent(slug)}.md`;
}

export function renderRidePage({ slug, data = {}, body = '', kind = 'ride' } = {}) {
  const title = data.headline || data.title || slug;
  const description = data.description || title;
  const photos = galleryPaths(data.cover, data.gallery);
  const plan = planRidePhotos(photos, body, data.cover);
  const hero = plan.hero
    ? `<figure class="hero"><img src="${escapeHtml(plan.hero)}" alt="" width="1200" height="900" loading="eager" /></figure>`
    : '';
  const story = renderMarkdown(plan.wovenBody);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · The Soul Searchers</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="icon" type="image/png" href="/logo.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap" rel="stylesheet" />
  <style>
    :root { --ink:#0c1218; --fog:#d7e0e8; --paper:#eef3f7; --amber-hot:#f0c27a; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:var(--fog); background:var(--ink);
      font-family: Figtree, "Avenir Next", "Segoe UI", sans-serif; font-size:1.0625rem; line-height:1.65; }
    a { color: inherit; }
    a:hover { color: var(--amber-hot); }
    .site-shell { width: min(72rem, calc(100% - 2rem)); margin: 0 auto; }
    header { position: sticky; top: 0; border-bottom: 1px solid rgba(215,224,232,.06);
      background: rgba(10,14,20,.65); backdrop-filter: blur(16px); }
    .header-inner { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.85rem 0; }
    .brand { display:flex; align-items:center; gap:.65rem; text-decoration:none; font-weight:600; }
    .brand img { width:2rem; height:auto; }
    nav { display:flex; flex-wrap:wrap; gap:.85rem 1.1rem; font-size:.92rem; }
    main { padding: 2.5rem 0 4rem; }
    article { max-width: 52rem; }
    .eyebrow { margin:0 0 .4rem; letter-spacing:.08em; text-transform:uppercase; font-size:.78rem; color:rgba(215,224,232,.55); }
    h1 { margin:0 0 .75rem; font-family: Fraunces, Georgia, serif; font-size: clamp(2rem, 4.5vw, 3.1rem); color:var(--paper); }
    .dek { margin:0 0 1.75rem; color:rgba(215,224,232,.75); font-size:1.1rem; }
    .hero { margin:0 0 2rem; }
    figure { margin:0; overflow:hidden; border-radius:.9rem; box-shadow:0 18px 40px rgba(0,0,0,.25); }
    figure img { width:100%; height:auto; display:block; }
    .prose { max-width: 42rem; }
    .prose h2 { margin:2.2rem 0 .8rem; font-size:1.55rem; }
    .prose p { margin:0 0 1rem; }
    .prose figure {
      float: right;
      clear: right;
      width: min(38%, 12rem);
      margin: .15rem 0 1rem 1.15rem;
      border-radius: .7rem;
      box-shadow: 0 14px 32px rgba(0,0,0,.28);
    }
    .prose figure img { aspect-ratio: 4 / 5; object-fit: cover; }
    .prose::after { content: ''; display: table; clear: both; }
    .prose ol, .prose ul { padding-left:1.2rem; }
    .back { margin-top:2.75rem; }
    .back a { color:var(--amber-hot); text-decoration:none; font-weight:600; }
    @media (max-width: 640px) {
      .prose figure { float: none; width: min(100%, 16rem); margin: .85rem auto 1.15rem; }
      .prose figure img { aspect-ratio: 4 / 3; }
    }
  </style>
</head>
<body>
  <header>
    <div class="site-shell header-inner">
      <a class="brand" href="/"><img src="/logo.png" alt="" width="40" height="51" /><span>The Soul Searchers</span></a>
      <nav aria-label="Primary">
        <a href="/">Home</a>
        <a href="/stories">Rides</a>
        <a href="/about">About</a>
      </nav>
    </div>
  </header>
  <main>
    <article class="site-shell">
      <p class="eyebrow">${kind === 'note' ? 'Ride note' : 'Ride'}</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="dek">${escapeHtml(description)}</p>
      ${hero}
      <div class="prose">${story}</div>
      <p class="back"><a href="${kind === 'note' ? '/journal' : '/stories'}">${kind === 'note' ? '← All ride notes' : '← All rides'}</a></p>
    </article>
  </main>
  <script>
    (function () {
      var path = location.pathname || '/';
      if (path.indexOf('/admin') === 0) return;
      var body = JSON.stringify({ path: path });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/looks', new Blob([body], { type: 'application/json' }));
      }
    })();
  </script>
</body>
</html>`;
}

async function readAsset(env, request) {
  if (!env?.ASSETS?.fetch) return null;
  try {
    return await env.ASSETS.fetch(request);
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'soul-searchers-worker' },
  });
  if (!response.ok) return '';
  return response.text();
}

export async function handleFreshRide(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const image = storyImageName(url.pathname);
  if (image) {
    const asset = await readAsset(env, request);
    if (asset?.ok) return asset;
    try {
      const raw = await fetch(githubRawPhoto(image), {
        headers: { 'user-agent': 'soul-searchers-worker' },
      });
      if (raw.ok) {
        return new Response(raw.body, {
          status: 200,
          headers: {
            'content-type': raw.headers.get('content-type') || 'image/jpeg',
            'cache-control': 'public, max-age=300',
          },
        });
      }
    } catch {
      // GitHub raw is a fallback. A missing photo should still 404.
    }
    return asset;
  }

  const rideSlug = storySlug(url.pathname);
  const noteSlug = journalSlug(url.pathname);
  const slug = rideSlug || noteSlug;
  if (!slug) return null;
  const kind = noteSlug ? 'note' : 'ride';

  let markdown = '';
  try {
    markdown = await fetchText(kind === 'note' ? githubRawNote(slug) : githubRawRide(slug));
  } catch {
    markdown = '';
  }
  if (!markdown) return null;

  const parsed = parseMarkdownFile(markdown);
  if (parsed.data.draft === true) return null;

  const photos = galleryPaths(parsed.data.cover, parsed.data.gallery);
  const asset = await readAsset(env, request);
  if (asset?.ok) {
    const html = await asset.text();
    if (!staticLooksBehind(html, { body: parsed.body, photos })) {
      return new Response(html, {
        status: asset.status,
        headers: {
          'content-type': asset.headers.get('content-type') || 'text/html; charset=utf-8',
        },
      });
    }
  }

  const page = renderRidePage({ slug, data: parsed.data, body: parsed.body, kind });
  return new Response(page, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
}
