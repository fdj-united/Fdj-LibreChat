import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ArtifactAppsAdminSettings from './ArtifactAppsAdminSettings';

let mockRole = 'ADMIN';

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { role: mockRole } }),
  useLocalize: () => (key: string, values?: { section?: string }) => {
    const translations: Record<string, string> = {
      com_ui_admin_settings: 'Admin Settings',
      com_ui_artifact_apps: 'Artifacts',
      com_ui_artifact_apps_admin_settings_placeholder:
        'Artifact administration options will be added here.',
    };
    if (key === 'com_ui_admin_settings_section') {
      return `Admin Settings - ${values?.section}`;
    }
    return translations[key] ?? key;
  },
}));

describe('ArtifactAppsAdminSettings', () => {
  beforeEach(() => {
    mockRole = 'ADMIN';
  });

  it('opens the placeholder administration dialog for an administrator', async () => {
    const user = userEvent.setup();
    render(<ArtifactAppsAdminSettings />);

    await user.click(screen.getByRole('button', { name: 'Admin Settings' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Admin Settings - Artifacts')).toBeInTheDocument();
    expect(
      screen.getByText('Artifact administration options will be added here.'),
    ).toBeInTheDocument();
  });

  it('does not show the administration action to a non-administrator', () => {
    mockRole = 'USER';
    render(<ArtifactAppsAdminSettings />);

    expect(screen.queryByRole('button', { name: 'Admin Settings' })).not.toBeInTheDocument();
  });
});
