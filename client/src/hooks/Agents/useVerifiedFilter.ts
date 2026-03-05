import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Returns a handler that sets or removes the `verified` URL search param (verified=1 or omit).
 * Preserves all other params and the current path. Use anywhere you need to toggle verified in the URL.
 */
function useVerifiedFilter() {
  const [searchParams, setSearchParams] = useSearchParams();

  return useCallback(
    (verified: boolean) => {
      const newParams = new URLSearchParams(searchParams);
      if (verified) {
        newParams.set('verified', '1');
      } else {
        newParams.delete('verified');
      }
      setSearchParams(newParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );
}

export default useVerifiedFilter;
