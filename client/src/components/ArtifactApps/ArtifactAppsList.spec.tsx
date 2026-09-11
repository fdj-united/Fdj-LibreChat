import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TArtifactApp } from 'librechat-data-provider';
import { useListArtifactAppsQuery } from '~/data-provider';
import ArtifactAppsList from './ArtifactAppsList';

jest.mock('~/data-provider', () => ({
  useListArtifactAppsQuery: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => {
    const translations: Record<string, string> = {
      com_ui_artifact_apps: 'Artifacts',
      com_ui_artifact_apps_description: 'Artifacts published from your conversations.',
      com_ui_artifact_apps_search_placeholder: 'Search artifacts',
      com_ui_artifact_apps_search_aria: 'Search artifacts',
      com_ui_artifact_apps_clear_search: 'Clear artifact search',
      com_ui_artifact_apps_no_results: 'No artifacts found',
      com_ui_artifact_apps_no_results_hint: 'Try a different name, description, category, or tag.',
    };
    return translations[key] ?? key;
  },
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useMediaQuery: () => false,
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => () => null);
jest.mock('./ArtifactAppsAdminSettings', () => () => <button data-testid="mock-admin-settings" />);

const mockUseListArtifactAppsQuery = jest.mocked(useListArtifactAppsQuery);

const apps = [
  {
    artifactAppId: 'quarterly-report',
    title: 'Quarterly Report',
    description: 'Revenue summary',
    category: 'Finance',
    tags: ['forecast'],
    latestVersionNumber: 2,
    status: 'published',
    visibility: 'private',
  },
  {
    artifactAppId: 'team-planner',
    title: 'Team Planner',
    description: 'Coordinate delivery work',
    category: 'Planning',
    tags: ['schedule'],
    latestVersionNumber: 1,
    status: 'draft',
    visibility: 'tenant',
  },
] as TArtifactApp[];

describe('ArtifactAppsList', () => {
  beforeEach(() => {
    mockUseListArtifactAppsQuery.mockReturnValue({
      data: { apps },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useListArtifactAppsQuery>);
  });

  it('renders a Marketplace-style heading, search field, and admin settings action', () => {
    render(
      <BrowserRouter>
        <ArtifactAppsList />
      </BrowserRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Artifacts' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search artifacts' })).toBeInTheDocument();
    expect(screen.getAllByTestId('mock-admin-settings')).not.toHaveLength(0);
  });

  it('filters artifacts by their metadata and shows the no-results state', () => {
    render(
      <BrowserRouter>
        <ArtifactAppsList />
      </BrowserRouter>,
    );

    const search = screen.getByRole('textbox', { name: 'Search artifacts' });
    fireEvent.change(search, { target: { value: 'forecast' } });

    expect(screen.getByText('Quarterly Report')).toBeInTheDocument();
    expect(screen.queryByText('Team Planner')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'missing artifact' } });
    expect(screen.getByText('No artifacts found')).toBeInTheDocument();
  });
});
