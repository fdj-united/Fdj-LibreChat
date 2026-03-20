import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useToastContext, OGDialog, OGDialogTemplate } from '@librechat/client';
import { useLocalize, useHasAccess } from '~/hooks';
import { useChatContext } from '~/Providers';
import type { ReviewCommentEntry } from './types';
import ReviewCommentHistory from './ReviewCommentHistory';
import ReviewCommentForm from './ReviewCommentForm';

export default function ReviewAgentPanel() {
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const agent_id = conversation?.agent_id;

  const canManageVerification = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });

  const [comment, setComment] = useState<string>('');
  const [isVerified, setIsVerified] = useState<boolean>(false);
  const [originalVerified, setOriginalVerified] = useState<boolean>(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<ReviewCommentEntry | null>(null);

  // Fetch the agent data
  const { data: agent } = useQuery({
    queryKey: [QueryKeys.agent, agent_id],
    queryFn: () => dataService.getAgentById({ agent_id: agent_id as string }),
    enabled: !!agent_id,
  });

  // Fetch the latest review (for verification toggle state)
  const { data: latestReview } = useQuery({
    queryKey: ['agentReview', agent_id],
    queryFn: () => dataService.getAgentLatestReview(agent_id as string),
    enabled: !!agent_id,
  });

  // Full verification comment history (chronological)
  const { data: reviewHistory = [] } = useQuery({
    queryKey: ['agentReviews', agent_id],
    queryFn: () => dataService.getAgentReviews(agent_id as string),
    enabled: !!agent_id,
  });

  // Mutation for submitting reviews (admins can set verification; others add comment with current state)
  const submitReviewMutation = useMutation({
    mutationFn: (data: {
      agent_id: string;
      verified: boolean;
      comment: string;
      navigateOnSuccess?: boolean;
    }) =>
      dataService.submitAgentReview({
        agent_id: data.agent_id,
        verified: data.verified,
        comment: data.comment,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentReview', agent_id] });
      queryClient.invalidateQueries({ queryKey: ['agentReviews', agent_id] });
      setComment('');
      setIsVerified(false);
      showToast({ message: localize('com_agents_review_submit_success'), status: 'success' });
      if (variables.navigateOnSuccess) {
        navigate('/agents/all');
      }
    },
    onError: () => {
      showToast({ message: localize('com_agents_review_submit_error'), status: 'error' });
    },
  });

  // Mutation for deleting a single review comment
  const deleteReviewMutation = useMutation({
    mutationFn: ({ agent_id: id, review_id }: { agent_id: string; review_id: string }) =>
      dataService.deleteAgentReview({ agent_id: id, review_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agentReview', agent_id] });
      queryClient.invalidateQueries({ queryKey: ['agentReviews', agent_id] });
      setDeleteTarget(null);
      showToast({ message: localize('com_agents_review_delete_success'), status: 'success' });
    },
    onError: () => {
      showToast({ message: localize('com_agents_review_delete_error'), status: 'error' });
    },
  });

  const isSubmitting = submitReviewMutation.isLoading;
  const isDeleting = deleteReviewMutation.isLoading;

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
      navigateOnSuccess: true,
    });
  };

  const handleAddCommentOnly = () => {
    if (!agent_id) {
      showToast({ message: localize('com_agents_review_no_agent_selected'), status: 'error' });
      return;
    }
    if (!comment.trim()) {
      return;
    }
    submitReviewMutation.mutate({
      agent_id,
      verified: latestReview?.verified ?? false,
      comment: comment.trim(),
      navigateOnSuccess: false,
    });
  };

  const handleConfirmDelete = () => {
    if (!agent_id || !deleteTarget?._id) {
      return;
    }
    deleteReviewMutation.mutate({ agent_id, review_id: deleteTarget._id });
  };

  if (!agent_id) {
    return null;
  }

  return (
    <div className="flex h-full flex-col gap-4 py-4">
      {/* Part 1: Comment history — visible to everyone (read-only for non-admins) */}
      <ReviewCommentHistory
        reviewHistory={reviewHistory}
        canManageVerification={canManageVerification}
        onDeleteRequest={setDeleteTarget}
        isDeleting={isDeleting}
      />

      {/* Comment / verification form — add comment (non-admins) or full verification (admins) */}
      <ReviewCommentForm
        agentId={agent_id}
        agentName={agent?.name ?? undefined}
        comment={comment}
        onCommentChange={setComment}
        isVerified={isVerified}
        onVerifiedChange={setIsVerified}
        originalVerified={originalVerified}
        isSubmitting={isSubmitting}
        canManageVerification={canManageVerification}
        onSubmitClick={handleSubmitClick}
        onAddCommentClick={handleAddCommentOnly}
        onViewMarketplace={() => navigate('/agents/all')}
      />

      {/* Submit confirmation dialog */}
      <OGDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_agents_review_confirm_title')}
          className="max-w-md"
          main={
            <p className="text-sm text-text-secondary">
              {localize('com_agents_review_confirm_description')}
            </p>
          }
          selection={{
            selectHandler: handleConfirmSubmit,
            selectText: isSubmitting
              ? localize('com_agents_review_submitting')
              : localize('com_agents_review_confirm_submit'),
            isLoading: isSubmitting,
          }}
        />
      </OGDialog>

      {/* Delete comment confirmation dialog */}
      <OGDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_agents_review_delete_confirm_title')}
          className="max-w-md"
          main={
            <p className="text-sm text-text-secondary">
              {localize('com_agents_review_delete_confirm_description')}
            </p>
          }
          selection={{
            selectHandler: handleConfirmDelete,
            selectClasses:
              'bg-destructive text-white transition-all duration-200 hover:bg-destructive/80',
            selectText: localize('com_agents_review_delete'),
            isLoading: isDeleting,
          }}
        />
      </OGDialog>
    </div>
  );
}
