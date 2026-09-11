import { Shapes } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';

interface ArtifactAppsButtonProps {
  side?: 'right' | 'bottom';
  onNavigate?: () => void;
}

/** Primary-sidebar entry for the standalone artifact marketplace. */
export default function ArtifactAppsButton({
  side = 'right',
  onNavigate,
}: ArtifactAppsButtonProps) {
  const localize = useLocalize();
  const label = localize('com_nav_artifact_apps');

  return (
    <TooltipAnchor
      side={side}
      description={label}
      render={
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0">
          <Link
            to="/apps"
            data-testid="nav-artifact-apps-button"
            aria-label={label}
            onClick={(event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
                return;
              }
              onNavigate?.();
            }}
          >
            <Shapes className="h-5 w-5 text-text-primary" aria-hidden="true" />
          </Link>
        </Button>
      }
    />
  );
}
