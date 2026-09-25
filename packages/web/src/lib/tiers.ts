/**
 * How big an institution is, so the board can put the largest first.
 *
 * Asked for in so many words: Tier 1 banks at the top — UBS, HSBC, Deutsche
 * Bank — then Tier 2, and so on, with digital banks and providers kept apart
 * from the banks rather than ranked among them.
 *
 * A tier here is a published fact, not an opinion, wherever a published fact
 * exists — the same reason the rest of this project is extractive:
 *
 *  - Tier 1 is the Financial Stability Board's list of global systemically
 *    important banks. Anyone can check it, and it moves once a year.
 *  - Tier 2 is a bank its home regulator names as systemically important (a
 *    D-SIB, or an O-SII in Europe), or, where a country publishes no such
 *    list, one of the largest banks in its market. The `basis` says which.
 *  - Tier 3 is every other bank.
 *
 * Digital banks and providers have no FSB list. They are kept out of the
 * tiers — a neobank with fifty million customers is neither "Tier 3" nor a
 * G-SIB — and providers carry a size rank of their own, written down with its
 * reason, so the order inside that band is as checkable as the tiers above it.
 *
 * Every entry is a named institution a reviewer has written on an A. A name
 * this list does not hold lands in "Not yet tiered" rather than being guessed,
 * and `tests/tiers.test.ts` fails when a decision file names one — so a review
 * pass that adds a new institution adds its tier in the same commit.
 */

export type TierGroup = 'tier1' | 'tier2' | 'tier3' | 'digital' | 'provider' | 'authority';
export type BandKey = TierGroup | 'untiered';

/** The bands, in the order the board shows them. */
export const BANDS: readonly { key: BandKey; label: string; note: string }[] = [
  {
    key: 'tier1',
    label: 'Tier 1 banks',
    note: 'On the Financial Stability Board\'s list of global systemically important banks.',
  },
  {
    key: 'tier2',
    label: 'Tier 2 banks',
    note: 'Named systemically important by their home regulator, or among the largest banks in their country.',
  },
  {
    key: 'tier3',
    label: 'Tier 3 banks',
    note: 'Regional and mid-size banks, community banks, credit unions and building societies.',
  },
  {
    key: 'digital',
    label: 'Digital banks',
    note: 'Licensed banks built app-first: neobanks, digital-only and digital-asset banks.',
  },
  {
    key: 'provider',
    label: 'Providers',
    note: 'Payments, data and technology firms, and other non-bank financial firms, largest first.',
  },
  {
    key: 'authority',
    label: 'Central banks and regulators',
    note: 'Supervisors and central banks using AI in their own work.',
  },
  {
    key: 'untiered',
    label: 'Not yet tiered',
    note: 'Named by a reviewer but not yet placed. Each review pass tiers the new names.',
  },
];

export interface Institution {
  /** Canonical name. */
  name: string;
  group: TierGroup;
  /**
   * Order inside the band, 1 first. Only providers use more than one value:
   * 1 is a global network, bureau or platform, 2 an established specialist,
   * 3 a young or single-market firm. Banks are ranked by their tier alone.
   */
  rank?: 1 | 2 | 3;
  /** Why this tier — the list or the fact it rests on. */
  basis: string;
  /** Other ways reviewers and the press write the same name. */
  aliases?: string[];
}

const GSIB = 'FSB global systemically important bank';

/**
 * The FSB list, as published in November 2024: 29 banks.
 *
 * Kept as its own constant so a test can hold the Tier 1 entries to it
 * exactly — a bank promoted to Tier 1 by hand, or a G-SIB left in Tier 2, is
 * the error this whole scheme exists to rule out. The FSB publishes a new list
 * each November; check it then, and change this and the entries together.
 */
export const G_SIBS: readonly string[] = [
  'JPMorgan', 'Bank of America', 'Citi', 'HSBC',
  'Agricultural Bank of China', 'Bank of China', 'Barclays', 'BNP Paribas',
  'China Construction Bank', 'Deutsche Bank', 'Goldman Sachs', 'ICBC', 'MUFG',
  'Bank of Communications', 'BNY', 'Groupe BPCE', 'Crédit Agricole', 'ING',
  'Mizuho', 'Morgan Stanley', 'Royal Bank of Canada', 'Santander',
  'Société Générale', 'Standard Chartered', 'State Street', 'SMBC',
  'TD Bank', 'UBS', 'Wells Fargo',
];

const gsib = (name: string, aliases: string[] = []): Institution =>
  ({ name, group: 'tier1', basis: GSIB, aliases });

