import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyPulseSection,
  fillPulseInHtml,
  isRoadish,
  parseRssItems,
  pickPulseItems,
  pulseBoardHtml,
  pulseMarkdown,
  pulseTeaseHtml,
  runPulseCron,
  stripHtml,
} from './thin-tires-pulse.js';

const sampleRss = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title><![CDATA[ Tour de France stage win for thin tires ]]></title>
  <link>https://www.cyclingnews.com/tour-de-france-stage/</link>
  <description><![CDATA[ A break sticks on the Col. ]]></description>
  <pubDate>Fri, 06 Nov 2026 12:00:00 +0000</pubDate>
  <enclosure url="https://cdn.example.com/tour.jpg" type="image/jpeg" />
</item>
<item>
  <title>New e-bike motor system announced</title>
  <link>https://escapecollective.com/e-bike-motor/</link>
  <description>Skip this one.</description>
  <pubDate>Fri, 06 Nov 2026 11:00:00 +0000</pubDate>
</item>
<item>
  <title>WorldTour transfer rumour</title>
  <link>https://www.cyclingweekly.com/transfer-rumour/</link>
  <description>Someone signs.</description>
  <pubDate>Fri, 06 Nov 2026 10:00:00 +0000</pubDate>
  <media:content url="https://cdn.example.com/transfer.jpg" />
</item>
<item>
  <title><![CDATA[ Demi Vollering aims at Tour de France Femmes again ]]></title>
  <link>https://www.cyclingnews.com/womens-vollering/</link>
  <category><![CDATA[Women's Cycling]]></category>
  <description>Defending the yellow jersey.</description>
  <pubDate>Fri, 06 Nov 2026 09:00:00 +0000</pubDate>
</item>
<item>
  <title>Mud and gaps at the Koppenbergcross</title>
  <link>https://escapecollective.com/koppenbergcross-report/</link>
  <description>Cyclo-cross world cup heat.</description>
  <pubDate>Fri, 06 Nov 2026 08:00:00 +0000</pubDate>
</item>
</channel></rss>`;

describe('parseRssItems', () => {
  it('reads title link image and skips markup', () => {
    const items = parseRssItems(sampleRss, 'Cyclingnews');
    assert.equal(items.length, 5);
    assert.equal(items[0].title, 'Tour de France stage win for thin tires');
    assert.equal(items[0].source, 'Cyclingnews');
    assert.match(items[0].image, /tour\.jpg/);
    assert.equal(items[2].image, 'https://cdn.example.com/transfer.jpg');
    assert.equal(stripHtml('<p>Hi &amp; ride</p>'), 'Hi & ride');
  });
});

describe('classifyPulseSection', () => {
  it('splits road men, road women, and cyclo-cross', () => {
    assert.equal(
      classifyPulseSection({
        title: 'Tour de France stage win',
        link: 'https://x.test/a',
      }),
      'road-men',
    );
    assert.equal(
      classifyPulseSection({
        title: 'Vollering eyes Tour de France Femmes',
        link: 'https://x.test/b',
        categories: ["Women's Cycling"],
      }),
      'road-women',
    );
    assert.equal(
      classifyPulseSection({
        title: 'Koppenbergcross world cup',
        link: 'https://x.test/c',
      }),
      'cyclo-cross',
    );
    assert.equal(
      classifyPulseSection({
        title: 'New e-bike motor',
        link: 'https://x.test/d',
      }),
      null,
    );
  });
});

describe('pickPulseItems', () => {
  it('keeps sectioned stories and skips e-bike noise', () => {
    const now = Date.parse('2026-11-06T18:00:00Z');
    const candidates = parseRssItems(sampleRss, 'Cyclingnews');
    const { added, items } = pickPulseItems(candidates, [], now);
    assert.ok(added.length >= 3);
    assert.ok(added.every((row) => isRoadish(row)));
    assert.ok(!items.some((row) => /e-bike/i.test(row.title)));
    assert.ok(items.some((row) => row.section === 'road-men'));
    assert.ok(items.some((row) => row.section === 'road-women'));
    assert.ok(items.some((row) => row.section === 'cyclo-cross'));
  });

  it('dedupes against what we already stored', () => {
    const now = Date.parse('2026-11-06T18:00:00Z');
    const candidates = parseRssItems(sampleRss, 'Cyclingnews');
    const existing = [
      {
        id: 'already',
        title: 'Tour de France stage win for thin tires',
        link: 'https://www.cyclingnews.com/tour-de-france-stage/',
        pubDate: '2026-11-06T12:00:00.000Z',
        section: 'road-men',
      },
    ];
    const { added } = pickPulseItems(candidates, existing, now);
    assert.ok(!added.some((row) => /tour-de-france-stage/.test(row.link)));
    assert.ok(added.some((row) => /womens-vollering|koppenbergcross|transfer-rumour/.test(row.link)));
  });
});

describe('pulse html', () => {
  it('renders section board and tease markers for Worker inject', () => {
    const items = [
      {
        title: 'A quiet breakaway',
        link: 'https://example.com/a',
        source: 'Cyclingnews',
        note: 'Two go clear.',
        image: 'https://cdn.example.com/a.jpg',
        pubDate: '2026-11-06T12:00:00.000Z',
        section: 'road-men',
      },
      {
        title: 'Women open the classics',
        link: 'https://example.com/b',
        source: 'Escape Collective',
        pubDate: '2026-11-06T11:00:00.000Z',
        section: 'road-women',
      },
    ];
    assert.match(pulseBoardHtml(items), /Road race — men/);
    assert.match(pulseBoardHtml(items), /Road race — women/);
    assert.match(pulseBoardHtml(items), /A quiet breakaway/);
    assert.match(pulseTeaseHtml(items), /pulse-tease-lane/);
    const filled = fillPulseInHtml(
      '<div data-pulse-board><p class="empty">x</p></div><ol data-pulse-tease><li class="empty">y</li></ol>',
      items,
    );
    assert.match(filled, /data-pulse-board/);
    assert.match(filled, /A quiet breakaway/);
    assert.match(filled, /data-pulse-tease/);
    assert.match(pulseMarkdown(items[0]), /section: road-men/);
  });
});

describe('runPulseCron', () => {
  it('writes KV from feeds without needing GitHub', async () => {
    const store = new Map();
    const env = {
      STATS: {
        async get(key, type) {
          const raw = store.get(key);
          if (raw == null) return null;
          return type === 'json' ? JSON.parse(raw) : raw;
        },
        async put(key, value) {
          store.set(key, value);
        },
      },
    };
    const result = await runPulseCron(env, {
      fetchXml: async () => sampleRss,
    });
    assert.ok(result.added >= 3);
    assert.ok(result.total >= 3);
    const saved = JSON.parse(store.get('pulse:v1'));
    assert.ok(saved.items.length >= 3);
  });
});
