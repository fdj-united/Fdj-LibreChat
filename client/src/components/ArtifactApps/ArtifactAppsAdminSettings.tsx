import { ShieldEllipsis } from 'lucide-react';
import { SystemRoles } from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogTitle,
  OGDialogTrigger,
} from '@librechat/client';
import { useAuthContext, useLocalize } from '~/hooks';

const ArtifactAppsAdminSettings = ({ compact = false }: { compact?: boolean }) => {
  const localize = useLocalize();
  const { user } = useAuthContext();

  if (user?.role !== SystemRoles.ADMIN) {
    return null;
  }

  return (
    <OGDialog>
      <OGDialogTrigger asChild>
        <Button
          size={compact ? 'icon' : undefined}
          variant="outline"
          className={
            compact
              ? 'rounded-xl bg-presentation duration-0 hover:bg-surface-active-alt'
              : 'relative h-12 rounded-xl border-border-medium font-medium'
          }
          aria-label={localize('com_ui_admin_settings')}
          data-testid="artifact-apps-admin-settings-button"
        >
          <ShieldEllipsis className={compact ? 'icon-md' : 'cursor-pointer'} aria-hidden="true" />
        </Button>
      </OGDialogTrigger>
      <OGDialogContent className="w-11/12 max-w-md border-border-light bg-surface-primary text-text-primary">
        <OGDialogTitle>
          {localize('com_ui_admin_settings_section', {
            section: localize('com_ui_artifact_apps'),
          })}
        </OGDialogTitle>
        <p className="py-5 text-sm text-text-secondary">
          {localize('com_ui_artifact_apps_admin_settings_placeholder')}
        </p>
      </OGDialogContent>
    </OGDialog>
  );
};

export default ArtifactAppsAdminSettings;
