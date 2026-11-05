/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import type { AgentForm } from '~/common';
import JiraUseCaseLink, { AI_USE_CASE_COACH_URL } from '../JiraUseCaseLink';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('react-i18next', () => ({
  Trans: ({ components }: { i18nKey: string; components?: { anchor?: React.ReactElement } }) => {
    const { cloneElement } = jest.requireActual<typeof import('react')>('react');
    const anchor = components?.anchor;
    return (
      <span>{anchor != null ? cloneElement(anchor, undefined, 'AI Use Case Coach') : null}</span>
    );
  },
}));

jest.mock('@librechat/client', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');
  return {
    Input: forwardRef<HTMLInputElement, React.ComponentProps<'input'>>((props, ref) => (
      <input {...props} ref={ref} />
    )),
    Label: ({ children, ...props }: React.ComponentProps<'label'>) => (
      <label {...props}>{children}</label>
    ),
    Button: ({
      children,
      variant: _variant,
      ...props
    }: React.ComponentProps<'button'> & { variant?: string }) => (
      <button {...props}>{children}</button>
    ),
    CircleHelpIcon: () => <span />,
    HoverCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    HoverCardPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    HoverCardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    HoverCardTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm<AgentForm>({
    defaultValues: { jiraUseCaseLink: '' },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

describe('JiraUseCaseLink', () => {
  it('renders an optional text field with the governance tooltip link', () => {
    render(
      <Wrapper>
        <JiraUseCaseLink />
      </Wrapper>,
    );

    const input = screen.getByLabelText('com_ui_agent_jira_use_case_link');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).not.toHaveAttribute('required');
    expect(input).toHaveAttribute('placeholder', 'com_ui_agent_jira_use_case_link_placeholder');
    expect(input).toHaveValue('');

    const coachLink = screen.getByRole('link', { name: 'AI Use Case Coach' });
    expect(coachLink).toHaveAttribute('href', AI_USE_CASE_COACH_URL);
    expect(coachLink).toHaveAttribute('target', '_blank');
    expect(coachLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
