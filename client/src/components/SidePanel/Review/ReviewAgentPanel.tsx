import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService, PermissionBits, SystemRoles } from 'librechat-data-provider';
import { ControlCombobox, useToastContext, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { ReviewCommentEntry } from './types';
import { useLocalize, useHasAccess, useAuthContext } from '~/hooks';
import ReviewCommentHistory from './ReviewCommentHistory';
import { useListAgentsQuery } from '~/data-provider';
import ReviewCommentForm from './ReviewCommentForm';
import { useChatContext } from '~/Providers';

export default function ReviewAgentPanel() {
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const agent_id = conversation?.agent_id;
  const { user } = useAuthContext();

  const hasMarketplaceAccess = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });
  const canManageVerification = user?.role === SystemRoles.ADMIN && hasMarketplaceAccess;

  const [comment, setComment] = useState<string>('');
  const [isVerified, setIsVerified] = useState<boolean>(false);
  const [originalVerified, setOriginalVerified] = useState<boolean>(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<ReviewCommentEntry | null>(null);
  const [selectedReviewAgentId, setSelectedReviewAgentId] = useState<string | undefined>(agent_id);
  const { data: agents = null } = useListAgentsQuery(
    { requiredPermission: PermissionBits.VIEW },
    { select: (res) => res.data },
  );

  useEffect(() => {
    setSelectedReviewAgentId(agent_id);
  }, [agent_id]);

  // Fetch the latest review (for verification toggle state)
  const { data: latestReview } = useQuery({
    queryKey: ['agentReview', selectedReviewAgentId],
    queryFn: () => dataService.getAgentLatestReview(selectedReviewAgentId as string),
    enabled: !!selectedReviewAgentId,
  });

  // Full verification comment history (chronological)
  const { data: reviewHistory = [] } = useQuery({
    queryKey: ['agentReviews', selectedReviewAgentId],
    queryFn: () => dataService.getAgentReviews(selectedReviewAgentId as string),
    enabled: !!selectedReviewAgentId,
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
      queryClient.invalidateQueries({ queryKey: ['agentReview', variables.agent_id] });
      queryClient.invalidateQueries({ queryKey: ['agentReviews', variables.agent_id] });
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
      if (selectedReviewAgentId) {
        queryClient.invalidateQueries({ queryKey: ['agentReview', selectedReviewAgentId] });
        queryClient.invalidateQueries({ queryKey: ['agentReviews', selectedReviewAgentId] });
      }
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
    if (!selectedReviewAgentId) {
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
    if (!selectedReviewAgentId) {
      return;
    }
    submitReviewMutation.mutate({
      agent_id: selectedReviewAgentId,
      verified: isVerified,
      comment: comment.trim(),
      navigateOnSuccess: false,
    });
  };

  const handleAddCommentOnly = () => {
    if (!selectedReviewAgentId) {
      showToast({ message: localize('com_agents_review_no_agent_selected'), status: 'error' });
      return;
    }
    if (!comment.trim()) {
      return;
    }
    submitReviewMutation.mutate({
      agent_id: selectedReviewAgentId,
      verified: latestReview?.verified ?? false,
      comment: comment.trim(),
      navigateOnSuccess: false,
    });
  };

  const handleConfirmDelete = () => {
    if (!selectedReviewAgentId || !deleteTarget?._id) {
      return;
    }
    deleteReviewMutation.mutate({ agent_id: selectedReviewAgentId, review_id: deleteTarget._id });
  };

  return (
    <div className="flex h-full flex-col gap-4 px-2 py-2">
      {/* Part 1: Comment history — visible to everyone (read-only for non-admins) */}
      <ControlCombobox
        containerClassName="px-0"
        selectedValue={selectedReviewAgentId ?? ''}
        displayValue={agents?.find((agent) => agent.id === selectedReviewAgentId)?.name ?? ''}
        selectPlaceholder={localize('com_agents_review_agent_name_label')}
        iconSide="right"
        searchPlaceholder={localize('com_agents_search_name')}
        setValue={setSelectedReviewAgentId}
        items={
          agents?.map((agent) => ({
            label: agent.name ?? '',
            value: agent.id ?? '',
          })) ?? [{ label: 'Loading...', value: '' }]
        }
        className="z-50 flex h-[40px] w-full flex-none items-center justify-center truncate rounded-md bg-transparent font-bold"
        ariaLabel={localize('com_agents_review_agent_name_label')}
        isCollapsed={false}
        showCarat={true}
      />

      {selectedReviewAgentId && (
        <>
          {/* Part 1: Comment history — visible to everyone (read-only for non-admins) */}
          <ReviewCommentHistory
            reviewHistory={reviewHistory}
            canManageVerification={canManageVerification}
            onDeleteRequest={setDeleteTarget}
            isDeleting={isDeleting}
          />

          {/* Comment / verification form — add comment (non-admins) or full verification (admins) */}
          <ReviewCommentForm
            agentId={selectedReviewAgentId}
            agentName={
              agents?.find((agent) => agent.id === selectedReviewAgentId)?.name ?? undefined
            }
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
        </>
      )}
    </div>
  );
}
