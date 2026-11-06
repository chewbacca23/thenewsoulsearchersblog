import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fillPulseInHtml,
  isRoadish,
  parseRssItems,
  pickPulseItems,
  pulseListHtml,
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
</channel></rss>`;

describe('parseRssItems', () => {
  it('reads title link image and skips markup', () => {
    const items = parseRssItems(sampleRss, 'Cyclingnews');
    assert.equal(items.length, 3);
    assert.equal(items[0].title, 'Tour de France stage win for thin tires');
    assert.equal(items[0].source, 'Cyclingnews');
    assert.match(items[0].image, /tour\.jpg/);
    assert.equal(items[2].image, 'https://cdn.example.com/transfer.jpg');
    assert.equal(stripHtml('<p>Hi &amp; ride</p>'), 'Hi & ride');
  });
});

describe('pickPulseItems', () => {
  it('keeps road stories and skips e-bike noise', () => {
    const now = Date.parse('2026-11-06T18:00:00Z');
    const candidates = parseRssItems(sampleRss, 'Cyclingnews');
    const { added, items } = pickPulseItems(candidates, [], now);
    assert.equal(added.length, 2);
    assert.ok(added.every((row) => isRoadish(row)));
    assert.ok(!items.some((row) => /e-bike/i.test(row.title)));
    assert.equal(items[0].link, 'https://www.cyclingnews.com/tour-de-france-stage/');
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
      },
    ];
    const { added } = pickPulseItems(candidates, existing, now);
    assert.equal(added.length, 1);
    assert.match(added[0].link, /transfer-rumour/);
  });
});

describe('pulse html', () => {
  it('renders list and tease markers for Worker inject', () => {
    const items = [
      {
        title: 'A quiet breakaway',
        link: 'https://example.com/a',
        source: 'Cyclingnews',
        note: 'Two go clear.',
        image: 'https://cdn.example.com/a.jpg',
        pubDate: '2026-11-06T12:00:00.000Z',
      },
    ];
    assert.match(pulseListHtml(items), /pulse-item/);
    assert.match(pulseListHtml(items), /A quiet breakaway/);
    assert.match(pulseTeaseHtml(items), /pulse-tease-item/);
    const filled = fillPulseInHtml(
      '<ol data-pulse-list><li class="empty">x</li></ol><ol data-pulse-tease><li class="empty">y</li></ol>',
      items,
    );
    assert.match(filled, /data-pulse-list/);
    assert.match(filled, /A quiet breakaway/);
    assert.match(filled, /data-pulse-tease/);
    assert.match(pulseMarkdown(items[0]), /title: "A quiet breakaway"/);
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
    assert.equal(result.added, 2);
    assert.ok(result.total >= 2);
    const saved = JSON.parse(store.get('pulse:v1'));
    assert.equal(saved.items.length, 2);
  });
});
