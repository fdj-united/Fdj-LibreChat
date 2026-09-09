import { getArtifactMimeType } from './runtime';

describe('getArtifactMimeType', () => {
  it.each([
    ['react', 'application/vnd.react'],
    ['html', 'text/html'],
    ['mermaid', 'application/vnd.mermaid'],
  ] as const)('maps %s snapshots to %s artifacts', (runtimeType, expected) => {
    expect(getArtifactMimeType(runtimeType)).toBe(expected);
  });
});
