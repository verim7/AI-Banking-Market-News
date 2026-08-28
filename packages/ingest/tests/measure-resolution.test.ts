import { describe, expect, it } from 'vitest';
import { bestMatch, phraseFor } from '../src/measure-resolution.ts';

/**
 * The matcher decides the only number this measurement produces, so a loose
 * match does not merely add noise — it invents a recovery rate. Every case
 * below is a real pair from the graded corpus.
 */
describe('matching a stuck headline to a GDELT result', () => {
  const c = (title: string, link: string) => ({ title, link });

  it('matches the identical headline', () => {
    const title = 'Bank of Singapore uses agentic AI to speed up wealth client onboarding';
    expect(bestMatch(title, [
      c('Something else entirely', 'https://a.example/1'),
      c(title, 'https://privatebankerinternational.com/real'),
    ])).toBe('https://privatebankerinternational.com/real');
  });

  it('matches through punctuation and case, which outlets vary freely', () => {
    expect(bestMatch('Citi, HSBC, StanChart adopt Ant International’s forex AI tool', [
      c('Citi HSBC StanChart Adopt Ant International s Forex AI Tool',
        'https://reuters.com/real'),
    ])).toBe('https://reuters.com/real');
  });

  it('matches a re-titled report of the same story', () => {
    // Nine of ten distinctive words survive the re-title; the tenth is dropped.
    expect(bestMatch('DBS rolls out agentic AI for 1,500 bankers to draft credit memos', [
      c('DBS rolls out agentic AI for 1,500 bankers to draft credit memos today',
        'https://finews.asia/real'),
    ])).toBe('https://finews.asia/real');
  });

  it('refuses a different story about the same bank', () => {
    // The failure that would silently inflate the rate: same institution, same
    // vocabulary, different deployment. A recovery has to be the article.
    expect(bestMatch('DBS rolls out agentic AI for 1,500 bankers to draft credit memos', [
      c('DBS reskills 11,000 staff on AI tools', 'https://wrong.example/1'),
      c('DBS rolls out career advisory AI for staff', 'https://wrong.example/2'),
    ])).toBeNull();
  });

  it('refuses when nothing came back', () => {
    expect(bestMatch('Bank of Singapore uses agentic AI to speed up onboarding', []))
      .toBeNull();
  });

  it('will not match on a headline too short to be distinctive', () => {
    // Three words cannot identify an article, and a query built from them would
    // return the whole day's banking news. Both halves refuse it: no query is
    // built, and an exact match on it would still not be a recovery.
    expect(phraseFor('AI in banking')).toBeNull();
    expect(bestMatch('AI in banking', [c('AI in banking', 'https://x.example/1')]))
      .toBeNull();
  });

  it('builds a quoted phrase GDELT can match in order', () => {
    const p = phraseFor('Bank of Singapore uses agentic AI to speed up wealth client onboarding');
    expect(p).toBe('"bank of singapore uses agentic ai to speed up wealth"');
  });
});
