import { QueryKeys } from 'librechat-data-provider';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import useCreditRequestStatus from './useCreditRequestStatus';

const mockUseGetUserBalance = jest.fn();
const mockUseGetStartupConfig = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetUserBalance: () => mockUseGetUserBalance(),
  useGetStartupConfig: () => mockUseGetStartupConfig(),
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ isAuthenticated: true }),
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: jest.fn() }),
}));

function renderUseCreditRequestStatus() {
  const queryClient = new QueryClient();
  // Spied on *before* the first render — the overdue-refill case invalidates
  // synchronously during the mount effect, before any post-render assertion
  // setup would otherwise get a chance to attach the spy.
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, ...renderHook(() => useCreditRequestStatus(), { wrapper }) };
}

describe('useCreditRequestStatus — scheduled refetch on refill eligibility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUseGetStartupConfig.mockReturnValue({ data: { balance: { enabled: true } } });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('invalidates the balance query once the countdown to nextRefillAt elapses, so an idle open tab resyncs on its own', () => {
    mockUseGetUserBalance.mockReturnValue({
      data: {
        tokenCredits: 0,
        autoRefillEnabled: true,
        lastRefill: new Date().toISOString(),
        refillIntervalValue: 5,
        refillIntervalUnit: 'seconds',
      },
    });

    const { invalidateSpy, result } = renderUseCreditRequestStatus();

    expect(result.current.isAutoRefillDue).toBe(false);

    act(() => {
      jest.advanceTimersByTime(6_000);
    });

    expect(invalidateSpy).toHaveBeenCalledWith([QueryKeys.balance]);
    expect(result.current.isAutoRefillDue).toBe(true);
  });

  it('invalidates immediately when the refill is already overdue at mount, not just future ones', () => {
    mockUseGetUserBalance.mockReturnValue({
      data: {
        tokenCredits: 0,
        autoRefillEnabled: true,
        lastRefill: new Date('2020-01-01').toISOString(),
        refillIntervalValue: 1,
        refillIntervalUnit: 'days',
      },
    });

    const { invalidateSpy, result } = renderUseCreditRequestStatus();

    // This is true on the initial render, before the invalidating effect
    // runs, so the obsolete request banner never flashes on screen.
    expect(result.current.isAutoRefillDue).toBe(true);

    act(() => {
      jest.advanceTimersByTime(0);
    });

    expect(invalidateSpy).toHaveBeenCalledWith([QueryKeys.balance]);
  });

  it('does not schedule a check when there is no pending refill to wait for', () => {
    mockUseGetUserBalance.mockReturnValue({ data: { tokenCredits: 1000 } });

    const { invalidateSpy } = renderUseCreditRequestStatus();

    act(() => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does not schedule or retry when the balance is still positive, even with an overdue refill date', () => {
    // `maybeApplyAutoRefill` short-circuits on the server whenever the
    // balance is positive, leaving `lastRefill` untouched on purpose — this
    // is not a stuck/contended case to retry, it's expected steady state
    // for anyone who hasn't exhausted their allocation yet.
    mockUseGetUserBalance.mockReturnValue({
      data: {
        tokenCredits: 500,
        autoRefillEnabled: true,
        lastRefill: new Date('2020-01-01').toISOString(),
        refillIntervalValue: 1,
        refillIntervalUnit: 'days',
      },
    });

    const { invalidateSpy } = renderUseCreditRequestStatus();

    act(() => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('starts scheduling once a positive balance is spent down to zero past an already-overdue deadline', () => {
    const overdueBalance = {
      autoRefillEnabled: true,
      lastRefill: new Date('2020-01-01').toISOString(),
      refillIntervalValue: 1,
      refillIntervalUnit: 'days' as const,
    };
    mockUseGetUserBalance.mockReturnValue({ data: { ...overdueBalance, tokenCredits: 500 } });

    const { invalidateSpy, rerender } = renderUseCreditRequestStatus();
    expect(invalidateSpy).not.toHaveBeenCalled();

    mockUseGetUserBalance.mockReturnValue({ data: { ...overdueBalance, tokenCredits: 0 } });
    rerender();

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff when the deadline fires but the refetch does not move lastRefill forward', () => {
    // Simulates lease contention/a swallowed refill error server-side:
    // `lastRefill` never moves, so `nextRefillAt` never changes identity,
    // so nothing but the retry chain itself would ever check again.
    mockUseGetUserBalance.mockReturnValue({
      data: {
        tokenCredits: 0,
        autoRefillEnabled: true,
        lastRefill: new Date('2020-01-01').toISOString(),
        refillIntervalValue: 1,
        refillIntervalUnit: 'days',
      },
    });

    const { invalidateSpy } = renderUseCreditRequestStatus();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  it('gives up after the bounded number of retries instead of polling forever', () => {
    mockUseGetUserBalance.mockReturnValue({
      data: {
        tokenCredits: 0,
        autoRefillEnabled: true,
        lastRefill: new Date('2020-01-01').toISOString(),
        refillIntervalValue: 1,
        refillIntervalUnit: 'days',
      },
    });

    const { invalidateSpy } = renderUseCreditRequestStatus();

    act(() => {
      // Covers the entire backoff schedule (5s..300s) with margin.
      jest.advanceTimersByTime(10 * 60 * 1000);
    });
    const callsAfterFullSchedule = invalidateSpy.mock.calls.length;
    expect(callsAfterFullSchedule).toBe(7); // 1 initial check + 6 bounded retries

    act(() => {
      jest.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(callsAfterFullSchedule);
  });

  it('abandons the retry chain once the refill actually lands and nextRefillAt moves forward', () => {
    mockUseGetUserBalance.mockReturnValue({
      data: {
        tokenCredits: 0,
        autoRefillEnabled: true,
        lastRefill: new Date('2020-01-01').toISOString(),
        refillIntervalValue: 1,
        refillIntervalUnit: 'days',
      },
    });

    const { invalidateSpy, rerender } = renderUseCreditRequestStatus();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    // The refetch the first invalidate triggered lands a real refill —
    // `lastRefill` moves to now, pushing `nextRefillAt` a full day out.
    mockUseGetUserBalance.mockReturnValue({
      data: {
        tokenCredits: 1000,
        autoRefillEnabled: true,
        lastRefill: new Date().toISOString(),
        refillIntervalValue: 1,
        refillIntervalUnit: 'days',
      },
    });
    rerender();

    act(() => {
      // Would have been the first retry slot under the old (abandoned)
      // deadline — the new deadline isn't due for another day.
      jest.advanceTimersByTime(5_000);
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the scheduled check on unmount, leaving no pending timer behind', () => {
    mockUseGetUserBalance.mockReturnValue({
      data: {
        tokenCredits: 0,
        autoRefillEnabled: true,
        lastRefill: new Date().toISOString(),
        refillIntervalValue: 5,
        refillIntervalUnit: 'seconds',
      },
    });

    const { invalidateSpy, unmount } = renderUseCreditRequestStatus();

    unmount();
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