export const INSTITUTIONS: readonly Institution[] = [
  /* ------------------------------------------------------------ Tier 1 */
  gsib('JPMorgan', ['JPMorgan Chase', 'J.P. Morgan', 'JP Morgan', 'Chase']),
  gsib('Bank of America', ['BofA', 'Bank of America Merrill', 'Merrill', 'Merrill Lynch']),
  gsib('Citi', ['Citigroup', 'Citibank']),
  gsib('HSBC', ['HSBC UK', 'HSBC Holdings']),
  gsib('Agricultural Bank of China'),
  gsib('Bank of China'),
  gsib('Barclays'),
  gsib('BNP Paribas', ['BNP']),
  gsib('China Construction Bank', ['CCB']),
  gsib('Deutsche Bank'),
  gsib('Goldman Sachs', ['Goldman']),
  gsib('ICBC', ['Industrial and Commercial Bank of China']),
  gsib('MUFG', ['Mitsubishi UFJ', 'Mitsubishi UFJ Financial Group']),
  gsib('Bank of Communications'),
  gsib('BNY', ['BNY Mellon', 'Bank of New York Mellon']),
  gsib('Groupe BPCE', ['BPCE']),
  gsib('Crédit Agricole'),
  gsib('ING', ['ING Group']),
  gsib('Mizuho'),
  gsib('Morgan Stanley'),
  gsib('Royal Bank of Canada', ['RBC']),
  gsib('Santander', ['Banco Santander', 'Santander UK']),
  gsib('Société Générale', ['SocGen']),
  gsib('Standard Chartered', ['StanChart']),
  gsib('State Street'),
  gsib('SMBC', ['Sumitomo Mitsui', 'Sumitomo Mitsui Banking Corporation']),
  gsib('TD Bank', ['TD', 'Toronto-Dominion', 'TD Bank Group']),
  gsib('UBS'),
  gsib('Wells Fargo'),

  /* ------------------------------------------------------------ Tier 2 */
  { name: 'DBS', group: 'tier2', basis: 'Singapore D-SIB (MAS)', aliases: ['DBS Bank'] },
  { name: 'OCBC', group: 'tier2', basis: 'Singapore D-SIB (MAS)', aliases: ['OCBC Bank'] },
  { name: 'UOB', group: 'tier2', basis: 'Singapore D-SIB (MAS)', aliases: ['United Overseas Bank'] },
  { name: 'Bank of Singapore', group: 'tier2', basis: 'Private bank of OCBC, a Singapore D-SIB' },
  { name: 'KB Kookmin Bank', group: 'tier2', basis: 'Korean D-SIB (FSC)', aliases: ['KB Kookmin', 'Kookmin Bank'] },
  { name: 'Shinhan Bank', group: 'tier2', basis: 'Korean D-SIB (FSC)', aliases: ['Shinhan'] },
  { name: 'Hana Bank', group: 'tier2', basis: 'Korean D-SIB (FSC)', aliases: ['KEB Hana Bank'] },
  { name: 'Woori Bank', group: 'tier2', basis: 'Korean D-SIB (FSC)', aliases: ['Woori'] },
  { name: 'NH NongHyup Bank', group: 'tier2', basis: 'Korean D-SIB (FSC)', aliases: ['NongHyup Bank'] },
  { name: 'State Bank of India', group: 'tier2', basis: 'Indian D-SIB (RBI)', aliases: ['SBI'] },
  { name: 'HDFC Bank', group: 'tier2', basis: 'Indian D-SIB (RBI)' },
  { name: 'ICICI Bank', group: 'tier2', basis: 'Indian D-SIB (RBI)' },
  { name: 'Bank of Baroda', group: 'tier2', basis: 'India\'s second-largest public-sector bank' },
  { name: 'Axis Bank', group: 'tier2', basis: 'One of India\'s three largest private-sector banks' },
  { name: 'Lloyds', group: 'tier2', basis: 'UK O-SII (PRA)', aliases: ['Lloyds Bank', 'Lloyds Banking Group'] },
  { name: 'NatWest', group: 'tier2', basis: 'UK O-SII (PRA)', aliases: ['NatWest Group'] },
  { name: 'Danske Bank', group: 'tier2', basis: 'Danish systemically important institution' },
  { name: 'Nordea', group: 'tier2', basis: 'Finnish O-SII' },
  { name: 'Commerzbank', group: 'tier2', basis: 'German O-SII (BaFin)' },
  { name: 'BBVA', group: 'tier2', basis: 'Spanish O-SII' },
  { name: 'CaixaBank', group: 'tier2', basis: 'Spanish O-SII' },
  { name: 'Intesa Sanpaolo', group: 'tier2', basis: 'Italian O-SII' },
  { name: 'UniCredit', group: 'tier2', basis: 'Italian O-SII' },
  { name: 'ABN AMRO', group: 'tier2', basis: 'Dutch O-SII' },
  { name: 'Rabobank', group: 'tier2', basis: 'Dutch O-SII' },
  { name: 'Raiffeisen Bank Romania', group: 'tier2', basis: 'Romanian O-SII' },
  { name: 'Zürcher Kantonalbank', group: 'tier2', basis: 'Swiss D-SIB (FINMA)', aliases: ['ZKB', 'Zurich Cantonal Bank'] },
  { name: 'Raiffeisen Schweiz', group: 'tier2', basis: 'Swiss D-SIB (FINMA)', aliases: ['Raiffeisen Switzerland'] },
  { name: 'PostFinance', group: 'tier2', basis: 'Swiss D-SIB (FINMA)' },
  { name: 'CIBC', group: 'tier2', basis: 'Canadian D-SIB (OSFI)', aliases: ['Canadian Imperial Bank of Commerce'] },
  { name: 'Scotiabank', group: 'tier2', basis: 'Canadian D-SIB (OSFI)', aliases: ['Bank of Nova Scotia'] },
  { name: 'BMO', group: 'tier2', basis: 'Canadian D-SIB (OSFI)', aliases: ['Bank of Montreal'] },
  { name: 'U.S. Bank', group: 'tier2', basis: 'US Category III bank, over $250bn in assets', aliases: ['US Bank', 'U.S. Bancorp'] },
  { name: 'Truist', group: 'tier2', basis: 'US Category III bank, over $250bn in assets', aliases: ['Truist Financial'] },
  { name: 'PNC', group: 'tier2', basis: 'US Category III bank, over $250bn in assets', aliases: ['PNC Bank'] },
  { name: 'Capital One', group: 'tier2', basis: 'US Category III bank, over $250bn in assets' },
  { name: 'Commonwealth Bank', group: 'tier2', basis: 'Australian D-SIB (APRA)', aliases: ['CBA', 'Commonwealth Bank of Australia'] },
  { name: 'ANZ', group: 'tier2', basis: 'Australian D-SIB (APRA)' },
  { name: 'NAB', group: 'tier2', basis: 'Australian D-SIB (APRA)', aliases: ['National Australia Bank'] },
  { name: 'Westpac', group: 'tier2', basis: 'Australian D-SIB (APRA)' },
  { name: 'Standard Bank', group: 'tier2', basis: 'South African D-SIB (SARB)' },
  { name: 'Absa', group: 'tier2', basis: 'South African D-SIB (SARB)' },
  { name: 'Bank of Georgia', group: 'tier2', basis: 'Georgian systemic bank (National Bank of Georgia)' },

  /* ------------------------------------------------------------ Tier 3 */
  { name: 'Indian Bank', group: 'tier3', basis: 'Mid-size Indian public-sector bank' },
  { name: 'IndusInd Bank', group: 'tier3', basis: 'Mid-size Indian private-sector bank' },
  { name: 'Warba Bank', group: 'tier3', basis: 'Mid-size Kuwaiti bank' },
  { name: 'Rogers Bank', group: 'tier3', basis: 'Canadian card issuer owned by a telecom group' },
  { name: 'MVB Bank', group: 'tier3', basis: 'US community bank' },
  { name: 'ConnectOne Bank', group: 'tier3', basis: 'US regional bank' },
  { name: 'Municipal Credit Union', group: 'tier3', basis: 'US credit union' },
  { name: 'Saffron Building Society', group: 'tier3', basis: 'UK building society', aliases: ['Saffron'] },

  /* ----------------------------------------------------- digital banks */
  { name: 'Starling Bank', group: 'digital', basis: 'UK digital bank', aliases: ['Starling'] },
  { name: 'Revolut', group: 'digital', basis: 'Digital bank, licensed in the EU and UK' },
  { name: 'Monzo', group: 'digital', basis: 'UK digital bank' },
  { name: 'Zopa', group: 'digital', basis: 'UK digital bank', aliases: ['Zopa Bank'] },
  { name: 'N26', group: 'digital', basis: 'German digital bank' },
  { name: 'Nubank', group: 'digital', basis: 'Brazilian digital bank', aliases: ['Nu Holdings'] },
  { name: 'Klarna', group: 'digital', basis: 'Swedish-licensed digital bank' },
  { name: 'PicPay', group: 'digital', basis: 'Brazilian digital bank' },
  { name: 'C6 Bank', group: 'digital', basis: 'Brazilian digital bank' },
  { name: 'Discovery Bank', group: 'digital', basis: 'South African digital bank' },
  { name: 'Trust Bank', group: 'digital', basis: 'Singapore digital bank' },
  { name: 'Sony Bank', group: 'digital', basis: 'Japanese online bank' },
  { name: 'Ruya', group: 'digital', basis: 'UAE digital bank', aliases: ['Ruya Bank'] },
  { name: 'Scalable Capital', group: 'digital', basis: 'German digital broker with a banking licence' },
  { name: 'Sygnum Bank', group: 'digital', basis: 'Swiss digital-asset bank (FINMA)', aliases: ['Sygnum'] },
  { name: 'Incore Bank', group: 'digital', basis: 'Swiss digital-asset bank (FINMA)', aliases: ['Incore'] },

  /* --------------------------------------------------------- providers */
  { name: 'Visa', group: 'provider', rank: 1, basis: 'Global card network' },
  { name: 'Mastercard', group: 'provider', rank: 1, basis: 'Global card network' },
  { name: 'American Express', group: 'provider', rank: 1, basis: 'Global card network', aliases: ['Amex'] },
  { name: 'Experian', group: 'provider', rank: 1, basis: 'One of the three global credit bureaus' },
  { name: 'Equifax', group: 'provider', rank: 1, basis: 'One of the three global credit bureaus' },
  { name: 'TransUnion', group: 'provider', rank: 1, basis: 'One of the three global credit bureaus' },
  { name: 'Stripe', group: 'provider', rank: 1, basis: 'Global payments platform' },
  { name: 'Adyen', group: 'provider', rank: 1, basis: 'Global payments platform' },
  { name: 'PayPal', group: 'provider', rank: 1, basis: 'Global payments platform' },
  { name: 'Square', group: 'provider', rank: 1, basis: 'Global payments platform (Block)', aliases: ['Block'] },
  { name: 'Ant International', group: 'provider', rank: 1, basis: 'Global payments platform (Ant Group)' },
  { name: 'Fiserv', group: 'provider', rank: 1, basis: 'Global banking and payments technology' },
  { name: 'FIS', group: 'provider', rank: 1, basis: 'Global banking and payments technology' },
  { name: 'Vanguard', group: 'provider', rank: 1, basis: 'One of the world\'s largest asset managers' },
  { name: 'BlackRock', group: 'provider', rank: 1, basis: 'The world\'s largest asset manager' },
  { name: 'Worldline', group: 'provider', rank: 2, basis: 'Large European payment processor' },
  { name: 'Jack Henry', group: 'provider', rank: 2, basis: 'Established US core banking provider' },
  { name: 'Temenos', group: 'provider', rank: 2, basis: 'Established core banking provider' },
  { name: 'Finastra', group: 'provider', rank: 2, basis: 'Established banking software provider' },
  { name: 'Avaloq', group: 'provider', rank: 2, basis: 'Established core banking provider' },
  { name: 'GoCardless', group: 'provider', rank: 2, basis: 'Established payments firm' },
  { name: 'Razorpay', group: 'provider', rank: 2, basis: 'Established Indian payments firm' },
  { name: 'Cashfree Payments', group: 'provider', rank: 2, basis: 'Established Indian payments firm', aliases: ['Cashfree'] },
  { name: 'Talkdesk', group: 'provider', rank: 2, basis: 'Established contact-centre software vendor' },
  { name: 'Paysera', group: 'provider', rank: 3, basis: 'Regional payments firm' },
  { name: 'Sokin', group: 'provider', rank: 3, basis: 'Young payments firm' },
  { name: 'Concryt', group: 'provider', rank: 3, basis: 'Young payments firm' },
  { name: 'Flagright', group: 'provider', rank: 3, basis: 'Young compliance software firm' },
  { name: 'Feathery', group: 'provider', rank: 3, basis: 'Young software firm' },
  { name: 'KIWI Finance', group: 'provider', rank: 3, basis: 'Credit brokerage network' },
  { name: 'Bank Salad', group: 'provider', rank: 3, basis: 'Korean personal-finance app' },
  { name: 'Lucie Money', group: 'provider', rank: 3, basis: 'Young personal-finance app' },
  { name: '1% Club', group: 'provider', rank: 3, basis: 'Young personal-finance app' },
  { name: 'WazirX', group: 'provider', rank: 3, basis: 'Indian crypto exchange' },
  { name: 'AmeriFlex', group: 'provider', rank: 3, basis: 'US benefits administrator' },
  { name: 'Growhill Wealth', group: 'provider', rank: 3, basis: 'Wealth management firm' },
  { name: 'NewEdge Advisors', group: 'provider', rank: 3, basis: 'US wealth advisory firm', aliases: ['NewEdge'] },

  /* ------------------------------------------- central banks, regulators */
  { name: 'Monetary Authority of Singapore', group: 'authority', basis: 'Central bank and regulator', aliases: ['MAS'] },
  { name: 'Bank of England', group: 'authority', basis: 'Central bank' },
  { name: 'Bank of Thailand', group: 'authority', basis: 'Central bank' },
  { name: 'Reserve Bank of India', group: 'authority', basis: 'Central bank', aliases: ['RBI'] },
  { name: 'National Bank of the Kyrgyz Republic', group: 'authority', basis: 'Central bank' },
  { name: 'Swiss National Bank', group: 'authority', basis: 'Central bank', aliases: ['SNB'] },
  { name: 'FINMA', group: 'authority', basis: 'Regulator' },
  { name: 'European Central Bank', group: 'authority', basis: 'Central bank', aliases: ['ECB'] },
  { name: 'Federal Reserve', group: 'authority', basis: 'Central bank', aliases: ['the Fed'] },
  { name: 'Financial Conduct Authority', group: 'authority', basis: 'Regulator', aliases: ['FCA'] },
  { name: 'Hong Kong Monetary Authority', group: 'authority', basis: 'Central bank and regulator', aliases: ['HKMA'] },
];

