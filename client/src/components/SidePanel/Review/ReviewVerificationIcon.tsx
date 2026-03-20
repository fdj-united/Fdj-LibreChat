import { useQuery } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';
import { TooltipAnchor } from '@librechat/client';
import { BadgeCheck, CircleAlert } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { useChatContext } from '~/Providers';
import type { ReviewVerificationIconProps } from './types';

export default function ReviewVerificationIcon({
  verified: verifiedProp,
  tooltipSide = 'left',
}: ReviewVerificationIconProps = {}) {
  const localize = useLocalize();
  const agent_id = useChatContext().conversation?.agent_id;

  const { data: latestReview } = useQuery({
    queryKey: ['agentReview', agent_id],
    queryFn: () => dataService.getAgentLatestReview(agent_id as string),
    enabled: verifiedProp === undefined && !!agent_id,
  });

  const verified = verifiedProp ?? latestReview?.verified === true;
  const showIcon = verifiedProp !== undefined || (!!agent_id && latestReview !== undefined);

  if (!showIcon) {
    return null;
  }

  const description = verified
    ? localize('com_agents_review_status_verified')
    : localize('com_agents_review_status_not_verified');
  const Icon = verified ? BadgeCheck : CircleAlert;
  const iconClassName = verified ? 'text-green-600' : 'text-yellow-500';

  return (
    <TooltipAnchor
      description={description}
      side={tooltipSide}
      className="inline-flex !cursor-default"
      tabIndex={-1}
      role="img"
    >
      <Icon className={`h-4 w-4 shrink-0 cursor-help ${iconClassName}`} aria-hidden />
    </TooltipAnchor>
  );
}
