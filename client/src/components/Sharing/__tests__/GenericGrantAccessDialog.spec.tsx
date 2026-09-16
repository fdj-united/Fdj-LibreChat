import React from 'react';
import { ResourceType, PrincipalType } from 'librechat-data-provider';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import GenericGrantAccessDialog from '../GenericGrantAccessDialog';
import { getResourceConfig } from '~/utils/resources';

const mockRefetchPermissions = jest.fn();
const mockCopyResourceUrl = jest.fn();
const mockShowToast = jest.fn();
const mockUseResourcePermissionState = jest.fn();
type PeoplePickerTypeFilter = Array<
  PrincipalType.USER | PrincipalType.GROUP | PrincipalType.ROLE
> | null;

const mockUsePeoplePickerPermissions = jest.fn(() => ({
  hasPeoplePickerAccess: true,
  peoplePickerTypeFilter: null as PeoplePickerTypeFilter,
}));
const mockUseCanSharePublic = jest.fn(() => true);

const config = {
  defaultViewerRoleId: 'viewer',
  defaultOwnerRoleId: 'owner',
  getShareMessage: () => 'Share Agent',
  getResourceUrl: () => 'http://localhost/agent/1',
  copyUrlMessageKey: 'com_ui_agent_url_copied',
};

const baseState = (overrides: Record<string, unknown> = {}) => ({
  config,
  permissionsData: { principals: [], public: false },
  isLoadingPermissions: false,
  isFetchingPermissions: false,
  permissionsError: null,
  refetchPermissions: mockRefetchPermissions,
  updatePermissionsMutation: { isLoading: false, mutateAsync: jest.fn() },
  currentShares: [],
  currentIsPublic: false,
  currentPublicRole: 'viewer',
  isPublic: false,
  setIsPublic: jest.fn(),
  publicRole: 'viewer',
  setPublicRole: jest.fn(),
  ...overrides,
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useResourcePermissionState: () => mockUseResourcePermissionState(),
  usePeoplePickerPermissions: () => mockUsePeoplePickerPermissions(),
  useCanSharePublic: () => mockUseCanSharePublic(),
  useCopyToClipboard: () => mockCopyResourceUrl,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('../PeoplePicker/UnifiedPeopleSearch', () => ({
  __esModule: true,
  default: ({ typeFilter }: { typeFilter?: unknown }) => (
    <div
      data-testid="unified-people-search"
      data-type-filter={JSON.stringify(typeFilter ?? null)}
    />
  ),
}));
jest.mock('../PeoplePickerAdminSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="admin-settings" />,
}));
jest.mock('../PublicSharingToggle', () => ({
  __esModule: true,
  default: ({ allowRoleSelection }: { allowRoleSelection?: boolean }) => (
    <div data-testid="public-toggle" data-role-selection={String(allowRoleSelection)} />
  ),
}));
jest.mock('../PeoplePicker', () => ({
  __esModule: true,
  SelectedPrincipalsList: ({ allowRoleSelection }: { allowRoleSelection?: boolean }) => (
    <div data-testid="principals-list" data-role-selection={String(allowRoleSelection)} />
  ),
}));

const renderDialog = () =>
  render(
    <GenericGrantAccessDialog
      resourceDbId="agent-db-1"
      resourceId="agent-1"
      resourceName="Test Agent"
      resourceType={ResourceType.AGENT}
    />,
  );

