import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import PublicSharingToggle from '../PublicSharingToggle';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('../AccessRolesPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="access-role-picker" />,
}));

describe('PublicSharingToggle', () => {
  it('hides the permission level when public sharing uses a fixed role', () => {
    render(
      <PublicSharingToggle
        isPublic={true}
        onPublicToggle={jest.fn()}
        onPublicRoleChange={jest.fn()}
        allowRoleSelection={false}
      />,
    );

    expect(screen.getByRole('switch', { name: 'com_ui_share_everyone' })).toBeInTheDocument();
    expect(screen.queryByText('com_ui_everyone_permission_level')).not.toBeInTheDocument();
    expect(screen.queryByTestId('access-role-picker')).not.toBeInTheDocument();
  });

  it('collapses the permission row while sharing is disabled and reveals it when enabled', () => {
    const { rerender } = render(
      <PublicSharingToggle
        isPublic={false}
        onPublicToggle={jest.fn()}
        onPublicRoleChange={jest.fn()}
      />,
    );

    const permissionLabel = screen.getByText('com_ui_everyone_permission_level');
    const collapse = permissionLabel.closest('[aria-hidden="true"]');

    expect(collapse).toHaveClass('max-h-0', 'opacity-0');
    expect(collapse).toHaveStyle({ overflow: 'hidden' });

    rerender(
      <PublicSharingToggle
        isPublic={true}
        onPublicToggle={jest.fn()}
        onPublicRoleChange={jest.fn()}
      />,
    );

    expect(collapse).toHaveClass('max-h-32', 'opacity-100');
    expect(collapse).toHaveStyle({ overflow: 'visible' });
    expect(permissionLabel.closest('.rounded-lg')).toHaveClass('bg-surface-secondary/50');
  });

  it('does not clip the open permission row, so the inline role menu can escape the box', () => {
    render(
      <PublicSharingToggle
        isPublic={true}
        onPublicToggle={jest.fn()}
        onPublicRoleChange={jest.fn()}
      />,
    );

    const permissionLabel = screen.getByText('com_ui_everyone_permission_level');
    const collapse = permissionLabel.closest('[aria-hidden="false"]');
    expect(collapse).toHaveStyle({ overflow: 'visible' });
  });
});
