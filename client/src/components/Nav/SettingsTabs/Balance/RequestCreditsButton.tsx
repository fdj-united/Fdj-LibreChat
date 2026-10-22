import { useState } from 'react';
import { Button, OGDialog, OGDialogTrigger, OGDialogTemplate } from '@librechat/client';
import { useCreditRequestStatus, useLocalize } from '~/hooks';
import Reason from '~/components/Balance/Reason';

export default function RequestCreditsButton() {
  const localize = useLocalize();
  const [reason, setReason] = useState('');
  const { pendingCreditRequest, submit, isSubmitting } = useCreditRequestStatus();

  if (pendingCreditRequest) {
    return (
      <Button size="sm" variant="outline" disabled className="cursor-default opacity-70">
        {localize('com_nav_balance_request_sent')}
      </Button>
    );
  }

  return (
    <OGDialog>
      <OGDialogTrigger asChild>
        <Button size="sm" variant="outline" type="button">
          {localize('com_nav_balance_request_button')}
        </Button>
      </OGDialogTrigger>
      <OGDialogTemplate
        title={localize('com_nav_balance_request_confirm_title')}
        className="max-w-[450px]"
        main={
          <div className="flex w-full flex-col gap-2">
            <Reason
              id="request-credits-reason"
              value={reason}
              onChange={setReason}
              placeholder={localize('com_nav_balance_request_reason_placeholder')}
            />
          </div>
        }
        selection={{
          selectHandler: () => submit(reason.trim() || undefined),
          selectText: localize('com_nav_balance_request_button'),
          isLoading: isSubmitting,
        }}
      />
    </OGDialog>
  );
}
