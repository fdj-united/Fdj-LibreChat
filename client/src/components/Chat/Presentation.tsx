import { useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router-dom';
import { useRecoilValue, useResetRecoilState } from 'recoil';
import { FileSources, LocalStorageKeys } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import useResetArtifactsOnConversationChange from '~/hooks/Artifacts/useResetArtifactsOnConversationChange';
import ArtifactCatalogRegistrar from '~/components/ArtifactApps/ArtifactCatalogRegistrar';
import { artifactNavigationRequestAtom } from '~/components/ArtifactApps/navigation';
import DragDropWrapper from '~/components/Chat/Input/Files/DragDropWrapper';
import { EditorProvider, ArtifactsProvider } from '~/Providers';
import { useDeleteFilesMutation } from '~/data-provider';
import Artifacts from '~/components/Artifacts/Artifacts';
import { SidePanelGroup } from '~/components/SidePanel';
import { useSetFilesToDelete } from '~/hooks';
import store from '~/store';

export default function Presentation({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const artifacts = useRecoilValue(store.artifactsState);
  const artifactsVisibility = useRecoilValue(store.artifactsVisibility);
  // Idle history stays closed unless an artifact is focused. A catalog
  // deep link temporarily bypasses that gate so `useArtifacts` can resolve
  // the requested source and focus it after the conversation has rendered.
  const currentArtifactId = useRecoilValue(store.currentArtifactId);
  const artifactNavigationRequest = useAtomValue(artifactNavigationRequestAtom);
  const resetArtifacts = useResetRecoilState(store.artifactsState);
  const resetCurrentArtifactId = useResetRecoilState(store.currentArtifactId);
  const handledArtifactRequestRef = useRef<string | null>(null);
  const hasStateArtifactRequest =
    artifactNavigationRequest != null &&
    location.pathname.endsWith(`/c/${artifactNavigationRequest.conversationId}`);
  const hasArtifactRequest = useMemo(
    () => new URLSearchParams(location.search).has('artifact') || hasStateArtifactRequest,
    [hasStateArtifactRequest, location.search],
  );

  useResetArtifactsOnConversationChange();

  useEffect(() => {
    if (!hasArtifactRequest) {
      handledArtifactRequestRef.current = null;
      return;
    }
    const requestKey = `${location.key}:${location.search}:${artifactNavigationRequest?.sourceKey ?? ''}`;
    if (handledArtifactRequestRef.current === requestKey) {
      return;
    }
    handledArtifactRequestRef.current = requestKey;
    resetArtifacts();
    resetCurrentArtifactId();
  }, [
    hasArtifactRequest,
    location.key,
    location.search,
    resetArtifacts,
    resetCurrentArtifactId,
    artifactNavigationRequest?.sourceKey,
  ]);

  const setFilesToDelete = useSetFilesToDelete();

  const { mutateAsync } = useDeleteFilesMutation({
    onSuccess: () => {
      console.log('Temporary Files deleted');
      setFilesToDelete({});
    },
    onError: (error) => {
      console.log('Error deleting temporary files:', error);
    },
  });

  useEffect(() => {
    const filesToDelete = localStorage.getItem(LocalStorageKeys.FILES_TO_DELETE);
    const map = JSON.parse(filesToDelete ?? '{}') as Record<string, ExtendedFile>;
    const files = Object.values(map)
      .filter(
        (file) =>
          file.filepath != null && file.source && !(file.embedded ?? false) && file.temp_file_id,
      )
      .map((file) => ({
        file_id: file.file_id,
        filepath: file.filepath as string,
        source: file.source as FileSources,
        embedded: !!(file.embedded ?? false),
      }));

    if (files.length === 0) {
      return;
    }
    mutateAsync({ files });
  }, [mutateAsync]);

  const artifactsElement = useMemo(() => {
    if (
      (artifactsVisibility === true || hasArtifactRequest) &&
      (currentArtifactId != null || hasArtifactRequest) &&
      Object.keys(artifacts ?? {}).length > 0
    ) {
      return (
        <EditorProvider>
          <Artifacts />
        </EditorProvider>
      );
    }
    return null;
  }, [artifactsVisibility, artifacts, currentArtifactId, hasArtifactRequest]);

  return (
    <ArtifactsProvider>
      <ArtifactCatalogRegistrar />
      <DragDropWrapper className="relative flex w-full grow overflow-hidden bg-presentation">
        <SidePanelGroup artifacts={artifactsElement}>
          <main className="flex h-full flex-col overflow-y-auto" role="main">
            {children}
          </main>
        </SidePanelGroup>
      </DragDropWrapper>
    </ArtifactsProvider>
  );
}
