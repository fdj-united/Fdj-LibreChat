import { useFormContext, Controller } from 'react-hook-form';
import {
  Switch,
  HoverCard,
  HoverCardPortal,
  HoverCardContent,
  HoverCardTrigger,
  CircleHelpIcon,
} from '@librechat/client';
import type { AgentForm } from '~/common';
import { useLocalize } from '~/hooks';
import { ESide } from '~/common';

export default function EagerExecution() {
  const localize = useLocalize();
  const methods = useFormContext<AgentForm>();
  const { control } = methods;

  return (
    <HoverCard openDelay={50}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="eager_execution" className="text-sm font-medium text-text-primary">
            {localize('com_ui_agent_eager_execution')}
          </label>
          <HoverCardTrigger>
            <CircleHelpIcon className="h-4 w-4 text-text-tertiary" />
          </HoverCardTrigger>
        </div>
        <Controller
          name="eager_execution"
          control={control}
          render={({ field }) => (
            <Switch
              id="eager_execution"
              checked={field.value !== false}
              onCheckedChange={field.onChange}
              aria-label={localize('com_ui_agent_eager_execution')}
            />
          )}
        />
      </div>
      <HoverCardPortal>
        <HoverCardContent side={ESide.Top} className="w-80">
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_agent_eager_execution_info')}
            </p>
          </div>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
