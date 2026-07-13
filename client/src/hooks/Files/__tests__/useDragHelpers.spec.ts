import { renderHook } from '@testing-library/react';
import { EToolResources } from 'librechat-data-provider';
import useDragHelpers from '../useDragHelpers';

let dropSpec: { drop: (item: { files: File[] }) => void };

jest.mock('react-dnd', () => ({
  useDrop: (specFactory: () => { drop: (item: { files: File[] }) => void }) => {
    dropSpec = specFactory();
    return [{ isOver: false, canDrop: false }, jest.fn()];
  },
}));

const mockShowToast = jest.fn();
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const mockRouteFiles = jest.fn();
jest.mock('../useFileUploadRouter', () => ({
  __esModule: true,
  default: () => mockRouteFiles,
}));

const mockGetOptions = jest.fn();
const mockUploadState = {
  isConfigResolved: true,
  isUnifiedMode: true,
  uploadsDisabled: false,
  providerUploadAllowedByAgent: true,
  contextUploadAllowedByAgent: true,
};
jest.mock('../useUploadOptions', () => ({
  __esModule: true,
  default: () => ({ ...mockUploadState, getOptions: mockGetOptions }),
}));

const mockOpenModal = jest.fn();
jest.mock('~/Providers', () => ({
  useUploadModalContext: () => ({ openModal: mockOpenModal }),
}));

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: () => ({ conversation: { endpoint: 'agents' } }),
}));

jest.mock('../../useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

const pdf = () => new File(['x'], 'doc.pdf', { type: 'application/pdf' });

const drop = (files: File[]) => {
  renderHook(() => useDragHelpers());
  dropSpec.drop({ files });
};

describe('useDragHelpers - per-agent upload opt-outs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockUploadState, {
      isConfigResolved: true,
      isUnifiedMode: true,
      uploadsDisabled: false,
      providerUploadAllowedByAgent: true,
      contextUploadAllowedByAgent: true,
    });
    mockGetOptions.mockReturnValue([undefined, EToolResources.context]);
  });

  it('keeps ordinary unified uploads implicit when no agent route is restricted', () => {
    const files = [pdf()];
    drop(files);

    expect(mockRouteFiles).toHaveBeenCalledWith(files);
    expect(mockOpenModal).not.toHaveBeenCalled();
  });

  it('does not silently provider-upload when the agent has no viable destination', () => {
    mockUploadState.providerUploadAllowedByAgent = false;
    mockGetOptions.mockReturnValue([]);

    drop([pdf()]);

    expect(mockRouteFiles).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_attach_error_agent_disabled',
      status: 'error',
    });
  });

  it('routes directly to the sole allowed destination in unified mode', () => {
    mockUploadState.providerUploadAllowedByAgent = false;
    mockGetOptions.mockReturnValue([EToolResources.context]);
    const files = [pdf()];

    drop(files);

    expect(mockRouteFiles).toHaveBeenCalledWith(files, EToolResources.context);
  });

  it('opens the chooser when an opt-out leaves multiple viable destinations', () => {
    mockUploadState.providerUploadAllowedByAgent = false;
    mockGetOptions.mockReturnValue([EToolResources.context, EToolResources.execute_code]);
    const files = [pdf()];

    drop(files);

    expect(mockOpenModal).toHaveBeenCalledWith(files);
    expect(mockRouteFiles).not.toHaveBeenCalled();
  });
});
