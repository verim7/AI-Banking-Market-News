import type { ClassifiedArticle } from '@portal/shared';
import { DIMENSIONS, TAXONOMY } from '@portal/shared';

/**
 * OPTIONAL Claude enrichment — off unless ANTHROPIC_API_KEY is set.
 *
 * This is the only part of the pipeline that costs money. Claude Haiku 4.5 is
 * $1.00 per million input tokens and $5.00 per million output; at roughly 700
 * tokens per article and a few hundred articles a day that is single-digit
 * dollars a month. Everything still works without it: the rules classifier
 * already produces tags and a score, and this step only refines them.
 *
 * Only articles the rules already rated plausible are sent, so the spend
 * tracks signal rather than feed volume.
 */

const MODEL = 'claude-haiku-4-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

export interface EnrichOptions {
  apiKey: string;
  /** Only enrich articles at or above this rules score. */
  minScore?: number;
  /** Hard ceiling on articles per run, so a feed spike cannot cause a bill spike. */
  maxArticles?: number;
}

function allowedValues(): string {
  return DIMENSIONS.map((d) =>
    `${d}: ${TAXONOMY[d].map((e) => e.value).join(', ')}`).join('\n');
}

const SYSTEM_PROMPT = `You classify news articles about AI in banking and financial services.

Return only values from these lists:
${allowedValues()}

Rules:
- summary: one factual sentence, max 30 words, describing the concrete AI use case. No marketing language.
- relevance: 0-100. High only when the article describes a specific AI use case at a specific financial institution. A general AI article that merely mentions banking is low.
- Omit a dimension entirely rather than guessing.`;

interface EnrichResult {
  summary?: string;
  relevance?: number;
  region?: string[];
  banking_area?: string[];
  bank_category?: string[];
  use_case?: string[];
}

const VALID = new Map(
  DIMENSIONS.map((d) => [d, new Set(TAXONOMY[d].map((e) => e.value))] as const),
);

async function enrichOne(
  article: ClassifiedArticle, apiKey: string,
): Promise<ClassifiedArticle> {
  const body = {
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: `Title: ${article.title}\n\n`
             + `Source: ${article.sourceName}\n\n`
             + `Text: ${(article.summary ?? article.excerpt ?? '').slice(0, 2000)}`,
    }],
    output_config: {
      format: {
        type: 'json_schema' as const,
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            relevance: { type: 'number' },
            region: { type: 'array', items: { type: 'string' } },
            banking_area: { type: 'array', items: { type: 'string' } },
            bank_category: { type: 'array', items: { type: 'string' } },
            use_case: { type: 'array', items: { type: 'string' } },
          },
          required: ['summary', 'relevance'],
          additionalProperties: false,
        },
      },
    },
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const payload = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = payload.content?.find((b) => b.type === 'text')?.text;
  if (!text) return article;

  let parsed: EnrichResult;
  try {
    parsed = JSON.parse(text);
  } catch {
    return article;
  }

  // Trust but verify: a model-supplied value outside the taxonomy would break
  // the filters, so unknown values are dropped rather than stored.
  const tags = [...article.classification.tags];
  for (const dim of DIMENSIONS) {
    const proposed = parsed[dim] ?? [];
    for (const value of proposed) {
      if (!VALID.get(dim)!.has(value)) continue;
      if (tags.some((t) => t.dimension === dim && t.value === value)) continue;
      tags.push({ dimension: dim, value, confidence: 0.9 });
    }
  }

  const relevance = typeof parsed.relevance === 'number'
    ? Math.max(0, Math.min(100, parsed.relevance))
    : article.classification.relevanceScore;

  return {
    ...article,
    summary: parsed.summary?.trim() || article.summary,
    classification: {
      tags,
      relevanceScore: relevance,
      ruleHits: [
        ...article.classification.ruleHits,
        { rule: 'claude', term: MODEL, weight: relevance - article.classification.relevanceScore },
      ],
    },
  };
}

export async function enrich(
  articles: ClassifiedArticle[], opts: EnrichOptions,
): Promise<{ articles: ClassifiedArticle[]; enriched: number; failed: number }> {
  const { apiKey, minScore = 20, maxArticles = 300 } = opts;

  const eligible = articles
    .filter((a) => a.classification.relevanceScore >= minScore)
    .slice(0, maxArticles);
  const eligibleIds = new Set(eligible.map((a) => a.id));

  let enriched = 0;
  let failed = 0;
  const byId = new Map(articles.map((a) => [a.id, a]));

  // Modest concurrency: enough to finish quickly, low enough to stay clear of
  // rate limits without needing retry bookkeeping.
  const CONCURRENCY = 4;
  const queue = [...eligible];

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const article = queue.shift();
      if (!article) break;
      try {
        byId.set(article.id, await enrichOne(article, apiKey));
        enriched++;
      } catch (err) {
        // An enrichment failure must never lose the article: the rules
        // classification is already good enough to publish.
        failed++;
        if (failed <= 3) console.warn(`  claude: ${article.id} failed — ${(err as Error).message}`);
      }
    }
  }));

  return {
    articles: articles.map((a) => (eligibleIds.has(a.id) ? byId.get(a.id)! : a)),
    enriched,
    failed,
  };
}
