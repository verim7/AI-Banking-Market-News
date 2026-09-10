/**
 * Who counts as Swiss, and how strongly.
 *
 * The Market Lens already has a `region` tag with a `switzerland` value, and
 * the Agentic Swiss Banks tab deliberately does not use it. Region is inferred from the
 * text and from the source's region hint, so it answers "does this article
 * smell Swiss" — which is a different question from "is a Swiss bank doing
 * something", and it answers it with one bit and no evidence. A Handelszeitung
 * piece about JPMorgan is tagged switzerland. A Reuters piece about UBS often
 * is not. Both are wrong for a page whose whole purpose is what the peers down
 * the road are doing.
 *
 * So this file names them. A registry is more work than a heuristic and it is
 * the work that makes the answer checkable: every row on the Agentic Swiss Banks tab can
 * say which institution put it there, in the article's own words.
 *
 * Three things follow from the registry and they must stay one list, or they
 * drift apart:
 *
 *  1. the Agentic Swiss Banks tab filter (`chNexus` on article_scores),
 *  2. the institutions the daily crawl of Swiss bank press pages visits,
 *  3. the list a reader can be shown when they ask "who is covered".
 */

import { matcher, matchTerms } from './terms.ts';

/**
 * What kind of Swiss institution this is.
 *
 * Not a cosmetic label. The crawl plan in docs/swiss-coverage.md budgets
 * requests per kind, because a cantonal bank publishes a handful of releases a
 * year and UBS publishes several a week, and the reader reads the Lens by kind
 * too — "what are the cantonal banks doing" is the question that this tool
 * exists to answer and the global Lens cannot.
 */
export type SwissKind =
  | 'big_bank'        // UBS, and Credit Suisse for the historical record
  | 'cantonal'        // the 24 Kantonalbanken
  | 'private'         // private banks and wealth managers
  | 'retail'          // Raiffeisen, PostFinance, Migros Bank, Valiant, Cler
  | 'digital'         // neobanks and digital-first challengers
  | 'crypto'          // FINMA-licensed digital-asset banks
  | 'infrastructure'  // SIX, SIC, Swisscom's banking arm
  | 'authority';      // FINMA, the SNB, SIF, the Bankers Association

export interface SwissInstitution {
  /** Canonical name, as the Lens shows it. */
  name: string;
  kind: SwissKind;
  /**
   * Every form the press actually uses, lowercased and matched on word
   * boundaries by `matchTerms`.
   *
   * Four languages, because Swiss banking news is written in four. "Banca
   * dello Stato del Cantone Ticino" and "BancaStato" are the same bank, and a
   * list that holds only one of them silently drops half its coverage — which
   * is exactly the failure the Incore fold had.
   *
   * Short or ambiguous forms are deliberately absent. "SIX" would match the
   * number, "neon" the sign, "Cler" nothing useful on its own — so the term is
   * the unambiguous phrase ("six group", "neon bank", "bank cler") and a false
   * negative is accepted over a false positive. A wrong row on this page costs
   * more than a missing one: the page's claim is that these are the peers.
   */
  terms: string[];
  /**
   * Where the institution publishes its own news, for the daily crawl.
   *
   * The point of crawling these is that they are the primary source. Every
   * other route this tool has — Google News, trade titles, GDELT — is somebody
   * writing about a release that exists at one of these URLs, days later and
   * a headline long. Null where the institution has no public newsroom.
   */
  press: string | null;
  /**
   * An RSS or Atom feed, where one exists.
   *
   * Where this is null the crawl has to read the HTML listing, which is the
   * more brittle half of the plan — hence the split, and hence the measurement
   * in docs/swiss-coverage.md rather than an assumption.
   */
  feed: string | null;
}

/**
 * The registry.
 *
 * Not every bank in Switzerland: FINMA authorises somewhere north of 200, and
 * the long tail of regional Raiffeisen branches and single-office asset
 * managers will never appear in AI news. This is the set whose technology
 * decisions get written about — every big bank, every cantonal bank, the
 * private banks with a technology budget, the neobanks, the crypto banks, the
 * market infrastructure and the authorities.
 *
 * Ordered by kind, then roughly by size, so a diff reads as a decision.
 */
