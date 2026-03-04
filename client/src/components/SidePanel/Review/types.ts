/**
 * Agent review/verification — fork feature.
 * Types used only by the Review side panel; kept local for isolation.
 */

/** Single review comment entry (matches API / data-provider shape) */
export interface ReviewCommentEntry {
  _id?: string;
  comment: string;
  reviewed_by?: string;
  reviewed_by_name: string;
  reviewed_at: string;
  verified: boolean;
}

export interface ReviewCommentHistoryProps {
  reviewHistory: ReviewCommentEntry[];
  canManageVerification: boolean;
  onDeleteRequest: (entry: ReviewCommentEntry) => void;
  isDeleting: boolean;
  initialVisibleCount?: number;
}

export interface ReviewVerificationIconProps {
  /** When set, shows icon for this value (no fetch). When undefined, uses current agent's latest review. */
  verified?: boolean;
  /** Tooltip placement. Default 'left' for nav, 'top' for inline in lists. */
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

export interface ReviewCommentFormProps {
  agentId: string | undefined;
  agentName?: string;
  comment: string;
  onCommentChange: (value: string) => void;
  isVerified: boolean;
  onVerifiedChange: (value: boolean) => void;
  originalVerified: boolean;
  isSubmitting: boolean;
  canManageVerification: boolean;
  onSubmitClick: () => void;
  onAddCommentClick: () => void;
  onViewMarketplace: () => void;
}
