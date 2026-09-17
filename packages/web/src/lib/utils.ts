import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Join class names, letting a later Tailwind class beat an earlier one.
 *
 * Plain string concatenation does not do that: `"p-2 p-4"` leaves both in the
 * markup and the winner is whichever CSS rule the stylesheet happens to emit
 * last, not the one the caller wrote last. `twMerge` understands that `p-2`
 * and `p-4` are the same property and keeps the last — which is what makes a
 * component's default padding overridable by its caller.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
