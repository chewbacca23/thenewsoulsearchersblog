import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const galleryItem = z.union([
  z.string(),
  z.object({ image: z.string().optional() }).transform((value) => value.image ?? ''),
]);

const journal = defineCollection({
  loader: glob({ base: './src/content/journal', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroLabel: z.string().optional(),
    cover: z.string().optional(),
    gallery: z.array(galleryItem).optional().default([]),
    draft: z.boolean().default(false),
  }).transform((data) => {
    const gallery = data.gallery.map((item) => item.trim()).filter(Boolean);
    const cover = (data.cover ?? '').trim() || gallery[0] || undefined;
    return { ...data, cover, gallery };
  }),
});

const stories = defineCollection({
  loader: glob({ base: './src/content/stories', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      title: z.string(),
      headline: z.string().optional().default(''),
      description: z.string().optional().default(''),
      // Optional: deleting a photo in the CMS must not fail the whole build.
      cover: z.string().optional(),
      gallery: z.array(galleryItem).optional().default([]),
      pubDate: z.preprocess((value) => {
        if (value instanceof Date || typeof value === 'string' || typeof value === 'number') {
          return value;
        }
        if (value && typeof value === 'object' && 'date' in value && typeof value.date === 'string') {
          return value.date;
        }
        return value;
      }, z.coerce.date()),
      order: z.number().optional().default(0),
      draft: z.boolean().default(false),
    })
    .transform((data) => {
      const gallery = data.gallery.map((item) => item.trim()).filter(Boolean);
      const cover = (data.cover ?? '').trim() || gallery[0] || undefined;
      return {
        ...data,
        headline: data.headline.trim() || data.title,
        description: data.description.trim() || data.title,
        cover,
        gallery,
      };
    }),
});

const shots = defineCollection({
  loader: glob({ base: './src/content/shots', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    photo: z.string(),
    caption: z.string().optional(),
    pubDate: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

const friends = defineCollection({
  loader: glob({ base: './src/content/friends', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    name: z.string(),
    url: z.string().optional().default(''),
    thanks: z.string().optional().default(''),
    logo: z.string().optional(),
    order: z.number().optional().default(0),
    draft: z.boolean().default(false),
  }).transform((data) => ({
    ...data,
    url: data.url.trim(),
    thanks: data.thanks.trim(),
  })),
});

const shop = defineCollection({
  loader: glob({ base: './src/content/shop', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      title: z.string(),
      blurb: z.string().optional().default(''),
      photo: z.string().optional(),
      limit: z.string().optional().default(''),
      mailSubject: z.string().optional().default('Shop'),
      order: z.number().optional().default(0),
      draft: z.boolean().default(false),
    })
    .transform((data) => ({
      ...data,
      blurb: data.blurb.trim(),
      limit: data.limit.trim(),
      mailSubject: data.mailSubject.trim() || 'Shop',
    })),
});

const STORE_PHOTO_MAX = 24;
const WEEK_PHOTO_MAX = 40;

const stores = defineCollection({
  loader: glob({ base: './src/content/stores', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      name: z.string(),
      city: z.string(),
      country: z.string(),
      note: z.string().optional().default(''),
      url: z.string().optional().default(''),
      /** @deprecated Prefer `photos`. Kept so older single-photo stores still build. */
      photo: z.string().optional(),
      photos: z.array(galleryItem).max(STORE_PHOTO_MAX).optional().default([]),
      /** Day you put it on the site — name stays red for 5 days. */
      posted: z.coerce.date().optional(),
      order: z.number().optional().default(0),
      draft: z.boolean().default(false),
    })
    .transform((data) => {
      const fromList = data.photos.map((item) => item.trim()).filter(Boolean);
      const cover = data.photo?.trim() ?? '';
      const merged =
        cover && !fromList.includes(cover)
          ? [cover, ...fromList]
          : fromList.length
            ? fromList
            : cover
              ? [cover]
              : [];
      const photos = merged.slice(0, STORE_PHOTO_MAX);
      return {
        ...data,
        city: data.city.trim(),
        country: data.country.trim(),
        note: data.note.trim(),
        url: data.url.trim(),
        photos,
        photo: photos[0],
      };
    }),
});

const week = defineCollection({
  loader: glob({ base: './src/content/week', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      title: z.string(),
      pubDate: z.coerce.date(),
      note: z.string().optional().default(''),
      photos: z.array(galleryItem).max(WEEK_PHOTO_MAX).optional().default([]),
      draft: z.boolean().default(false),
    })
    .transform((data) => ({
      ...data,
      note: data.note.trim(),
      photos: data.photos
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, WEEK_PHOTO_MAX),
    })),
});

const optionalCoord = z.preprocess((value) => {
  if (value === '' || value == null) return undefined;
  return value;
}, z.coerce.number().optional());

const stood = defineCollection({
  loader: glob({ base: './src/content/stood', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      place: z.string(),
      /** Optional — leave blank and the place name finds the pin. */
      lat: optionalCoord,
      lng: optionalCoord,
      note: z.string().optional().default(''),
      href: z.string().optional().default(''),
      stoodAt: z.coerce.date().optional(),
      order: z.number().optional().default(0),
      draft: z.boolean().default(false),
    })
    .transform((data) => ({
      ...data,
      place: data.place.trim(),
      note: data.note.trim(),
      href: data.href.trim(),
    })),
});

const calendar = defineCollection({
  loader: glob({ base: './src/content/calendar', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      title: z.string(),
      start: z.coerce.date(),
      end: z.coerce.date().optional(),
      /** Day you put it on the site — title stays red for 5 days. */
      posted: z.coerce.date().optional(),
      when: z.string().optional().default(''),
      kind: z.enum(['club', 'watch', 'open', 'other']).default('club'),
      host: z.string().optional().default(''),
      place: z.string().optional().default(''),
      url: z.string().optional().default(''),
      note: z.string().optional().default(''),
      draft: z.boolean().default(false),
    })
    .transform((data) => ({
      ...data,
      title: data.title.trim(),
      when: data.when.trim(),
      host: data.host.trim(),
      place: data.place.trim(),
      url: data.url.trim(),
      note: data.note.trim(),
    })),
});

/** Public wall of postcard sends. First name only. No emails. */
const postcardWall = defineCollection({
  loader: glob({ base: './src/content/postcard-wall', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      rideSlug: z.string(),
      rideTitle: z.string(),
      who: z.string().optional().default('A brother'),
      line: z.string().optional().default(''),
      sentAt: z.coerce.date(),
      draft: z.boolean().default(false),
    })
    .transform((data) => ({
      ...data,
      rideSlug: data.rideSlug.trim().replace(/^\/+|\/+$/g, ''),
      rideTitle: data.rideTitle.trim(),
      who: data.who.trim() || 'A brother',
      line: data.line.trim(),
    })),
});

export const collections = {
  journal,
  stories,
  shots,
  friends,
  shop,
  stores,
  week,
  stood,
  calendar,
  postcardWall,
};
