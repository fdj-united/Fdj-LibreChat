import React from 'react';
import { Button, Label, Switch } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn, defaultTextProps } from '~/utils';
import type { ReviewCommentFormProps } from './types';

export default function ReviewCommentForm({
  agentId,
  agentName,
  comment,
  onCommentChange,
  isVerified,
  onVerifiedChange,
  originalVerified,
  isSubmitting,
  canManageVerification,
  onSubmitClick,
  onAddCommentClick,
  onViewMarketplace,
}: ReviewCommentFormProps) {
  const localize = useLocalize();

  const textareaMinHeight = canManageVerification ? 'min-h-[120px]' : 'min-h-[100px]';
  const textareaId = canManageVerification ? 'review-comments' : 'review-comment-add';
  const textareaClassName = cn(defaultTextProps, 'w-full resize-y p-3 min-w-0', textareaMinHeight);

  const commentInputBlock = (
    <div className="flex flex-col gap-2">
      <textarea
        id={textareaId}
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        placeholder={localize('com_agents_review_comments_placeholder')}
        className={textareaClassName}
        disabled={isSubmitting}
      />
      <p className="text-xs text-text-secondary">
        {comment.length} {localize('com_agents_review_characters')}
      </p>
    </div>
  );

  // Non-admins: add-comment-only form
  if (!canManageVerification && agentId) {
    return (
      <div className="flex flex-col gap-2">
        {commentInputBlock}
        <Button
          onClick={onAddCommentClick}
          disabled={isSubmitting || !comment.trim()}
          className="w-full"
        >
          {isSubmitting
            ? localize('com_agents_review_submitting')
            : (localize('com_agents_review_add_comment') as string)}
        </Button>
      </div>
    );
  }

  // Admins: full verification form
  if (!canManageVerification) {
    return null;
  }

  return (
    <>
      <p className="text-sm text-text-secondary">{localize('com_agents_review_description')}</p>
      {commentInputBlock}
      <div className="flex items-center justify-between rounded-md border border-border-medium bg-surface-secondary p-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="verification-toggle" className="text-sm font-medium text-text-primary">
            {localize('com_agents_review_verified_label')}
          </Label>
          <p className="text-xs text-text-secondary">
            {localize('com_agents_review_verified_description')}
          </p>
        </div>
        <Switch
          id="verification-toggle"
          checked={isVerified}
          onCheckedChange={onVerifiedChange}
          disabled={isSubmitting}
          aria-label={localize('com_agents_review_verified_label')}
        />
      </div>
      {agentId && (
        <div className="rounded-md border border-border-medium bg-surface-tertiary p-3">
          {agentName && (
            <div className="mb-2">
              <p className="text-xs text-text-secondary">
                {localize('com_agents_review_agent_name_label')}
              </p>
              <p className="font-mono text-sm text-text-primary">{agentName}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-text-secondary">
              {localize('com_agents_review_agent_id_label')}
            </p>
            <p className="font-mono text-sm text-text-primary">{agentId}</p>
          </div>
        </div>
      )}
      <div className="mt-auto flex flex-col gap-2">
        <Button
          onClick={onSubmitClick}
          disabled={
            isSubmitting || (isVerified === originalVerified && comment.trim().length === 0)
          }
          className="w-full"
        >
          {isSubmitting
            ? localize('com_agents_review_submitting')
            : localize('com_agents_review_submit')}
        </Button>
        <Button
          variant="outline"
          onClick={onViewMarketplace}
          disabled={isSubmitting}
          className="w-full"
        >
          {localize('com_agents_review_view_marketplace')}
        </Button>
      </div>
    </>
  );
}