describe('GenericGrantAccessDialog - permissions load failure', () => {
  beforeEach(() => {
    mockUseResourcePermissionState.mockReset();
    mockRefetchPermissions.mockReset();
    mockCopyResourceUrl.mockReset();
    mockShowToast.mockReset();
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: true,
      peoplePickerTypeFilter: null,
    });
    mockUseCanSharePublic.mockReturnValue(true);
  });

  it.each([
    [ResourceType.ARTIFACT_APP, 'com_ui_artifact_link_copied'],
    [ResourceType.AGENT, 'com_ui_agent_url_copied'],
    [ResourceType.REMOTE_AGENT, 'com_ui_api_endpoint_copied'],
  ])('uses the localized copy toast for %s', (resourceType, message) => {
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ config: getResourceConfig(resourceType) }),
    );
    mockCopyResourceUrl.mockReturnValue(true);
    render(
      <GenericGrantAccessDialog
        resourceDbId="resource-db-1"
        resourceId="resource-1"
        resourceType={resourceType}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_copy_url_to_clipboard' }));
    expect(mockShowToast).toHaveBeenCalledWith({ message, status: 'success' });
  });

  it('renders a compact alert button (not the share trigger, not raw text) when permissions fail to load', () => {
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ permissionsError: new Error('boom'), permissionsData: undefined }),
    );

    const { container } = renderDialog();

    expect(
      screen.getByRole('button', { name: 'com_ui_permissions_failed_load' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_ui_share_var' })).not.toBeInTheDocument();
    expect(container.querySelector('.spinner')).not.toBeInTheDocument();
  });

  it('retries the permissions fetch when the alert button is clicked', () => {
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ permissionsError: new Error('boom'), permissionsData: undefined }),
    );

    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_permissions_failed_load' }));
    expect(mockRefetchPermissions).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner instead of the alert icon while refetching', () => {
    mockUseResourcePermissionState.mockReturnValue(
      baseState({
        permissionsError: new Error('boom'),
        permissionsData: undefined,
        isFetchingPermissions: true,
      }),
    );

    const { container } = renderDialog();

    expect(
      screen.getByRole('button', { name: 'com_ui_permissions_failed_load' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.spinner')).toBeInTheDocument();
  });

  it('renders the normal share trigger and dialog body when permissions load successfully', () => {
    mockUseResourcePermissionState.mockReturnValue(baseState());

    renderDialog();

    expect(
      screen.queryByRole('button', { name: 'com_ui_permissions_failed_load' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));
    expect(screen.getByTestId('unified-people-search')).toBeInTheDocument();
  });

  it('uses fixed viewer access without role dropdowns for artifacts', () => {
    mockUseResourcePermissionState.mockReturnValue(
      baseState({
        config: getResourceConfig(ResourceType.ARTIFACT_APP),
        permissionsData: {
          principals: [
            {
              id: 'artifact-viewer',
              type: 'user',
              name: 'Artifact Viewer',
              accessRoleId: 'artifact_app_viewer',
            },
          ],
          public: false,
        },
      }),
    );

    render(
      <GenericGrantAccessDialog
        resourceDbId="artifact-db-1"
        resourceId="artifact-1"
        resourceName="Test Artifact"
        resourceType={ResourceType.ARTIFACT_APP}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));

    expect(screen.getByTestId('principals-list')).toHaveAttribute('data-role-selection', 'false');
    expect(screen.getByTestId('public-toggle')).toHaveAttribute('data-role-selection', 'false');
  });

  it('counts artifact recipients and public access while excluding the owner', () => {
    const artifactConfig = getResourceConfig(ResourceType.ARTIFACT_APP);
    mockUseResourcePermissionState.mockReturnValue(
      baseState({
        config: artifactConfig,
        currentShares: [
          {
            id: 'artifact-owner',
            type: 'user',
            accessRoleId: artifactConfig?.defaultOwnerRoleId,
          },
          {
            id: 'artifact-viewer',
            type: 'user',
            accessRoleId: artifactConfig?.defaultViewerRoleId,
          },
        ],
        currentIsPublic: true,
      }),
    );

    render(
      <GenericGrantAccessDialog
        resourceDbId="artifact-db-1"
        resourceId="artifact-1"
        resourceName="Test Artifact"
        resourceType={ResourceType.ARTIFACT_APP}
      />,
    );

    const shareButton = screen.getByRole('button', { name: 'com_ui_share_var' });
    expect(within(shareButton).getByText('2')).toBeInTheDocument();
    expect(within(shareButton).queryByText('3')).not.toBeInTheDocument();
  });

  it('shows a share badge for an artifact shared only with everyone', () => {
    const artifactConfig = getResourceConfig(ResourceType.ARTIFACT_APP);
    mockUseResourcePermissionState.mockReturnValue(
      baseState({
        config: artifactConfig,
        currentShares: [
          {
            id: 'artifact-owner',
            type: 'user',
            accessRoleId: artifactConfig?.defaultOwnerRoleId,
          },
        ],
        currentIsPublic: true,
      }),
    );

    render(
      <GenericGrantAccessDialog
        resourceDbId="artifact-db-1"
        resourceId="artifact-1"
        resourceName="Test Artifact"
        resourceType={ResourceType.ARTIFACT_APP}
      />,
    );

    expect(
      within(screen.getByRole('button', { name: 'com_ui_share_var' })).getByText('1'),
    ).toBeInTheDocument();
  });

  it('hides role principals from the artifact app picker for administrators', () => {
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: true,
      peoplePickerTypeFilter: null,
    });
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ config: getResourceConfig(ResourceType.ARTIFACT_APP) }),
    );

    render(
      <GenericGrantAccessDialog
        resourceDbId="artifact-db-1"
        resourceId="artifact-1"
        resourceName="Test Artifact"
        resourceType={ResourceType.ARTIFACT_APP}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));

    expect(screen.getByTestId('unified-people-search')).toHaveAttribute(
      'data-type-filter',
      JSON.stringify([PrincipalType.USER, PrincipalType.GROUP]),
    );
  });

  it('hides role principals from the artifact app picker for role-enabled users', () => {
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: true,
      peoplePickerTypeFilter: [PrincipalType.USER, PrincipalType.GROUP, PrincipalType.ROLE],
    });
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ config: getResourceConfig(ResourceType.ARTIFACT_APP) }),
    );

    render(
      <GenericGrantAccessDialog
        resourceDbId="artifact-db-1"
        resourceId="artifact-1"
        resourceName="Test Artifact"
        resourceType={ResourceType.ARTIFACT_APP}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));

    expect(screen.getByTestId('unified-people-search')).toHaveAttribute(
      'data-type-filter',
      JSON.stringify([PrincipalType.USER, PrincipalType.GROUP]),
    );
  });

  it('hides the artifact app share control when only role visibility is permitted', () => {
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: true,
      peoplePickerTypeFilter: [PrincipalType.ROLE],
    });
    mockUseCanSharePublic.mockReturnValue(false);
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ config: getResourceConfig(ResourceType.ARTIFACT_APP) }),
    );

    render(
      <GenericGrantAccessDialog
        resourceDbId="artifact-db-1"
        resourceId="artifact-1"
        resourceName="Test Artifact"
        resourceType={ResourceType.ARTIFACT_APP}
      />,
    );

    expect(screen.queryByRole('button', { name: 'com_ui_share_var' })).not.toBeInTheDocument();
  });

  it('still renders agent share when only role visibility is permitted', () => {
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: true,
      peoplePickerTypeFilter: [PrincipalType.ROLE],
    });
    mockUseCanSharePublic.mockReturnValue(false);
    mockUseResourcePermissionState.mockReturnValue(baseState());

    renderDialog();

    expect(screen.getByRole('button', { name: 'com_ui_share_var' })).toBeInTheDocument();
  });

  it('keeps the artifact app share control when public sharing is the only destination', () => {
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: true,
      peoplePickerTypeFilter: [PrincipalType.ROLE],
    });
    mockUseCanSharePublic.mockReturnValue(true);
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ config: getResourceConfig(ResourceType.ARTIFACT_APP) }),
    );

    render(
      <GenericGrantAccessDialog
        resourceDbId="artifact-db-1"
        resourceId="artifact-1"
        resourceName="Test Artifact"
        resourceType={ResourceType.ARTIFACT_APP}
      />,
    );

    expect(screen.getByRole('button', { name: 'com_ui_share_var' })).toBeInTheDocument();
  });
});
