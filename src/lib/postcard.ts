/** How many pictures a postcard will carry from one ride. */
export const POSTCARD_PHOTO_MAX = 20;

/**
 * A short piece of the ride, in the ride's own words.
 * Headings and photo markdown come off. Paragraphs stay.
 */
export function rideWords(text: string | null | undefined, max = 900): string {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .trim();

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  let out = '';
  for (const paragraph of paragraphs) {
    const next = out ? `${out}\n\n${paragraph}` : paragraph;
    if (out && next.length > max) break;
    out = next;
    if (out.length >= max) break;
  }
  return out.slice(0, max).trim();
}

/** Mail that carries the ride and the postcard link. The recipient picks who it goes to. */
export function postcardMail(options: { title: string; words: string; url: string }): string {
  const title = options.title.trim() || 'the ride';
  const first =
    options.words
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) || title;
  const body = [
    first,
    '',
    'The pictures are here, and the crest is on every one:',
    options.url,
    '',
    'The Soul Searchers',
  ].join('\n');
  return `mailto:?subject=${encodeURIComponent(`A postcard from ${title}`)}&body=${encodeURIComponent(body)}`;
}
