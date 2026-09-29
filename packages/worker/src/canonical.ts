/**
 * The tracker's own address, which colleagues, the weekly email and the
 * calendar entries are given.
 */
export const CANONICAL_ORIGIN = 'https://tracker.ai-banking-brief.com';

/**
 * Where a page request to the old workers.dev address should go instead.
 *
 * Emails, calendar entries and bookmarks made before the move point at
 * workers.dev. Sending those to the tracker's own domain, with the path and
 * query intact, means the weekly email's "Open this month's use cases" opens on
 * the new address however old the email is. Only the page itself is moved: the
 * API and the logos still answer on workers.dev, so drafts built before the
 * move keep their images. Null when the request should be served where it is.
 */
export function movedTo(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (!url.hostname.endsWith('.workers.dev')) return null;
  return `${CANONICAL_ORIGIN}${url.pathname}${url.search}`;
}

/**
 * Whether a browser says this request was started by another site.
 *
 * Sec-Fetch-Site first: every current browser sends it, a web page cannot set
 * it, and it does not depend on host names (which Wrangler rewrites locally).
 * Only "same-origin" (this site's own pages) and "none" (typed or bookmarked)
 * pass; "same-site" is a sibling subdomain, and none of those is ours to trust.
 * Without it, an older browser's Origin is compared with the host asked for.
 * Without either, no browser page started the request, and it carries no
 * browser cookie to abuse.
 */
export function isCrossSite(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  if (origin === 'null') return true;      // a sandboxed or file:// page
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}
