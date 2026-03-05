import React from 'react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface VerificationFilterToggleProps {
  /** Whether "Verified only" is currently selected */
  verifiedOnly: boolean;
  /** Called when the user toggles between All and Verified */
  onVerifiedFilter: (verified: boolean) => void;
  className?: string;
}

/**
 * Compact toggle for filtering agents by verification status (All vs Verified only).
 */
const VerificationFilterToggle: React.FC<VerificationFilterToggleProps> = ({
  verifiedOnly,
  onVerifiedFilter,
  className = '',
}) => {
  const localize = useLocalize();

  return (
    <div
      className={cn(
        'flex h-12 shrink-0 items-center rounded-xl border border-border-medium bg-surface-secondary p-0.5',
        className,
      )}
      role="group"
    >
      <button
        type="button"
        onClick={() => onVerifiedFilter(false)}
        className={cn(
          'flex h-full flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors',
          !verifiedOnly
            ? 'bg-surface-active-alt text-text-primary'
            : 'text-text-secondary hover:text-text-primary',
        )}
        aria-pressed={!verifiedOnly}
        aria-label={localize('com_agents_filter_all')}
      >
        {localize('com_agents_filter_all')}
      </button>
      <button
        type="button"
        onClick={() => onVerifiedFilter(true)}
        className={cn(
          'flex h-full flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors',
          verifiedOnly
            ? 'bg-surface-active-alt text-text-primary'
            : 'text-text-secondary hover:text-text-primary',
        )}
        aria-pressed={verifiedOnly}
        aria-label={localize('com_agents_filter_verified_only')}
      >
        {localize('com_agents_filter_verified_only')}
      </button>
    </div>
  );
};

export default VerificationFilterToggle;