export const SWISS_INSTITUTIONS: SwissInstitution[] = [
  /* ---------------------------------------------------------- big banks */
  { name: 'UBS', kind: 'big_bank', terms: ['ubs'],
    press: 'https://www.ubs.com/global/en/media/display-page-ndp/en-20250101-media-releases.html',
    feed: 'https://www.ubs.com/global/en/media.rss' },
  { name: 'Credit Suisse', kind: 'big_bank', terms: ['credit suisse', 'crédit suisse'],
    press: null, feed: null },

  /* ----------------------------------------------------- cantonal banks */
  { name: 'Zürcher Kantonalbank', kind: 'cantonal',
    terms: ['zürcher kantonalbank', 'zurcher kantonalbank', 'zkb'],
    press: 'https://www.zkb.ch/de/ueber-uns/medien/medienmitteilungen.html', feed: null },
  { name: 'Banque Cantonale Vaudoise', kind: 'cantonal',
    terms: ['banque cantonale vaudoise', 'bcv'],
    press: 'https://www.bcv.ch/Media/Communiques-de-presse', feed: null },
  { name: 'Basler Kantonalbank', kind: 'cantonal',
    terms: ['basler kantonalbank', 'bkb'],
    press: 'https://www.bkb.ch/ueber-uns/medien', feed: null },
  { name: 'Luzerner Kantonalbank', kind: 'cantonal',
    terms: ['luzerner kantonalbank', 'lukb'],
    press: 'https://www.lukb.ch/ueber-uns/medien', feed: null },
  { name: 'Banque Cantonale de Genève', kind: 'cantonal',
    terms: ['banque cantonale de genève', 'banque cantonale de geneve', 'bcge'],
    press: 'https://www.bcge.ch/fr/communiques-de-presse', feed: null },
  { name: 'St. Galler Kantonalbank', kind: 'cantonal',
    terms: ['st. galler kantonalbank', 'st galler kantonalbank', 'sgkb'],
    press: 'https://www.sgkb.ch/de/ueber-uns/medien', feed: null },
  { name: 'Berner Kantonalbank', kind: 'cantonal',
    terms: ['berner kantonalbank', 'bekb'],
    press: 'https://www.bekb.ch/ueber-uns/medien', feed: null },
  { name: 'Aargauische Kantonalbank', kind: 'cantonal',
    terms: ['aargauische kantonalbank', 'akb'],
    press: 'https://www.akb.ch/ueber-uns/medien', feed: null },
  { name: 'Thurgauer Kantonalbank', kind: 'cantonal',
    terms: ['thurgauer kantonalbank', 'tkb'], press: null, feed: null },
  { name: 'Graubündner Kantonalbank', kind: 'cantonal',
    terms: ['graubündner kantonalbank', 'graubundner kantonalbank', 'gkb'],
    press: null, feed: null },
  { name: 'Zuger Kantonalbank', kind: 'cantonal',
    terms: ['zuger kantonalbank'], press: null, feed: null },
  { name: 'Schwyzer Kantonalbank', kind: 'cantonal',
    terms: ['schwyzer kantonalbank', 'szkb'], press: null, feed: null },
  { name: 'Schaffhauser Kantonalbank', kind: 'cantonal',
    terms: ['schaffhauser kantonalbank'], press: null, feed: null },
  { name: 'Banca dello Stato del Cantone Ticino', kind: 'cantonal',
    terms: ['banca dello stato del cantone ticino', 'bancastato'], press: null, feed: null },
  { name: 'Banque Cantonale du Valais', kind: 'cantonal',
    terms: ['banque cantonale du valais', 'walliser kantonalbank', 'bcvs'],
    press: null, feed: null },
  { name: 'Banque Cantonale de Fribourg', kind: 'cantonal',
    terms: ['banque cantonale de fribourg', 'freiburger kantonalbank', 'bcf'],
    press: null, feed: null },
  { name: 'Banque Cantonale Neuchâteloise', kind: 'cantonal',
    terms: ['banque cantonale neuchâteloise', 'banque cantonale neuchateloise', 'bcn'],
    press: null, feed: null },
  { name: 'Banque Cantonale du Jura', kind: 'cantonal',
    terms: ['banque cantonale du jura'], press: null, feed: null },
  { name: 'Basellandschaftliche Kantonalbank', kind: 'cantonal',
    terms: ['basellandschaftliche kantonalbank', 'blkb'], press: null, feed: null },
  { name: 'Obwaldner Kantonalbank', kind: 'cantonal',
    terms: ['obwaldner kantonalbank'], press: null, feed: null },
  { name: 'Nidwaldner Kantonalbank', kind: 'cantonal',
    terms: ['nidwaldner kantonalbank'], press: null, feed: null },
  { name: 'Urner Kantonalbank', kind: 'cantonal',
    terms: ['urner kantonalbank'], press: null, feed: null },
  { name: 'Glarner Kantonalbank', kind: 'cantonal',
    terms: ['glarner kantonalbank', 'glkb'], press: null, feed: null },
  { name: 'Appenzeller Kantonalbank', kind: 'cantonal',
    terms: ['appenzeller kantonalbank'], press: null, feed: null },

  /* ------------------------------------------------------ private banks */
  { name: 'Julius Bär', kind: 'private',
    terms: ['julius bär', 'julius baer'],
    press: 'https://www.juliusbaer.com/en/about-us/media/media-releases/', feed: null },
  { name: 'Pictet', kind: 'private', terms: ['pictet'],
    press: 'https://www.group.pictet/media-relations', feed: null },
  { name: 'Lombard Odier', kind: 'private', terms: ['lombard odier'],
    press: 'https://www.lombardodier.com/home/media-relations.html', feed: null },
  { name: 'Vontobel', kind: 'private', terms: ['vontobel'],
    press: 'https://www.vontobel.com/en/about-vontobel/media/', feed: null },
  { name: 'Union Bancaire Privée', kind: 'private',
    terms: ['union bancaire privée', 'union bancaire privee', 'ubp'],
    press: 'https://www.ubp.com/en/newsroom', feed: null },
  { name: 'J. Safra Sarasin', kind: 'private',
    terms: ['safra sarasin'], press: null, feed: null },
  { name: 'EFG International', kind: 'private',
    terms: ['efg international'], press: null, feed: null },
  // Bank of Singapore is deliberately absent. It has a Zurich branch, which is
  // why it was on this list for one measurement — and that measurement put two
  // grade-A rows about an OCBC wealth programme run out of Singapore onto a
  // page whose claim is "the banks down the road". A foreign bank with a Swiss
  // branch is not a Swiss institution for this purpose. The same rule keeps
  // every other branch office off the list.
  { name: 'Banque Syz', kind: 'private', terms: ['banque syz', 'syz group'],
    press: null, feed: null },
  { name: 'Bordier & Cie', kind: 'private', terms: ['bordier'], press: null, feed: null },
  { name: 'Mirabaud', kind: 'private', terms: ['mirabaud'], press: null, feed: null },
  { name: 'Reichmuth & Co', kind: 'private', terms: ['reichmuth'], press: null, feed: null },
  { name: 'Rahn+Bodmer', kind: 'private', terms: ['rahn+bodmer', 'rahn bodmer'],
    press: null, feed: null },
  { name: 'Bank Vontobel Swiss Wealth', kind: 'private',
    terms: ['swiss wealth advisors'], press: null, feed: null },

  /* --------------------------------------------------------- retail */
  { name: 'Raiffeisen Schweiz', kind: 'retail',
    terms: ['raiffeisen schweiz', 'raiffeisen suisse', 'raiffeisen switzerland'],
    press: 'https://www.raiffeisen.ch/rch/de/ueber-uns/medien.html', feed: null },
  { name: 'PostFinance', kind: 'retail', terms: ['postfinance'],
    press: 'https://www.postfinance.ch/en/about-us/media.html', feed: null },
  { name: 'Migros Bank', kind: 'retail', terms: ['migros bank'],
    press: 'https://www.migrosbank.ch/de/ueber-uns/medien.html', feed: null },
  { name: 'Valiant', kind: 'retail', terms: ['valiant bank', 'valiant holding'],
    press: 'https://www.valiant.ch/ueber-uns/medien', feed: null },
  { name: 'Bank Cler', kind: 'retail', terms: ['bank cler'],
    press: 'https://www.cler.ch/de/ueber-uns/medien', feed: null },
  { name: 'Hypothekarbank Lenzburg', kind: 'retail',
    terms: ['hypothekarbank lenzburg', 'hypi lenzburg'], press: null, feed: null },
  { name: 'Bank WIR', kind: 'retail', terms: ['bank wir', 'wir bank'],
    press: null, feed: null },
  { name: 'Cembra Money Bank', kind: 'retail', terms: ['cembra'],
    press: null, feed: null },
  { name: 'Bank Now', kind: 'retail', terms: ['bank now'], press: null, feed: null },

  /* -------------------------------------------------------- digital */
  { name: 'Swissquote', kind: 'digital', terms: ['swissquote'],
    press: 'https://www.swissquote.com/en-ch/corporate/press-releases', feed: null },
  { name: 'Yuh', kind: 'digital', terms: ['yuh app', 'yuh bank'], press: null, feed: null },
  { name: 'neon', kind: 'digital', terms: ['neon bank', 'neon switzerland'],
    press: null, feed: null },
  { name: 'Alpian', kind: 'digital', terms: ['alpian'], press: null, feed: null },
  { name: 'radicant', kind: 'digital', terms: ['radicant'], press: null, feed: null },
  { name: 'Selma Finance', kind: 'digital', terms: ['selma finance'], press: null, feed: null },
  { name: 'True Wealth', kind: 'digital', terms: ['true wealth'], press: null, feed: null },
  { name: 'Descartes Finance', kind: 'digital', terms: ['descartes finance'],
    press: null, feed: null },
  { name: 'Klara', kind: 'digital', terms: ['klara business'], press: null, feed: null },

  /* --------------------------------------------------------- crypto */
  { name: 'Sygnum Bank', kind: 'crypto', terms: ['sygnum'],
    press: 'https://www.sygnum.com/news/', feed: null },
  { name: 'AMINA Bank', kind: 'crypto', terms: ['amina bank', 'seba bank'],
    press: 'https://www.aminagroup.com/insights/', feed: null },
  { name: 'Incore Bank', kind: 'crypto', terms: ['incore bank', 'incore'],
    press: 'https://www.incorebank.ch/en/news', feed: null },
  { name: 'Bitcoin Suisse', kind: 'crypto', terms: ['bitcoin suisse'],
    press: null, feed: null },
  { name: 'Taurus', kind: 'crypto', terms: ['taurus sa', 'taurus group'],
    press: null, feed: null },
  { name: 'Relai', kind: 'crypto', terms: ['relai app'], press: null, feed: null },

  /* -------------------------------------------------- infrastructure */
  { name: 'SIX Group', kind: 'infrastructure',
    terms: ['six group', 'six swiss exchange', 'six digital exchange', 'six interbank clearing'],
    press: 'https://www.six-group.com/en/newsroom.html', feed: null },
  { name: 'Swisscom', kind: 'infrastructure',
    terms: ['swisscom banking', 'swisscom trust services'], press: null, feed: null },
  { name: 'Avaloq', kind: 'infrastructure', terms: ['avaloq'],
    press: 'https://www.avaloq.com/news', feed: null },
  { name: 'Temenos', kind: 'infrastructure', terms: ['temenos'],
    press: 'https://www.temenos.com/news/', feed: null },
  { name: 'Finnova', kind: 'infrastructure', terms: ['finnova'], press: null, feed: null },
  { name: 'Inventx', kind: 'infrastructure', terms: ['inventx'], press: null, feed: null },
  { name: 'Kyndryl Switzerland', kind: 'infrastructure',
    terms: ['kyndryl switzerland'], press: null, feed: null },

  /* ------------------------------------------------------- authority */
  { name: 'FINMA', kind: 'authority',
    terms: ['finma', 'eidgenössische finanzmarktaufsicht'],
    press: 'https://www.finma.ch/en/news/', feed: 'https://www.finma.ch/en/rss/news/' },
  { name: 'Swiss National Bank', kind: 'authority',
    terms: ['swiss national bank', 'schweizerische nationalbank',
            'banque nationale suisse', 'snb'],
    press: 'https://www.snb.ch/en/news-publications/media-news', feed: null },
  { name: 'State Secretariat for International Finance', kind: 'authority',
    terms: ['staatssekretariat für internationale finanzfragen',
            'state secretariat for international finance'],
    press: null, feed: null },
  { name: 'Swiss Bankers Association', kind: 'authority',
    terms: ['swiss bankers association', 'schweizerische bankiervereinigung',
            'association suisse des banquiers', 'bankiervereinigung'],
    press: 'https://www.swissbanking.ch/en/news-and-positions', feed: null },
  { name: 'Swiss Fintech Innovations', kind: 'authority',
    terms: ['swiss fintech innovations'], press: null, feed: null },
];

