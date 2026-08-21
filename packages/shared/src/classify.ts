import type {
  Classification, Dimension, Maturity, PublisherKind, RuleHit, Tag,
} from './types.ts';
import {
  ADOPTION_TERMS, AI_TERMS, ANALYST_VOICE_TERMS, BANKING_TERMS, INSTITUTION_TERMS,
  MARKET_COMMENTARY_TERMS, MATURITY_SIGNALS, STUDY_TERMS,
  TAXONOMY, DIMENSIONS, type TaxonomyEntry,
} from './taxonomy.ts';

/**
 * Rules-based classifier.
 *
 * Two properties matter more than cleverness here:
 *
 *  1. **It is explainable.** Every point awarded is recorded as a RuleHit, so the
 *     HIL Checker can show why an article surfaced. A score nobody can argue
 *     with is a score nobody can improve.
 *  2. **It requires co-occurrence.** An article scores zero unless it mentions
 *     both AI *and* finance. "AI" alone drags in the entire tech press;
 *     "banking" alone drags in the entire financial press. The intersection is
 *     the product.
 *
 *     Financial evidence is either the generic vocabulary (BANKING_TERMS) or a
 *     named institution (INSTITUTION_TERMS). Requiring the generic word was a
 *     bug: "DBS expands machine learning fraud detection" is the best kind of
 *     article this portal can find, and it never says "bank".
 */

/** Publisher credibility weights. A consultancy study outranks a news blurb. */
const PUBLISHER_WEIGHT: Record<PublisherKind, number> = {
  consultancy: 1.35,
  regulator: 1.25,
  bank: 1.1,
  media: 1.0,
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matcherCache = new Map<string, RegExp>();

/**
 * Build a case-insensitive matcher bounded by non-alphanumerics rather than \b.
 * \b is wrong for terms like "u.s." and "m&a", whose edges are not word chars.
 *
 * A trailing "s" is optional for terms of four characters or more, so "private
 * bank" matches "private banks" — headlines are written in the plural far more
 * often than taxonomies are. Short terms are excluded from this so the
 * abbreviations ("ai", "ki") keep matching exactly and "ai" never eats "ais".
 */
function matcher(term: string): RegExp {
  let re = matcherCache.get(term);
  if (!re) {
    const pluralisable = term.length >= 4 && !term.endsWith('s');
    const body = escapeRegExp(term) + (pluralisable ? 's?' : '');
    re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
    matcherCache.set(term, re);
  }
  return re;
}

/** Every term in `terms` that occurs in `text`, deduplicated and in order. */
export function matchTerms(text: string, terms: string[]): string[] {
  return terms.filter((t) => matcher(t).test(text));
}

export interface ClassifyInput {
  title: string;
  summary?: string | null;
  excerpt?: string | null;
  publisherKind: PublisherKind;
  publishedAt?: string | null;
  /** Region implied by the source itself, e.g. FINMA ⇒ Switzerland. */
  regionHint?: string | null;
  /** For deterministic tests. Defaults to now. */
  now?: Date;
}

/** Tags for one dimension, ranked by how many terms matched. */
function tagsFor(dimension: Dimension, haystack: string, title: string): Tag[] {
  const entries: TaxonomyEntry[] = TAXONOMY[dimension];
  const out: Tag[] = [];

  for (const entry of entries) {
    const hits = matchTerms(haystack, entry.terms);
    if (hits.length === 0) continue;

    // A term in the title is a stronger signal than one buried in the body.
    const inTitle = hits.some((h) => matcher(h).test(title));
    const confidence = Math.min(1, 0.4 + hits.length * 0.2 + (inTitle ? 0.2 : 0));
    out.push({ dimension, value: entry.value, confidence: Number(confidence.toFixed(2)) });
  }

  // Keep the field readable: at most the four strongest tags per dimension.
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 4);
}

function ageInDays(publishedAt: string | null | undefined, now: Date): number | null {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}

/** Newer articles rank higher, but old consultancy studies stay findable. */
function recencyFactor(days: number | null): number {
  if (days === null) return 0.85;
  if (days <= 7) return 1.0;
  if (days <= 30) return 0.92;
  if (days <= 90) return 0.82;
  if (days <= 365) return 0.72;
  return 0.6;
}


/**
 * How much of the article is actually about AI.
 *
 * Separate from relevanceScore on purpose. Relevance also weighs who published
 * it and how recent it is, so a fresh regulator bulletin that mentions AI once
 * scores respectably — and that is exactly the material that was cluttering the
 * Lens. Intensity ignores provenance and asks only whether AI is the subject.
 *
 * The headline carries most of the weight, because a title is a claim about
 * what the piece is for.
 */
