export const site = {
  name: 'The Soul Searchers',
  /** Visual lockup on the hero, header, and footer. */
  mark: 'theSOULSEARCHERS',
  shortName: 'Soul Searchers',
  tagline: 'A cycling blog. Tours and travel by bike.',
  description:
    'The Soul Searchers is a cycling blog: rides, café stops, and seeing this planet from the saddle.',
  url: 'https://thenewsoulsearchers.de',
  email: 'hello@thenewsoulsearchers.de',
  locale: 'en',
  /** Public hosts that serve this same Worker (.de stays canonical for SEO / admin). */
  domains: [
    'thenewsoulsearchers.de',
    'www.thenewsoulsearchers.de',
    'thenewsoulsearchers.com',
    'www.thenewsoulsearchers.com',
  ],

  /** Crest PNG — lighter on the wire than the old base64-wrapped SVG. */
  logo: '/logo.png',
  /**
   * Soft, pre-blurred crest for the page backdrop only.
   * Header / favicon keep the sharp `logo` above.
   */
  logoWatermark: '/logo-watermark.png',
  /** Large faint mark behind pages (0 = off, 0.04–0.12 = subtle) */
  logoWatermarkOpacity: 0.11,
  /** Extra CSS blur on top of the soft PNG (hides chat-PNG pixel edges) */
  logoWatermarkBlur: '2px',

  /** Impressum defaults. Henrik fills the real lines in the editor (Site → Mail and imprint). */
  imprint: {
    legalName: 'The Soul Searchers',
    responsible: 'Henrik Kürschner',
    street: '',
    zipCity: '',
    country: 'Germany',
    phone: '',
    email: 'hello@thenewsoulsearchers.de',
  },
};
