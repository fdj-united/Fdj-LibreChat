import { Controller, useFormContext } from 'react-hook-form';
import { Checkbox } from '@librechat/client';
import type { AgentForm } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function ProviderUpload() {
  const localize = useLocalize();
  const { control } = useFormContext<AgentForm>();

  return (
    <div className="flex items-center">
      <Controller
        name="disable_provider_upload"
        control={control}
        render={({ field }) => (
          <Checkbox
            id="provider-upload-checkbox"
            checked={field.value !== true}
            onCheckedChange={(checked) => field.onChange(checked !== true)}
            className="relative float-left mr-2 inline-flex h-4 w-4 cursor-pointer"
            aria-labelledby="provider-upload-label"
          />
        )}
      />
      <label
        id="provider-upload-label"
        htmlFor="provider-upload-checkbox"
        className={cn('form-check-label cursor-pointer text-sm text-token-text-primary')}
      >
        {localize('com_ui_agent_enable_provider_upload')}
      </label>
    </div>
  );
}
