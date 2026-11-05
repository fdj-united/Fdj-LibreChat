import { Trans } from 'react-i18next';
import { Controller, useFormContext } from 'react-hook-form';
import { Input, Label, HoverCard, HoverCardPortal, HoverCardContent } from '@librechat/client';
import type { AgentForm } from '~/common';
import { InfoTrigger } from './Advanced/ui';
import { useLocalize } from '~/hooks';
import { ESide } from '~/common';

export const AI_USE_CASE_COACH_URL =
  'https://kait.kindredgroup.com/c/new?agent_id=agent_hgNPUmP7hio5CGrKg4-iI';

const fieldClass = 'h-9';

export default function JiraUseCaseLink() {
  const localize = useLocalize();
  const { control } = useFormContext<AgentForm>();

  return (
    <HoverCard openDelay={50}>
      <div className="mb-3 flex flex-col">
        <div className="mb-1 flex items-center gap-1.5">
          <Label
            htmlFor="jira-use-case-link"
            className="block text-[11px] font-medium uppercase tracking-wide text-text-secondary"
          >
            {localize('com_ui_agent_jira_use_case_link')}
          </Label>
          <InfoTrigger />
        </div>
        <Controller
          name="jiraUseCaseLink"
          control={control}
          render={({ field }) => (
            <Input
              {...field}
              value={field.value ?? ''}
              className={fieldClass}
              id="jira-use-case-link"
              type="text"
              placeholder={localize('com_ui_agent_jira_use_case_link_placeholder')}
              aria-label={localize('com_ui_agent_jira_use_case_link')}
            />
          )}
        />
      </div>
      <HoverCardPortal>
        <HoverCardContent side={ESide.Top} className="w-80">
          <p className="text-sm text-text-secondary">
            <Trans
              i18nKey="com_ui_agent_jira_use_case_link_info"
              components={{
                anchor: (
                  <a
                    href={AI_USE_CASE_COACH_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-primary underline"
                  >
                    {localize('com_ui_agent_jira_use_case_coach')}
                  </a>
                ),
              }}
            />
          </p>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
