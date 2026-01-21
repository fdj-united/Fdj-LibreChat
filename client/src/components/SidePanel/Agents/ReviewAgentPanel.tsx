import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from 'librechat-data-provider';
import {
  Button,
  Label,
  Switch,
  useToastContext,
  OGDialog,
  OGDialogContent,
  OGDialogTitle,
  OGDialogDescription,
} from '@librechat/client';
import { useGetAgentByIdQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { useChatContext } from '~/Providers';

export default function ReviewAgentPanel() {
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const localize = useLocalize();
  const agent_id = conversation?.agent_id;

  const { data: agent } = useGetAgentByIdQuery(agent_id);

  const [comments, setComments] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (agent?.review_metadata?.verified !== undefined) {
      setIsVerified(agent.review_metadata.verified);
    }
  }, [agent]);

  const handleSubmitClick = () => {
    if (!agent_id) {
      showToast({
        message: localize('com_agents_review_no_agent_selected'),
        status: 'error',
      });
      return;
    }

    if (!comments.trim()) {
      showToast({
        message: localize('com_agents_review_no_comments'),
        status: 'error',
      });
      return;
    }

    // Show confirmation dialog
    setShowConfirmDialog(true);
  };

  const handleConfirmSubmit = async () => {
    setShowConfirmDialog(false);
    if (!agent_id) {
      return;
    }
    setIsSubmitting(true);
    try {
      await request.post(`/api/agents/${agent_id}/verify`, {
        verified: isVerified,
        comments: comments.trim(),
      });
      showToast({ message: localize('com_agents_review_submit_success'), status: 'success' });
      navigate('/agents/all');
    } catch {
      showToast({ message: localize('com_agents_review_submit_error'), status: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold text-text-primary">
          {localize('com_agents_review_title')}
        </h3>
        <p className="text-sm text-text-secondary">{localize('com_agents_review_description')}</p>
      </div>

      {/* Comments Section */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="review-comments" className="text-sm font-medium text-text-primary">
          {localize('com_agents_review_comments_label')}
        </Label>
        <textarea
          id="review-comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder={localize('com_agents_review_comments_placeholder')}
          className="min-h-[150px] w-full resize-y rounded-md border border-border-medium bg-surface-primary p-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-border-heavy focus:outline-none focus:ring-1 focus:ring-border-heavy"
          disabled={isSubmitting}
        />
        <p className="text-xs text-text-secondary">
          {comments.length} {localize('com_agents_review_characters')}
        </p>
      </div>

      {/* Verification Toggle */}
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
          onCheckedChange={setIsVerified}
          disabled={isSubmitting}
          aria-label="Toggle agent verification"
        />
      </div>

      {/* Agent Info */}
      {agent_id && (
        <div className="rounded-md border border-border-medium bg-surface-tertiary p-3">
          <p className="text-xs text-text-secondary">
            {localize('com_agents_review_agent_id_label')}
          </p>
          <p className="font-mono text-sm text-text-primary">{agent_id}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-auto flex flex-col gap-2">
        <Button
          onClick={handleSubmitClick}
          disabled={isSubmitting || !comments.trim()}
          className="w-full"
        >
          {isSubmitting
            ? localize('com_agents_review_submitting')
            : localize('com_agents_review_submit')}
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate('/agents/all')}
          disabled={isSubmitting}
          className="w-full"
        >
          {localize('com_agents_review_view_marketplace')}
        </Button>
      </div>

      {/* Confirmation Dialog */}
      <OGDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <OGDialogContent className="max-w-md">
          <OGDialogTitle className="text-lg font-semibold">
            {localize('com_agents_review_confirm_title')}
          </OGDialogTitle>
          <OGDialogDescription className="py-4 text-sm text-text-secondary">
            {localize('com_agents_review_confirm_description')}
          </OGDialogDescription>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              disabled={isSubmitting}
            >
              {localize('com_agents_review_cancel')}
            </Button>
            <Button onClick={handleConfirmSubmit} disabled={isSubmitting}>
              {isSubmitting
                ? localize('com_agents_review_submitting')
                : localize('com_agents_review_confirm_submit')}
            </Button>
          </div>
        </OGDialogContent>
      </OGDialog>
    </div>
  );
}