/**
 * Swiss without being an institution: the country, its cantons' finance hubs,
 * and the adjectives the press uses.
 *
 * These are the weakest signal in the schema and are never enough on their own
 * to call an article a Swiss use case — "Zurich" is also an insurer with a
 * global business and "Basel" is a capital accord. They earn their place only
 * as the third tier, where the reader has explicitly asked to see the wider
 * Swiss conversation.
 */
export const SWISS_PLACE_TERMS: string[] = [
  'switzerland', 'swiss', 'schweiz', 'schweizer', 'suisse', 'svizzera',
  'zurich', 'zürich', 'geneva', 'genève', 'genf', 'lugano', 'winterthur',
  'st. gallen', 'lausanne', 'zug', 'schwyz',
];

/**
 * How strongly an article belongs on the Agentic Swiss Banks tab.
 *
 * Three grades, strongest first. They are ordered by what the reader can do
 * with the row, not by how confident the match is:
 *
 *  - `institution`  a Swiss institution is named in the headline. This is a
 *                   peer doing something, which is the page's whole purpose.
 *  - `mention`      a Swiss institution or authority appears in the body but
 *                   not the headline: a supplier win, a survey, a panel, a
 *                   regulator's view. Real Swiss content, one step removed.
 *  - `press`        no Swiss institution anywhere; only the place, or a Swiss
 *                   publisher writing about the world. This is the tier that
 *                   the `region` tag conflates with the other two, and the
 *                   reason the Agentic Swiss Banks tab does not use it.
 *
 * The headline/body split is the same evidence rule `tagsFor` already applies:
 * an editor putting the name in the headline is asserting the article is about
 * that institution, and no other signal in a corpus of headlines is as cheap
 * or as reliable.
 */
