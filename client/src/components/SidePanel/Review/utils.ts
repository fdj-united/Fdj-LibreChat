/**
 * Agent review/verification — fork feature.
 * Small helpers used only by the Review side panel.
 */

import { formatDateTime } from '~/utils';

/** Format review timestamp for display; falls back to raw string if invalid. */
export function formatReviewDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return Number.isNaN(d.getTime()) ? isoString : formatDateTime(isoString);
  } catch {
    return isoString;
  }
}
