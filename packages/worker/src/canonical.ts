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
