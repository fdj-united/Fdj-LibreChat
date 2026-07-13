import { renderHook } from '@testing-library/react';
import { QueryKeys, EModelEndpoint } from 'librechat-data-provider';
import useDragHelpers from '../useDragHelpers';

/** Captures the drop spec handed to `useDrop` so `handleDrop` can be invoked directly. */
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

const mockHandleFiles = jest.fn();
jest.mock('../useFileHandling', () => ({
  __esModule: true,
  default: () => ({ handleFiles: mockHandleFiles }),
}));

jest.mock('../../useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

jest.mock('~/common', () => ({
  isEphemeralAgent: (id?: string | null) => !id?.startsWith('agent_'),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { conversationByIndex: jest.fn(() => 'conversationAtom') },
  ephemeralAgentByConvoId: jest.fn(() => 'ephemeralAgentAtom'),
}));

const mockConversation: { endpoint: string; agent_id?: string; conversationId: string } = {
  endpoint: EModelEndpoint.agents,
  agent_id: 'agent_123',
  conversationId: 'convo-1',
};

jest.mock('recoil', () => ({
  useRecoilValue: () => mockConversation,
  useSetRecoilState: () => jest.fn(),
}));

const mockGetQueryData = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: mockGetQueryData }),
}));

type Agent = { id: string; tools?: string[] } & Record<string, unknown>;

/**
 * `capabilities: []` means no file_search / execute_code / context option is available, which is
 * the branch that previously fell through to a direct provider upload with no modal.
 */
const primeCache = ({ agent, capabilities = [] }: { agent?: Agent; capabilities?: string[] }) => {
  mockGetQueryData.mockImplementation((key: unknown[]) => {
    if (key[0] === QueryKeys.endpoints) {
      return { [EModelEndpoint.agents]: { capabilities } };
    }
    if (key[0] === QueryKeys.agent) {
      return agent;
    }
    return undefined;
  });
};

const drop = (files: File[]) => {
  renderHook(() => useDragHelpers());
  dropSpec.drop({ files });
};

const pdf = () => new File(['x'], 'doc.pdf', { type: 'application/pdf' });
const png = () => new File(['x'], 'pic.png', { type: 'image/png' });

describe('useDragHelpers - per-agent upload opt-outs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConversation.agent_id = 'agent_123';
  });

  it('uploads directly when no modal option exists and the agent permits provider upload', () => {
    primeCache({ agent: { id: 'agent_123', tools: [] } });

    drop([pdf()]);

    expect(mockHandleFiles).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does not silently provider-upload when the agent disables provider upload', () => {
    primeCache({ agent: { id: 'agent_123', tools: [], disable_provider_upload: true } });

    drop([pdf()]);

    expect(mockHandleFiles).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_attach_error_agent_disabled' }),
    );
  });

  it('does not offer an image-only drop when provider upload is disabled, even with context enabled', () => {
    /** An image-only drop resolves to a direct provider upload, so the context capability must not
     * keep the modal (and its `value: undefined` row) alive when provider upload is disabled. */
    primeCache({
      agent: { id: 'agent_123', tools: [], disable_provider_upload: true },
      capabilities: ['context'],
    });

    drop([png()]);

    expect(mockHandleFiles).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_attach_error_agent_disabled' }),
    );
  });

  it('leaves non-agent conversations untouched', () => {
    mockConversation.agent_id = undefined;
    primeCache({});

    drop([pdf()]);

    expect(mockHandleFiles).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});
