import { atom } from 'recoil';

export type PresentationFormat = 'text' | 'code' | 'json' | 'markdown';
export type PresentationImportance = 'primary' | 'detail';

export interface PresentationField {
  label: string;
  value: unknown;
  format?: PresentationFormat;
  importance?: PresentationImportance;
}

export interface MCPConfirmationPresentation {
  title?: string;
  summary?: string;
  fields: PresentationField[];
}

export interface MCPPendingConfirmation {
  confirmationId: string;
  serverName: string;
  toolName: string;
  preview: string;
  expiresInSeconds: number;
  expiresAt: number;
  /**
   * Optional structured rendering hints from the gateway. When present, the
   * dialog renders these directly; when absent, it falls back to parsing
   * `preview`. Loosely modelled on MCP elicitation:
   * https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation
   */
  presentation?: MCPConfirmationPresentation;
}

/**
 * Pending MCP tool-call confirmation that requires user review. The backend
 * suspends the agent loop until the user accepts or cancels via
 * POST /api/mcp/confirm/:confirmationId. While set, the modal is shown.
 */
export const pendingMCPConfirmationAtom = atom<MCPPendingConfirmation | null>({
  key: 'pendingMCPConfirmation',
  default: null,
});