export type ChNexus = 'institution' | 'mention' | 'press';

export const CH_NEXUS_ORDER: ChNexus[] = ['institution', 'mention', 'press'];

export const CH_NEXUS_LABELS: Record<ChNexus, string> = {
  institution: 'Swiss institution in the headline',
  mention: 'Swiss institution mentioned',
  press: 'Swiss press or place only',
};

export interface ChNexusResult {
  nexus: ChNexus | null;
  /** The institution or term that decided it, so the row can be checked. */
  evidence: string | null;
}

/** Every term in the registry, flattened once rather than per article. */
const ALL_INSTITUTION_TERMS: string[] =
  SWISS_INSTITUTIONS.flatMap((i) => i.terms);

const NAME_OF_TERM = new Map<string, string>(
  SWISS_INSTITUTIONS.flatMap((i) => i.terms.map((t) => [t, i.name] as const)));

/**
 * Read an article's Swiss nexus from its own text.
 *
 * Extractive, like everything else here: the evidence is the matched term, and
 * a caller that cannot show the evidence should not show the row.
 *
 * `swissSource` is the source's own region hint — finews.ch, Netzwoche,
 * inside-it, Handelszeitung. It can only ever produce `press`, never a stronger
 * grade, because a Swiss outlet writing about Citi is not Swiss banking news.
 */
