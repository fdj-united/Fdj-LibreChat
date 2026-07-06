import { Controller, useFormContext } from 'react-hook-form';
import { Checkbox } from '@librechat/client';
import type { AgentForm } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function ContextUpload() {
  const localize = useLocalize();
  const { control } = useFormContext<AgentForm>();

  return (
    <div className="flex items-center">
      <Controller
        name="disable_context_upload"
        control={control}
        render={({ field }) => (
          <Checkbox
            id="context-upload-checkbox"
            checked={field.value !== true}
            onCheckedChange={(checked) => field.onChange(checked !== true)}
            className="relative float-left mr-2 inline-flex h-4 w-4 cursor-pointer"
            aria-labelledby="context-upload-label"
          />
        )}
      />
      <label
        id="context-upload-label"
        htmlFor="context-upload-checkbox"
        className={cn('form-check-label text-token-text-primary cursor-pointer text-sm')}
      >
        {localize('com_ui_agent_enable_context_upload')}
      </label>
    </div>
  );
}
