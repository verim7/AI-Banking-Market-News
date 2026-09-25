import { useState } from 'react';
import { LOGO_SLUGS } from '../lib/institutions.ts';

/**
 * An institution's logo, or its initials.
 *
 * The logo is only ever requested when `LOGO_SLUGS` says the file is there —
 * see that list for why. The `onError` fallback is the second line of defence,
 * for the day a file is deleted and the slug is not: a broken-image icon under
 * a bank's name on an executive page is worse than initials.
 */
export function InstitutionMark({ slug, monogram, actor, basis }: {
  slug: string; monogram: string; actor: string;
  /** Why the institution sits in its tier, for whoever hovers to ask. */
  basis?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hasLogo = LOGO_SLUGS.has(slug) && !failed;

  return (
    <span className="inst-mark" aria-hidden="true">
      {hasLogo
        ? <img src={`/logos/${slug}.svg`} alt="" onError={() => setFailed(true)} />
        // The name is already beside this, so the mark is decorative and the
        // title is what a mouse gets rather than what a screen reader reads.
        : <span title={basis ? `${actor}: ${basis}` : actor}>{monogram}</span>}
    </span>
  );
}
