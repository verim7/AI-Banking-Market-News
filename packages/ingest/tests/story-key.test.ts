import { describe, expect, it } from 'vitest';
import { matchTerms, NAMED_INSTITUTIONS } from '@portal/shared';
import { dedupe, distinctiveNumber, storyKeys, weekOf } from '../src/normalize.ts';
import { dropChrome } from '../src/fetch-article.ts';
import { cluster, markStatements } from '../src/dedupe-stories.ts';

/**
 * The eight rows one DBS rollout actually produced, verbatim from the corpus.
 * Written out rather than paraphrased: the whole difficulty is how differently
 * eight newsrooms word the same fact, and a paraphrase would hide it.
 */
const DBS_ROLLOUT = [
  'DBS rolls out agentic AI for 1,500 bankers to draft credit memos',
  "Singapore's DBS deploys specialist AI agents for 1,500 employees",
  'DBS Deploys Agentic AI to Automate Credit Assessments for 1,500 Corporate Bankers',
  'DBS rolls out agentic AI for corporate credit assessments',
  'DBS rolls out agentic AI credit tool to 1,500 staff globally',
  "DBS Rolls Out Agentic AI to 1'500 Bankers",
];

const keys = (title: string, when: string | null, process: string | null = null) =>
  storyKeys(title, when, matchTerms(title, NAMED_INSTITUTIONS), process);

describe('one story, many outlets', () => {
  const WEEK = '2026-08-20T00:00:00Z';

  it('gives every re-report of the DBS rollout a shared key', () => {
    const withProcess = DBS_ROLLOUT.map((t) => keys(t, WEEK, 'p13_lending_credit_solutions'));
    for (const k of withProcess) expect(k.length).toBeGreaterThan(0);
    // Every one of the eight shares at least one key with the first.
    const first = new Set(withProcess[0]);
    for (const [i, k] of withProcess.entries()) {
      expect(k.some((x) => first.has(x)), DBS_ROLLOUT[i]).toBe(true);
    }
  });

  it('needs the process key for the headline with no figure', () => {
    // Five of the eight carry "1,500" and collapse on the number alone. The
    // sixth does not, and was the row that survived when the number was the
    // only key — which is why there are two.
    const noNumber = 'DBS rolls out agentic AI for corporate credit assessments';
    expect(keys(noNumber, WEEK)).toEqual([]);
    expect(keys(noNumber, WEEK, 'p13_lending_credit_solutions')).toHaveLength(1);
  });

  it('keeps a different story about the same bank in the same week apart', () => {
    const reskill = keys('DBS Reskills 11,000 Staff as AI Reshapes Banking Jobs', WEEK,
                         'p38_workforce_skills_talent');
    const rollout = keys(DBS_ROLLOUT[0]!, WEEK, 'p13_lending_credit_solutions');
    expect(reskill.some((k) => rollout.includes(k))).toBe(false);
  });

  it('reads the same figure however the outlet punctuates it', () => {
    expect(distinctiveNumber("1'500 bankers")).toBe(1500);
    expect(distinctiveNumber('1,500 bankers')).toBe(1500);
    expect(distinctiveNumber('1.500 Banker')).toBe(1500);
  });

  it('ignores figures that are not distinctive', () => {
    // A year would merge every article published that year.
    expect(distinctiveNumber('AI in banking in 2026')).toBeNull();
    expect(distinctiveNumber('6 machine learning use cases')).toBeNull();
  });

  it('refuses to key an article it cannot identify', () => {
    // No institution, no key — under-merging leaves a visible duplicate,
    // over-merging hides a real story.
    expect(keys('Agentic AI and its future in fintech', WEEK, 'p35_technology_platform_engineering'))
      .toEqual([]);
    expect(keys(DBS_ROLLOUT[0]!, null, 'p13_lending_credit_solutions')).toEqual([]);
  });

  it('weeks follow the ISO rule', () => {
    expect(weekOf('2026-08-20T00:00:00Z')).toBe('2026-W34');
    // Sunday belongs to the week that began on the preceding Monday.
    expect(weekOf('2026-08-23T00:00:00Z')).toBe('2026-W34');
    expect(weekOf('2026-08-24T00:00:00Z')).toBe('2026-W35');
  });
});

