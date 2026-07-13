import { render, screen } from '@testing-library/react';
import {
  EModelEndpoint,
  isDocumentSupportedProvider,
  inferMimeType,
} from 'librechat-data-provider';
import DragDropModal from '../DragDropModal';

jest.mock('~/hooks', () => ({
  useAgentToolPermissions: jest.fn(),
  useAgentCapabilities: jest.fn(),
  useGetAgentsConfig: jest.fn(),
  useLocalize: jest.fn(),
}));

jest.mock('~/Providers', () => ({
  useDragDropContext: jest.fn(),
}));

jest.mock('~/store', () => ({
  ephemeralAgentByConvoId: jest.fn(() => 'ephemeralAgent'),
}));

jest.mock('recoil', () => ({
  useRecoilValue: jest.fn(() => null),
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    OGDialog: (props: { children?: React.ReactNode }) =>
      R.createElement('div', null, props.children),
    OGDialogTemplate: (props: { main?: React.ReactNode }) =>
      R.createElement('div', null, props.main),
  };
});

const mockUseAgentToolPermissions = jest.requireMock('~/hooks').useAgentToolPermissions;
const mockUseAgentCapabilities = jest.requireMock('~/hooks').useAgentCapabilities;
const mockUseGetAgentsConfig = jest.requireMock('~/hooks').useGetAgentsConfig;
const mockUseLocalize = jest.requireMock('~/hooks').useLocalize;
const mockUseDragDropContext = jest.requireMock('~/Providers').useDragDropContext;

describe('DragDropModal - Provider Detection', () => {
  describe('endpointType priority over currentProvider', () => {
    it('should show upload option for LiteLLM with OpenAI endpointType', () => {
      const currentProvider = 'litellm'; // NOT in documentSupportedProviders
      const endpointType = EModelEndpoint.openAI; // IS in documentSupportedProviders

      // With fix: endpointType checked
      const withFix =
        isDocumentSupportedProvider(endpointType) || isDocumentSupportedProvider(currentProvider);
      expect(withFix).toBe(true);

      // Without fix: only currentProvider checked = false
      const withoutFix = isDocumentSupportedProvider(currentProvider || endpointType);
      expect(withoutFix).toBe(false);
    });

    it('should show upload option for any custom gateway with OpenAI endpointType', () => {
      const currentProvider = 'my-custom-gateway';
      const endpointType = EModelEndpoint.openAI;

      const result =
        isDocumentSupportedProvider(endpointType) || isDocumentSupportedProvider(currentProvider);
      expect(result).toBe(true);
    });

    it('should fallback to currentProvider when endpointType is undefined', () => {
      const currentProvider = EModelEndpoint.openAI;
      const endpointType = undefined;

      const result =
        isDocumentSupportedProvider(endpointType) || isDocumentSupportedProvider(currentProvider);
      expect(result).toBe(true);
    });

    it('should fallback to currentProvider when endpointType is null', () => {
      const currentProvider = EModelEndpoint.anthropic;
      const endpointType = null;

      const result =
        isDocumentSupportedProvider(endpointType as any) ||
        isDocumentSupportedProvider(currentProvider);
      expect(result).toBe(true);
    });

    it('should return false when neither provider supports documents', () => {
      const currentProvider = 'unsupported-provider';
      const endpointType = 'unsupported-endpoint' as any;

      const result =
        isDocumentSupportedProvider(endpointType) || isDocumentSupportedProvider(currentProvider);
      expect(result).toBe(false);
    });
  });

  describe('supported providers', () => {
    const supportedProviders = [
      { name: 'OpenAI', value: EModelEndpoint.openAI },
      { name: 'Anthropic', value: EModelEndpoint.anthropic },
      { name: 'Google', value: EModelEndpoint.google },
      { name: 'Custom', value: EModelEndpoint.custom },
    ];

    supportedProviders.forEach(({ name, value }) => {
      it(`should recognize ${name} as supported`, () => {
        expect(isDocumentSupportedProvider(value)).toBe(true);
      });
    });

    it('should NOT recognize Azure OpenAI as supported (requires useResponsesApi)', () => {
      expect(isDocumentSupportedProvider(EModelEndpoint.azureOpenAI)).toBe(false);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle LiteLLM gateway pointing to OpenAI', () => {
      const scenario = {
        currentProvider: 'litellm',
        endpointType: EModelEndpoint.openAI,
      };

      expect(
        isDocumentSupportedProvider(scenario.endpointType) ||
          isDocumentSupportedProvider(scenario.currentProvider),
      ).toBe(true);
    });

    it('should handle direct OpenAI connection', () => {
      const scenario = {
        currentProvider: EModelEndpoint.openAI,
        endpointType: EModelEndpoint.openAI,
      };

      expect(
        isDocumentSupportedProvider(scenario.endpointType) ||
          isDocumentSupportedProvider(scenario.currentProvider),
      ).toBe(true);
    });

    it('should handle unsupported custom endpoint without override', () => {
      const scenario = {
        currentProvider: 'my-unsupported-endpoint',
        endpointType: undefined,
      };

      expect(
        isDocumentSupportedProvider(scenario.endpointType) ||
          isDocumentSupportedProvider(scenario.currentProvider),
      ).toBe(false);
    });
    it('should handle agents endpoints with document supported providers', () => {
      const scenario = {
        currentProvider: EModelEndpoint.google,
        endpointType: EModelEndpoint.agents,
      };

      expect(
        isDocumentSupportedProvider(scenario.endpointType) ||
          isDocumentSupportedProvider(scenario.currentProvider),
      ).toBe(true);
    });

    it('should handle Azure OpenAI endpointType when Responses API is enabled', () => {
      const scenario = {
        currentProvider: EModelEndpoint.agents,
        endpointType: EModelEndpoint.azureOpenAI,
        useResponsesApi: true,
      };

      const isAzureWithResponsesApi =
        (scenario.currentProvider === EModelEndpoint.azureOpenAI ||
          scenario.endpointType === EModelEndpoint.azureOpenAI) &&
        scenario.useResponsesApi === true;

      expect(
        isDocumentSupportedProvider(scenario.endpointType) ||
          isDocumentSupportedProvider(scenario.currentProvider) ||
          isAzureWithResponsesApi,
      ).toBe(true);
    });
  });

  describe('HEIC/HEIF file type inference', () => {
    it('should infer image/heic for .heic files when browser returns empty type', () => {
      const fileName = 'photo.heic';
      const browserType = '';

      const inferredType = inferMimeType(fileName, browserType);
      expect(inferredType).toBe('image/heic');
    });

    it('should infer image/heif for .heif files when browser returns empty type', () => {
      const fileName = 'photo.heif';
      const browserType = '';

      const inferredType = inferMimeType(fileName, browserType);
      expect(inferredType).toBe('image/heif');
    });

    it('should handle uppercase .HEIC extension', () => {
      const fileName = 'IMG_1234.HEIC';
      const browserType = '';

      const inferredType = inferMimeType(fileName, browserType);
      expect(inferredType).toBe('image/heic');
    });

    it('should preserve browser-provided type when available', () => {
      const fileName = 'photo.jpg';
      const browserType = 'image/jpeg';

      const inferredType = inferMimeType(fileName, browserType);
      expect(inferredType).toBe('image/jpeg');
    });

    it('should not override browser type even if extension differs', () => {
      const fileName = 'renamed.heic';
      const browserType = 'image/png';

      const inferredType = inferMimeType(fileName, browserType);
      expect(inferredType).toBe('image/png');
    });

    it('should correctly identify HEIC as image type for upload options', () => {
      const heicType = inferMimeType('photo.heic', '');
      expect(heicType.startsWith('image/')).toBe(true);
    });

    it('should return empty string for unknown extension with no browser type', () => {
      const fileName = 'file.xyz';
      const browserType = '';

      const inferredType = inferMimeType(fileName, browserType);
      expect(inferredType).toBe('');
    });
  });
});

