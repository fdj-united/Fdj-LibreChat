import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMediaQuery } from '@librechat/client';
import { Shapes, Lock, Globe, Users } from 'lucide-react';
import type { TArtifactApp } from 'librechat-data-provider';
import ArtifactAppsAdminSettings from './ArtifactAppsAdminSettings';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import ArtifactAppsSearchBar from './ArtifactAppsSearchBar';
import { useListArtifactAppsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

function visibilityIcon(v: TArtifactApp['visibility']) {
  if (v === 'public') return <Globe size={14} className="text-text-secondary" aria-hidden="true" />;
  if (v === 'tenant') return <Users size={14} className="text-text-secondary" aria-hidden="true" />;
  return <Lock size={14} className="text-text-secondary" aria-hidden="true" />;
}

function statusBadge(s: TArtifactApp['status']) {
  const colors: Record<TArtifactApp['status'], string> = {
    draft: 'border-border-medium bg-surface-tertiary text-text-secondary',
    pending_review: 'border-border-heavy bg-surface-active text-text-primary',
    published: 'border-border-heavy bg-surface-active text-text-primary',
    suspended: 'border-destructive/30 bg-destructive/10 text-text-destructive',
    archived: 'border-border-light bg-surface-secondary text-text-tertiary',
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${colors[s]}`}>
      {s.replace('_', ' ')}
    </span>
  );
}

export default function ArtifactAppsList() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [searchQuery, setSearchQuery] = useState('');
  const { data, isLoading, isError } = useListArtifactAppsQuery();
  const apps = data?.apps;
  const filteredApps = useMemo(() => {
    const availableApps = apps ?? [];
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) {
      return availableApps;
    }

    return availableApps.filter((app) =>
      [app.title, app.description, app.category, ...(app.tags ?? [])]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query)),
    );
  }, [apps, searchQuery]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-text-secondary">
          {localize('com_ui_artifact_app_loading')}
        </div>
      );
    }

    if (isError) {
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-text-secondary">
          {localize('com_ui_artifact_app_not_found')}
        </div>
      );
    }

    if (filteredApps.length === 0) {
      const titleKey = searchQuery
        ? 'com_ui_artifact_apps_no_results'
        : 'com_ui_artifact_apps_empty';
      const hintKey = searchQuery
        ? 'com_ui_artifact_apps_no_results_hint'
        : 'com_ui_artifact_apps_empty_hint';

      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <Shapes size={40} className="text-text-secondary opacity-40" aria-hidden="true" />
          <p className="text-text-secondary">{localize(titleKey)}</p>
          <p className="max-w-sm text-sm text-text-secondary">{localize(hintKey)}</p>
        </div>
      );
    }

    return (
      <ul>
        {filteredApps.map((app) => (
          <li key={app.artifactAppId}>
            <button
              className="mb-3 flex w-full items-start gap-4 rounded-xl border border-border-light bg-surface-secondary p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => navigate(`/apps/${app.artifactAppId}`)}
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-primary text-xl">
                {app.icon ?? <Shapes size={20} className="text-text-secondary" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-text-primary">{app.title}</span>
                  {visibilityIcon(app.visibility)}
                  {statusBadge(app.status)}
                </div>
                {app.description && (
                  <p className="mt-0.5 truncate text-sm text-text-secondary">{app.description}</p>
                )}
                <p className="mt-1 text-xs text-text-secondary">
                  {localize('com_ui_artifact_app_version_number', {
                    0: String(app.latestVersionNumber),
                  })}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <main className="relative flex h-full w-full grow flex-col overflow-hidden bg-presentation">
      <div className="scrollbar-gutter-stable relative flex h-full flex-col overflow-y-auto overflow-x-hidden">
        {!isSmallScreen && (
          <div className="container mx-auto max-w-4xl">
            <div className="mb-8 mt-12 text-center">
              <h1 className="mb-3 text-3xl font-bold tracking-tight text-text-primary md:text-5xl">
                {localize('com_ui_artifact_apps')}
              </h1>
              <p className="mx-auto mb-6 max-w-2xl text-lg text-text-secondary">
                {localize('com_ui_artifact_apps_description')}
              </p>
            </div>
          </div>
        )}

        <div className="sticky top-0 z-10 mt-4 bg-presentation pb-4 md:mt-0">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="mx-auto mb-3 flex max-w-2xl items-center justify-between gap-2 md:hidden">
              <OpenSidebar />
              <ArtifactAppsAdminSettings compact />
            </div>
            <div className="mx-auto flex max-w-2xl items-center gap-2 pb-6">
              <ArtifactAppsSearchBar value={searchQuery} onChange={setSearchQuery} />
              {!isSmallScreen && <ArtifactAppsAdminSettings />}
            </div>
          </div>
        </div>

        <div className="container mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 pb-8">
          {renderContent()}
        </div>
      </div>
    </main>
  );
}