function aiIntensityOf(
  title: string, haystack: string, aiHits: string[], tags: Tag[],
  maturity: Maturity, add: (rule: string, term: string, weight: number) => void,
): number {
  if (aiHits.length === 0) return 0;

  let score = 0;

  const titleAi = matchTerms(title, AI_TERMS);
  if (titleAi.length > 0) {
    score += 40;
    add('ai_intensity.title', titleAi[0]!, 40);
  }

  const depth = Math.min(3, aiHits.length) * 8;
  score += depth;
  add('ai_intensity.mentions', `${aiHits.length} distinct`, depth);

  if (tags.some((t) => t.dimension === 'ai_type')) {
    score += 15;
    add('ai_intensity.named_type',
        tags.filter((t) => t.dimension === 'ai_type').map((t) => t.value).join(','), 15);
  }

  if (tags.some((t) => t.dimension === 'use_case')) {
    score += 10;
    add('ai_intensity.use_case', 'identified', 10);
  }

  // A concrete deployment is the strongest evidence the article is about
  // applying AI rather than commenting on it.
  if (maturity === 'in_production' || maturity === 'pilot') {
    score += 11;
    add('ai_intensity.deployment', maturity, 11);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** First tier to match wins; tiers are ordered so the safer reading survives. */
function maturityOf(haystack: string): { maturity: Maturity; evidence: string | null } {
  for (const tier of MATURITY_SIGNALS) {
    const hit = matchTerms(haystack, tier.terms)[0];
    if (hit) return { maturity: tier.maturity, evidence: hit };
  }
  return { maturity: 'unknown', evidence: null };
}

/**
 * Minimum intensity for an article to count as being about AI.
 *
 * Set so a headline mention alone clears it and a single passing reference in
 * the body does not. This is what keeps sanctions notices, capital rules and
 * general regulatory traffic out of a portal that is supposed to be about AI.
 */
export const MIN_AI_INTENSITY = 30;


/**
 * Is this a bank using AI, or a bank talking about AI?
 *
 * Market commentary is the false positive that survives every other check: a
 * GDP forecast citing AI capex has AI in the headline, a named bank, and high
 * intensity. What it lacks is any suggestion the institution is doing
 * something. So commentary is weighed against adoption rather than banned
 * outright — "JPMorgan will spend $17bn on technology including AI" mentions
 * spending and is still a real signal, while "JPMorgan estimates AI spending
 * will reach $17bn" is not, and only the verb separates them.
 */
export function commentaryVerdict(title: string, haystack: string): {
  isCommentary: boolean;
  commentary: string[];
  analystVoice: string[];
  adoption: string[];
} {
  const commentary = matchTerms(haystack, MARKET_COMMENTARY_TERMS);
  const analystVoice = matchTerms(haystack, ANALYST_VOICE_TERMS);
  const adoption = matchTerms(haystack, ADOPTION_TERMS);

  // Weighted toward the headline: a title about GDP is about GDP, whatever the
  // body goes on to mention.
  const titleCommentary = matchTerms(title, MARKET_COMMENTARY_TERMS).length;
  const commentaryWeight = commentary.length + titleCommentary * 2 + analystVoice.length * 2;
  const adoptionWeight = adoption.length + matchTerms(title, ADOPTION_TERMS).length;

  return {
    isCommentary: commentaryWeight > 0 && commentaryWeight >= adoptionWeight,
    commentary, analystVoice, adoption,
  };
}

/**
 * The sentence in the article that carries the use case, quoted verbatim.
 *
 * Extractive on purpose. A generated summary of an article this pipeline has
 * only seen the headline and standfirst of would be invention, and an invented
 * use case in a market-intelligence tool is worse than none — it reads exactly
 * like a real one. Quoting means every description can be checked against the
 * source, and when nothing in the text describes a use case the honest output
 * is nothing.
 */
export function useCaseEvidence(
  title: string, summary: string | null | undefined, excerpt: string | null | undefined,
): string | null {
  const text = [summary ?? '', excerpt ?? ''].join(' ').trim();
  const sentences = (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((x) => x.trim())
    .filter((x) => x.length >= 30 && x.length <= 320);

  // The best sentence is the one carrying both an AI term and a sign of use.
  let best: { sentence: string; score: number } | null = null;
  for (const sentence of sentences) {
    const ai = matchTerms(sentence, AI_TERMS).length;
    if (ai === 0) continue;
    const score = ai
      + matchTerms(sentence, ADOPTION_TERMS).length * 2
      + DIMENSIONS.filter((d) => d === 'use_case' || d === 'l1_process')
          .reduce((n, d) => n + tagsFor(d, sentence, sentence).length, 0) * 2;
    if (!best || score > best.score) best = { sentence, score };
  }

  if (best && best.score >= 3) return best.sentence;

  // Fall back to the headline only when it says something concrete itself.
  const t = title.trim();
  if (matchTerms(t, AI_TERMS).length > 0 && matchTerms(t, ADOPTION_TERMS).length > 0) return t;
  return null;
}

export function classify(input: ClassifyInput): Classification {
  const now = input.now ?? new Date();
  const title = input.title ?? '';
  const haystack = [title, input.summary ?? '', input.excerpt ?? ''].join('\n');

  const ruleHits: RuleHit[] = [];
  const add = (rule: string, term: string, weight: number) => {
    ruleHits.push({ rule, term, weight: Number(weight.toFixed(2)) });
  };

  const aiHits = matchTerms(haystack, AI_TERMS);
  const bankHits = matchTerms(haystack, BANKING_TERMS);
  const institutionHits = matchTerms(haystack, INSTITUTION_TERMS);

  // Tags are still useful even at score zero: an admin browsing the archive can
  // see how something was categorised before deciding to raise the threshold.
  const tags: Tag[] = [];
  for (const dim of DIMENSIONS) tags.push(...tagsFor(dim, haystack, title));

  if (input.regionHint && !tags.some((t) => t.dimension === 'region' && t.value === input.regionHint)) {
    tags.push({ dimension: 'region', value: input.regionHint, confidence: 0.5 });
  }

  const { maturity, evidence: maturityEvidence } = maturityOf(haystack);
  const evidence = useCaseEvidence(title, input.summary, input.excerpt);
  const aiIntensity = aiIntensityOf(title, haystack, aiHits, tags, maturity, add);
  const zero = {
    tags, relevanceScore: 0, aiIntensity, maturity, maturityEvidence,
    useCaseEvidence: evidence, ruleHits,
  };

  // Three gates, all of which must pass.
  const hasFinance = bankHits.length > 0 || institutionHits.length > 0;
  if (aiHits.length === 0 || !hasFinance) {
    if (aiHits.length === 0) add('gate.no_ai_term', '-', 0);
    if (!hasFinance) add('gate.no_banking_evidence', '-', 0);
    return zero;
  }

  // AI has to be the subject, not a passing mention. Without this a sanctions
  // notice or a capital-rules bulletin that says "AI" once reads as relevant.
  if (aiIntensity < MIN_AI_INTENSITY) {
    add('gate.ai_not_central', `intensity ${aiIntensity} < ${MIN_AI_INTENSITY}`, 0);
    return zero;
  }

  // And the institution has to be applying AI, not commenting on it. A GDP
  // forecast citing AI capex clears every check above and is not a use case.
  const verdict = commentaryVerdict(title, haystack);
  if (verdict.isCommentary) {
    add('gate.market_commentary',
        [...verdict.commentary, ...verdict.analystVoice].slice(0, 3).join(', ') || '-', 0);
    return zero;
  }
  if (verdict.adoption.length > 0) {
    add('adoption_signal', verdict.adoption.slice(0, 3).join(', '), 0);
  }

  let score = 0;

  for (const term of aiHits.slice(0, 3)) {
    score += 10;
    add('ai_term', term, 10);
  }
  for (const term of bankHits.slice(0, 3)) {
    score += 6;
    add('banking_term', term, 6);
  }
  // A named institution is more specific evidence than the generic word, and
  // is recorded under its own rule so the HIL tab shows which one fired.
  for (const term of institutionHits.slice(0, 3)) {
    score += 7;
    add('institution', term, 7);
  }

  // Both topics in the headline means the article is *about* the intersection,
  // not merely mentioning it in passing.
  const aiInTitle = matchTerms(title, AI_TERMS).length > 0;
  const bankInTitle = matchTerms(title, BANKING_TERMS).length > 0
                   || matchTerms(title, INSTITUTION_TERMS).length > 0;
  if (aiInTitle && bankInTitle) {
    score += 12;
    add('title.ai_and_banking', title.slice(0, 60), 12);
  }

  const studyHits = matchTerms(haystack, STUDY_TERMS);
  if (studyHits.length > 0) {
    score += 8;
    add('study_signal', studyHits[0]!, 8);
  }

  // A named use case is the thing Market Lens actually wants.
  const useCaseTags = tags.filter((t) => t.dimension === 'use_case');
  const useCaseBonus = Math.min(12, useCaseTags.length * 4);
  if (useCaseBonus > 0) {
    score += useCaseBonus;
    add('use_case_identified', useCaseTags.map((t) => t.value).join(','), useCaseBonus);
  }

  const pubWeight = PUBLISHER_WEIGHT[input.publisherKind];
  const beforeWeight = score;
  score *= pubWeight;
  add('publisher_weight', input.publisherKind, score - beforeWeight);

  const days = ageInDays(input.publishedAt, now);
  const rf = recencyFactor(days);
  const beforeRecency = score;
  score *= rf;
  add('recency', days === null ? 'unknown' : `${Math.round(days)}d`, score - beforeRecency);

  const relevanceScore = Math.max(0, Math.min(100, Number(score.toFixed(1))));
  return {
    tags, relevanceScore, aiIntensity, maturity, maturityEvidence,
    useCaseEvidence: evidence, ruleHits,
  };
}

/**
 * The default "Min relevance" floor in the UI. Not a hard filter: everything
 * scoring above zero is stored, and the slider in the filter bar moves this.
 *
 * Set below the headline-only band on purpose. A feed item with a title and no
 * description — common for regulators and bank newsrooms — tops out in the high
 * twenties even when it is exactly on topic ("DBS expands machine learning
 * fraud detection" scores 33). The co-occurrence gate is what removes noise;
 * this only orders what survives it, so a high floor here hides good material
 * rather than improving precision.
 */
export const DEFAULT_RELEVANCE_THRESHOLD = 25;
