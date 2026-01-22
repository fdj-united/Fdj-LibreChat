import React from 'react';
import { TooltipAnchor } from '@librechat/client';
import { Flag } from 'lucide-react';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import { useGetStartupConfig } from '~/data-provider';

export function FeedbackButton() {
  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();

  const handleFeedback = () => {
    console.log('[FeedbackButton] Dispatching openFeedbackModal event');

    const feedbackData = {
      userId: user?.id,
      email: user?.email,
      tableSasToken: startupConfig?.tableSasToken,
      blobSasToken: startupConfig?.blobSasToken,
      storageAccount: startupConfig?.SAS_STORAGE_ACCOUNT,
      tableName: startupConfig?.SAS_TABLE_NAME,
      containerName: startupConfig?.SAS_CONTAINER_NAME,
      appTitle: startupConfig?.appTitle,
    };

    const bridge = (window as any).feedbackBridge;
    if (bridge && typeof bridge.openModal === 'function') {
      console.log('[FeedbackButton] Opening modal from bridge');
      bridge.openModal(feedbackData);
    } else {
      console.log('[FeedbackButton] No bridge found, dispatching event');
      const event = new CustomEvent('openFeedbackModal', {
        detail: feedbackData,
        cancelable: true,
      });
      window.dispatchEvent(event);
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-3">
      <TooltipAnchor
        description="Send us your feedback"
        render={
          <button
            onClick={handleFeedback}
            aria-label="Send feedback"
            className={cn(
              'inline-flex size-10 flex-shrink-0 items-center justify-center rounded-xl border border-border-light text-text-primary transition-all ease-in-out hover:bg-surface-tertiary',
              'bg-transparent shadow-sm hover:bg-surface-hover hover:shadow-md',
              'active:shadow-inner',
            )}
          >
            <Flag className="relative h-5 w-5 md:h-4 md:w-4" />
          </button>
        }
      />
    </div>
  );
}
