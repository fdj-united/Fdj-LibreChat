import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';
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
import { useLocalize } from '~/hooks';
import { useChatContext } from '~/Providers';

export default function ReviewAgentPanel() {
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const agent_id = conversation?.agent_id;

  const [comment, setComment] = useState<string>('');
  const [isVerified, setIsVerified] = useState<boolean>(false);
  const [originalVerified, setOriginalVerified] = useState<boolean>(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<boolean>(false);

  // Fetch the agent data
  const { data: agent } = useQuery({
    queryKey: ['agent', agent_id],
    queryFn: () => dataService.getAgentById({ agent_id: agent_id as string }),
    enabled: !!agent_id,
  });

  // Fetch the latest review from the new endpoint
  const { data: latestReview } = useQuery({
    queryKey: ['agentReview', agent_id],
    queryFn: () => dataService.getAgentLatestReview(agent_id as string),
    enabled: !!agent_id,
  });

  // Mutation for submitting reviews
  const submitReviewMutation = useMutation({
    mutationFn: (data: { agent_id: string; verified: boolean; comment: string }) =>
      dataService.submitAgentReview(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agentReview', agent_id] });
      setComment('');
      setIsVerified(false);
      showToast({ message: localize('com_agents_review_submit_success'), status: 'success' });
      navigate('/agents/all');
    },
    onError: () => {
      showToast({ message: localize('com_agents_review_submit_error'), status: 'error' });
    },
  });

  const isSubmitting = submitReviewMutation.isLoading;

  useEffect(() => {
    if (latestReview?.verified !== undefined) {
      setIsVerified(latestReview.verified);
      setOriginalVerified(latestReview.verified);
    }
  }, [latestReview]);

  const handleSubmitClick = () => {
    if (!agent_id) {
      showToast({
        message: localize('com_agents_review_no_agent_selected'),
        status: 'error',
      });
      return;
    }

    // Show confirmation dialog
    setShowConfirmDialog(true);
  };

  const handleConfirmSubmit = () => {
    setShowConfirmDialog(false);
    if (!agent_id) {
      return;
    }
    submitReviewMutation.mutate({
      agent_id,
      verified: isVerified,
      comment: comment.trim(),
    });
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
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={localize('com_agents_review_comments_placeholder')}
          className="min-h-[150px] w-full resize-y rounded-md border border-border-medium bg-surface-primary p-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-border-heavy focus:outline-none focus:ring-1 focus:ring-border-heavy"
          disabled={isSubmitting}
        />
        <p className="text-xs text-text-secondary">
          {comment.length} {localize('com_agents_review_characters')}
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
          {agent?.name && (
            <div className="mb-2">
              <p className="text-xs text-text-secondary">
                {localize('com_agents_review_agent_name_label')}
              </p>
              <p className="font-mono text-sm text-text-primary">{agent.name}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-text-secondary">
              {localize('com_agents_review_agent_id_label')}
            </p>
            <p className="font-mono text-sm text-text-primary">{agent_id}</p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-auto flex flex-col gap-2">
        <Button
          onClick={handleSubmitClick}
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
