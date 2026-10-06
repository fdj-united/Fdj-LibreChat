import { renderHook } from '@testing-library/react';
import type { TArtifactAppWithVersion } from 'librechat-data-provider';
import { useRestoreArtifactAppMutation } from '~/data-provider/ArtifactApps/mutations';
import { useGetArtifactAppBySourceQuery } from '~/data-provider';
import useArtifactCatalogSync from '../useArtifactCatalogSync';
import useHasAccess from '~/hooks/Roles/useHasAccess';
import { useArtifactsContext } from '~/Providers';

jest.mock('~/data-provider', () => ({
  useGetArtifactAppBySourceQuery: jest.fn(),
}));

jest.mock('~/data-provider/ArtifactApps/mutations', () => ({
  useRestoreArtifactAppMutation: jest.fn(),
}));

jest.mock('~/hooks/Roles/useHasAccess', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('~/Providers', () => ({
  useArtifactsContext: jest.fn(),
}));

const useGetArtifactAppBySourceQueryMock = useGetArtifactAppBySourceQuery as unknown as jest.Mock;
const useRestoreArtifactAppMutationMock = useRestoreArtifactAppMutation as unknown as jest.Mock;
const useHasAccessMock = useHasAccess as unknown as jest.Mock;
const useArtifactsContextMock = useArtifactsContext as unknown as jest.Mock;

const artifact = {
  id: 'artifact-1',
  messageId: 'message-1',
  index: 0,
  type: 'text/html',
  content: '<h1>Artifact</h1>',
  lastUpdateTime: 1,
};

describe('useArtifactCatalogSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useHasAccessMock.mockReturnValue(true);
    useArtifactsContextMock.mockReturnValue({
      conversationId: 'conversation-1',
      isSubmitting: false,
    });
    useRestoreArtifactAppMutationMock.mockReturnValue({
      mutateAsync: jest.fn(),
      isLoading: false,
    });
  });

  it('keeps the restored artifact available when a stale deleted response arrives', () => {
    const restoredEntry = {
      app: { artifactAppId: 'app-1', createdBy: 'user-1' },
      version: { artifactVersionId: 'version-1' },
    } as TArtifactAppWithVersion;
    useGetArtifactAppBySourceQueryMock.mockReturnValue({
      data: restoredEntry,
      error: { response: { status: 410 } },
      isLoading: false,
    });

    const { result } = renderHook(() => useArtifactCatalogSync(artifact));

    expect(result.current.artifactEntry).toBe(restoredEntry.app);
    expect(result.current.isDeleted).toBe(false);
  });

  it('offers restoration when the source only has a deleted response', () => {
    useGetArtifactAppBySourceQueryMock.mockReturnValue({
      data: undefined,
      error: { response: { status: 410 } },
      isLoading: false,
    });

    const { result } = renderHook(() => useArtifactCatalogSync(artifact));

    expect(result.current.artifactEntry).toBeUndefined();
    expect(result.current.isDeleted).toBe(true);
  });
});
