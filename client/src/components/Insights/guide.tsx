import { Info } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@librechat/client';
import type { LocalizeFunction } from '~/common';
import Panel from './panel';

const definitions = [
  ['com_insights_messages', 'com_insights_messages_definition', 'com_insights_example_messages'],
  [
    'com_insights_total_conversations',
    'com_insights_conversations_definition',
    'com_insights_example_new_conversations',
  ],
  [
    'com_insights_active_conversations',
    'com_insights_active_conversations_definition',
    'com_insights_example_active_conversations',
  ],
  ['com_insights_total_users', 'com_insights_users_definition', 'com_insights_example_users'],
  ['com_insights_total_tokens', 'com_insights_tokens_definition', 'com_insights_example_tokens'],
  ['com_insights_daily_usage', 'com_insights_usage_definition', 'com_insights_example_daily'],
  [
    'com_insights_questions_per_conversation',
    'com_insights_questions_definition',
    'com_insights_example_average',
  ],
  [
    'com_insights_single_question_rate',
    'com_insights_single_question_definition',
    'com_insights_example_single',
  ],
  [
    'com_insights_activity_distribution',
    'com_insights_distribution_definition',
    'com_insights_example_distribution',
  ],
  [
    'com_insights_churned_users',
    'com_insights_churned_users_definition',
    'com_insights_example_churned',
  ],
] as const;

export default function MetricGuide({ localize }: { localize: LocalizeFunction }) {
  return (
    <Panel className="p-4">
      <Accordion type="single" collapsible>
        <AccordionItem value="definitions" className="border-none">
          <AccordionTrigger
            aria-label={localize('com_insights_guide_title')}
            className="items-start gap-3 rounded-md py-0 text-left hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            <span className="mt-0.5 shrink-0 text-status-info">
              <Info className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{localize('com_insights_guide_title')}</span>
              <span className="mt-1 block font-normal text-text-secondary">
                {localize('com_insights_guide_summary')}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0 pt-4">
            <p className="mb-4 text-text-secondary">{localize('com_insights_guide_scope')}</p>
            <dl className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              {definitions.map(([title, definition, example]) => (
                <div key={title} className="min-w-0">
                  <dt className="font-semibold">{localize(title)}</dt>
                  <dd className="mt-1 text-text-secondary">
                    <p>{localize(definition)}</p>
                    <p className="mt-2 text-text-primary">{localize(example)}</p>
                  </dd>
                </div>
              ))}
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Panel>
  );
}
