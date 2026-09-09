import type { ArtifactRuntimeType } from 'librechat-data-provider';

const ARTIFACT_MIME_TYPES: Record<ArtifactRuntimeType, string> = {
  react: 'application/vnd.react',
  html: 'text/html',
  mermaid: 'application/vnd.mermaid',
};

export function getArtifactMimeType(runtimeType: ArtifactRuntimeType): string {
  return ARTIFACT_MIME_TYPES[runtimeType];
}
