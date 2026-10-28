import { AxiosError } from 'axios';
import { isTransientRequestError } from './errors';

describe('isTransientRequestError', () => {
  it('treats a request that got no response as transient', () => {
    expect(isTransientRequestError(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(true);
  });

  it.each([500, 502, 503, 504])('treats an HTTP %p as transient', (status) => {
    const error = new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status,
    } as never);
    expect(isTransientRequestError(error)).toBe(true);
  });

  it.each([400, 401, 403, 404, 429])('treats an HTTP %p as a real answer', (status) => {
    const error = new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      status,
    } as never);
    expect(isTransientRequestError(error)).toBe(false);
  });

  it('does not treat a plain error without a status as transient', () => {
    expect(isTransientRequestError(new Error('No session'))).toBe(false);
  });

  it('reads a status from a non-Axios error object', () => {
    expect(isTransientRequestError({ status: 503 })).toBe(true);
    expect(isTransientRequestError({ status: 401 })).toBe(false);
  });
});
