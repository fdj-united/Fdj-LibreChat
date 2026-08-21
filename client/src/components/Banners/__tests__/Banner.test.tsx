import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('~/data-provider', () => ({
  useGetBannerQuery: jest.fn(),
}));

jest.mock('recoil', () => ({
  useRecoilState: jest.fn(() => [[], jest.fn()]),
}));

jest.mock('~/store', () => ({
  default: { hideBannerHint: 'hideBannerHint' },
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

jest.mock('lucide-react', () => ({
  XIcon: () => <span data-testid="x-icon" />,
}));

import { useGetBannerQuery } from '~/data-provider';
import { Banner } from '../Banner';

describe('Banner', () => {
  it('applies height-containment classes that prevent sticky banner from consuming the viewport', () => {
    (useGetBannerQuery as jest.Mock).mockReturnValue({
      data: {
        bannerId: 'test-banner',
        message: 'Test message',
        persistable: false,
      },
    });

    const { container } = render(<Banner />);
    const outerDiv = container.firstElementChild;

    expect(outerDiv).toHaveClass('max-h-24');
    expect(outerDiv).toHaveClass('overflow-hidden');
  });
});
