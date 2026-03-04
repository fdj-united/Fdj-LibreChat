import React, { useMemo, useState } from 'react';
import { Button } from '@librechat/client';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useLocalize, useAuthContext } from '~/hooks';
import type { ReviewCommentHistoryProps } from './types';
import { formatReviewDate } from './utils';
import ReviewVerificationIcon from './ReviewVerificationIcon';

const INITIAL_VISIBLE_COMMENTS = 1;

export default function ReviewCommentHistory({
  reviewHistory,
  canManageVerification,
  onDeleteRequest,
  isDeleting,
  initialVisibleCount = INITIAL_VISIBLE_COMMENTS,
}: ReviewCommentHistoryProps) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const newestFirst = useMemo(() => [...reviewHistory].reverse(), [reviewHistory]);
  const visibleComments = historyExpanded
    ? newestFirst
    : newestFirst.slice(0, initialVisibleCount);
  const hasMoreComments = reviewHistory.length > initialVisibleCount;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-text-primary">
        {localize('com_agents_review_history_title')}
      </h4>
      <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
        {reviewHistory.length === 0 ? (
          <p className="py-2 text-sm text-text-secondary">
            {localize('com_agents_review_history_empty')}
          </p>
        ) : (
          visibleComments.map((entry) => (
            <div
              key={entry._id ?? entry.reviewed_at}
              className="flex flex-col gap-1 rounded-md border border-border-medium bg-surface-secondary p-2.5 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-primary">
                  {entry.reviewed_by_name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-text-secondary">
                    {formatReviewDate(entry.reviewed_at)}
                  </span>
                  <ReviewVerificationIcon verified={entry.verified} tooltipSide="top" />
                </div>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-text-primary">
                  {entry.comment || '—'}
                </p>
                {(canManageVerification || (user?.id && entry.reviewed_by && String(entry.reviewed_by) === String(user.id))) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 min-h-6 shrink-0 p-0 text-text-secondary hover:text-red-500"
                    disabled={isDeleting}
                    onClick={() => onDeleteRequest(entry)}
                    aria-label={localize('com_agents_review_delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {reviewHistory.length > 0 && hasMoreComments && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-center gap-1 text-text-secondary"
          onClick={() => setHistoryExpanded(!historyExpanded)}
        >
          {historyExpanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              {localize('com_agents_review_history_show_less')}
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              {localize('com_agents_review_history_show_more')}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