describe('dedupe collapses the re-reports', () => {
  const article = (title: string, i: number) => ({
    id: `a${i}`, title, urlCanonical: `https://example.com/${i}`,
    urlOriginal: `https://example.com/${i}`, summary: null, excerpt: null,
    sourceId: 's', sourceName: 'S', publisherHost: null, publisherKind: 'media' as const,
    language: null, publishedAt: '2026-08-20T00:00:00Z',
  });

  it('keeps one row where the corpus had eight', () => {
    const rows = DBS_ROLLOUT.map(article);
    const kept = dedupe(rows, { processOf: () => 'p13_lending_credit_solutions' });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.title).toBe(DBS_ROLLOUT[0]);
  });

  it('collapses against stories already in the database', () => {
    const kept = dedupe(DBS_ROLLOUT.map(article), {
      processOf: () => 'p13_lending_credit_solutions',
      knownStoryKeys: new Set(['dbs|2026-W34|n1500', 'dbs|2026-W34|p13_lending_credit_solutions']),
    });
    expect(kept).toHaveLength(0);
  });

  it('leaves unrelated articles alone', () => {
    const rows = [
      article('DBS rolls out agentic AI credit tool to 1,500 staff globally', 1),
      article('HSBC scales machine learning fraud detection bank-wide', 2),
    ];
    expect(dedupe(rows, { processOf: () => null })).toHaveLength(2);
  });
});

describe('navigation is not article text', () => {
  it('drops the menu a real capture began with', () => {
    const captured = 'Skip to content YOU ARE AT: Home » ADIB appoints Chief AI officer. '
      + 'Facebook. Twitter. LinkedIn. '
      + 'Abu Dhabi Islamic Bank has appointed a Chief AI Officer, strengthening the '
      + "bank's leadership as it advances its Vision 2035 strategy.";
    const out = dropChrome(captured);
    expect(out).not.toContain('Skip to content');
    expect(out).not.toContain('YOU ARE AT');
    expect(out).toContain('Abu Dhabi Islamic Bank has appointed');
  });

  it('drops a section menu rendered as one-word sentences', () => {
    const captured = '. Home . Finance . People . Fintech . High-End . finews first . '
      + 'EAM/MFO . Real Assets . Advertorials . About . Advertise . Newsletter . Search. '
      + 'DBS has launched a new in-house career advisory service for its employees.';
    expect(dropChrome(captured)).toBe(
      'DBS has launched a new in-house career advisory service for its employees.');
  });

  it('removes HTML attribute residue', () => {
    const captured = 'PDF. " onclick="window.open(this.href,\'win2\')" rel="nofollow"> . '
      + 'The bank has deployed machine learning models for transaction monitoring.';
    const out = dropChrome(captured);
    expect(out).not.toContain('onclick');
    expect(out).toContain('deployed machine learning models');
  });

  it('returns the text unchanged when it is all prose', () => {
    const prose = 'The bank has deployed machine learning models for transaction '
      + 'monitoring across all retail customers, cutting false positives.';
    expect(dropChrome(prose)).toBe(prose);
  });

  it('never returns nothing, even when every fragment looks like chrome', () => {
    // A page this heuristic misreads should still reach the classifier.
    const allShort = 'Home . Finance . People . Search';
    expect(dropChrome(allShort)).toBe(allShort);
  });
});

describe('clustering the archive', () => {
  const row = (id: string, title: string, when: string, excerpt: string | null = null) => ({
    id, title, published_at: when, fetched_at: when, excerpt, summary: null,
    publisher_kind: 'media', region_hint: null, url_original: `https://example.com/${id}`,
  });

  it('groups the eight rows and keeps one', () => {
    const rows = DBS_ROLLOUT.map((t, i) => row(`d${i}`, t, '2026-08-20T00:00:00Z'));
    const clusters = cluster(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.duplicates).toHaveLength(DBS_ROLLOUT.length - 1);
  });

  it('keeps the copy that can actually be read', () => {
    // A row with a body is worth more than the row that arrived first: without
    // one the drill-down has nothing to show.
    const rows = [
      row('early', DBS_ROLLOUT[0]!, '2026-08-19T00:00:00Z'),
      row('readable', DBS_ROLLOUT[1]!, '2026-08-20T00:00:00Z', 'x'.repeat(400)),
    ];
    expect(cluster(rows)[0]!.keep.id).toBe('readable');
  });

  it('marks rather than deletes', () => {
    const rows = DBS_ROLLOUT.map((t, i) => row(`d${i}`, t, '2026-08-20T00:00:00Z'));
    const sql = markStatements(cluster(rows));
    expect(sql).toHaveLength(DBS_ROLLOUT.length - 1);
    for (const s of sql) {
      expect(s).toContain('UPDATE articles SET duplicate_of');
      expect(s).not.toContain('DELETE');
    }
  });

  it('leaves a lone article alone', () => {
    expect(cluster([row('a', DBS_ROLLOUT[0]!, '2026-08-20T00:00:00Z')])).toEqual([]);
  });
});