function firstNamed(text: string): string | null {
  // Whichever institution the text names first, not whichever the registry
  // lists first. Two institutions in one sentence — "Avaloq will supply the
  // platform to Raiffeisen" — is a supplier story about a bank or a bank story
  // about a supplier depending on nothing but list order otherwise, and list
  // order is not evidence. What the article leads with is.
  let best: { name: string; at: number } | null = null;
  for (const term of ALL_INSTITUTION_TERMS) {
    const at = text.search(matcher(term));
    if (at < 0) continue;
    if (!best || at < best.at) best = { name: NAME_OF_TERM.get(term) ?? term, at };
  }
  return best?.name ?? null;
}

export function chNexusOf(
  { title, body, swissSource = false }:
  { title: string; body?: string | null; swissSource?: boolean },
): ChNexusResult {
  const head = title.toLowerCase();
  const inTitle = firstNamed(head);
  if (inTitle) return { nexus: 'institution', evidence: inTitle };

  const rest = (body ?? '').toLowerCase();
  const inBody = firstNamed(rest);
  if (inBody) return { nexus: 'mention', evidence: inBody };

  const place = matchTerms(`${head} ${rest}`, SWISS_PLACE_TERMS);
  if (place.length > 0) return { nexus: 'press', evidence: place[0]! };
  if (swissSource) return { nexus: 'press', evidence: 'Swiss publisher' };

  return { nexus: null, evidence: null };
}
