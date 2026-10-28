import { useRecoilValue } from 'recoil';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import { isTransientRequestError } from '~/utils/errors';
import store from '~/store';

/** Attempts after the first failed user fetch before the error reaches the auth context. */
export const USER_QUERY_TRANSIENT_RETRIES = 3;

export const useGetUserQuery = (
  config?: UseQueryOptions<t.TUser>,
): QueryObserverResult<t.TUser> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TUser>([QueryKeys.user], () => dataService.getUser(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    /** A dropped connection or a 5xx says nothing about the session, so retry those; a 401/403
     * is a real answer and goes straight to the auth context. */
    retry: (failureCount, error) =>
      failureCount < USER_QUERY_TRANSIENT_RETRIES && isTransientRequestError(error),
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};

export interface UseGraphTokenQueryOptions {
  scopes?: string;
  enabled?: boolean;
}

export const useGraphTokenQuery = (
  options: UseGraphTokenQueryOptions = {},
  config?: UseQueryOptions<any>,
): QueryObserverResult<any> => {
  const { scopes, enabled = false } = options;

  return useQuery({
    queryKey: [QueryKeys.graphToken, scopes],
    queryFn: () => dataService.getGraphApiToken({ scopes: scopes ?? '' }),
    enabled,
    staleTime: 50 * 60 * 1000, // 50 minutes (tokens expire in 60 minutes)
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    ...config,
  });
};