/**
 * A name reduced to what identifies it: accents folded, case and punctuation
 * gone. `Société Générale`, `Societe Generale` and `société générale` are one
 * key, and so are `U.S. Bank` and `US Bank`.
 */
export const nameKey = (name: string): string =>
  name.normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');

const BY_KEY: ReadonlyMap<string, Institution> = new Map(
  INSTITUTIONS.flatMap((i) => [i.name, ...(i.aliases ?? [])].map((n) => [nameKey(n), i] as const)));

const BAND_ORDER = new Map(BANDS.map((b, i) => [b.key, i]));

export interface Tier {
  band: BandKey;
  /** Order inside the band, 1 first. */
  rank: number;
  institution: Institution | null;
}

const UNTIERED: Tier = { band: 'untiered', rank: 1, institution: null };

/** Sorts before `b` when `a` is the larger institution. */
export const compareTiers = (a: Tier, b: Tier): number =>
  (BAND_ORDER.get(a.band)! - BAND_ORDER.get(b.band)!) || a.rank - b.rank;

/**
 * The tier of whatever a reviewer wrote in `actor`.
 *
 * Reviewers write joint use cases as one string — `Citi, HSBC, Standard
 * Chartered`, `Santander and Mastercard` — and the entry goes under the
 * largest institution named in it. The whole string is tried first, so a
 * name with "and" or "&" inside it is not split into pieces. A part that
 * names nobody (`four other global banks`) is ignored rather than failing the
 * whole string.
 */
export function tierOf(actor: string): Tier {
  const whole = BY_KEY.get(nameKey(actor));
  if (whole) return fromInstitution(whole);

  let best: Tier = UNTIERED;
  for (const part of actor.split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*\+\s*/)) {
    const hit = BY_KEY.get(nameKey(part));
    if (!hit) continue;
    const t = fromInstitution(hit);
    if (best.institution === null || compareTiers(t, best) < 0) best = t;
  }
  return best;
}

function fromInstitution(i: Institution): Tier {
  return { band: i.group, rank: i.rank ?? 1, institution: i };
}

/**
 * A tier in a table cell's worth of words: `Tier 1 bank`, `Digital bank`,
 * `Tier 2 provider`. The board says the same thing with a band heading; a row
 * in the Market Lens has one cell to say it in.
 */
export function tierLabel(t: Tier): string {
  switch (t.band) {
    case 'tier1': return 'Tier 1 bank';
    case 'tier2': return 'Tier 2 bank';
    case 'tier3': return 'Tier 3 bank';
    case 'digital': return 'Digital bank';
    case 'provider': return `Tier ${t.rank} provider`;
    case 'authority': return 'Regulator';
    case 'untiered': return 'Not tiered';
  }
}