describe('DragDropModal - per-agent upload opt-outs', () => {
  const pdf = () => new File(['x'], 'doc.pdf', { type: 'application/pdf' });
  const png = () => new File(['x'], 'pic.png', { type: 'image/png' });

  const renderModal = (permissions: Record<string, unknown> = {}, files: File[] = [pdf()]) => {
    mockUseLocalize.mockReturnValue((key: string) => key);
    mockUseGetAgentsConfig.mockReturnValue({ agentsConfig: {} });
    mockUseAgentCapabilities.mockReturnValue({
      contextEnabled: true,
      fileSearchEnabled: false,
      codeEnabled: false,
    });
    /** openAI endpointType is document-supported, so the provider option is offered unless the
     * agent opts out — which is exactly what these tests pin. */
    mockUseDragDropContext.mockReturnValue({
      conversationId: 'convo-1',
      agentId: 'agent_123',
      endpoint: EModelEndpoint.agents,
      endpointType: EModelEndpoint.openAI,
      useResponsesApi: false,
    });
    mockUseAgentToolPermissions.mockReturnValue({
      fileSearchAllowedByAgent: false,
      codeAllowedByAgent: false,
      providerUploadAllowedByAgent: true,
      contextUploadAllowedByAgent: true,
      provider: EModelEndpoint.openAI,
      ...permissions,
    });

    render(
      <DragDropModal isVisible files={files} onOptionSelect={jest.fn()} setShowModal={jest.fn()} />,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers the provider upload option when the agent allows it', () => {
    renderModal();
    expect(screen.queryByText('com_ui_upload_provider')).not.toBeNull();
  });

  it('does not offer the provider upload option when the agent disables it', () => {
    renderModal({ providerUploadAllowedByAgent: false });
    expect(screen.queryByText('com_ui_upload_provider')).toBeNull();
  });

  it('does not offer the context upload option when the agent disables it', () => {
    renderModal({ contextUploadAllowedByAgent: false });
    expect(screen.queryByText('com_ui_upload_file')).toBeNull();
  });

  /**
   * For an image-only drop the context row is emitted with `value: undefined`, which is the same
   * direct provider upload the provider row performs (no `tool_resource` is appended downstream).
   * It must therefore follow the provider opt-out, not the context one.
   */
  it('hides the context row for an image-only drop when provider upload is disabled', () => {
    renderModal({ providerUploadAllowedByAgent: false, contextUploadAllowedByAgent: true }, [
      png(),
    ]);

    expect(screen.queryByText('com_ui_upload_provider')).toBeNull();
    expect(screen.queryByText('com_ui_upload_file')).toBeNull();
  });

  it('still offers the context row for an image-only drop when provider upload is allowed', () => {
    renderModal({ providerUploadAllowedByAgent: true, contextUploadAllowedByAgent: true }, [png()]);

    expect(screen.queryByText('com_ui_upload_file')).not.toBeNull();
  });

  it('offers the context row for a non-image drop even when provider upload is disabled', () => {
    /** A PDF maps to `EToolResources.context`, a genuine context upload, so it is governed by the
     * context opt-out and remains available. */
    renderModal({ providerUploadAllowedByAgent: false, contextUploadAllowedByAgent: true }, [
      pdf(),
    ]);

    expect(screen.queryByText('com_ui_upload_provider')).toBeNull();
    expect(screen.queryByText('com_ui_upload_file')).not.toBeNull();
  });
});
