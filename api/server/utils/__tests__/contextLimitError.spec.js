const {
  formatContextLimitInfo,
  getContextLimitErrorText,
  getEmptyMessagesInfo,
} = require('../contextLimitError');

describe('contextLimitError', () => {
  it('extracts empty_messages info from embedded SDK JSON', () => {
    const error = new Error(
      'An error occurred while processing the request: {"type":"empty_messages","info":"Message pruning removed all messages as none fit in the context window.\\nToken budget breakdown:\\n maxContextTokens: 500\\n instructionTokens: 613\\n messageTokens: 261\\n availableForMessages: -138"}',
    );

    expect(getEmptyMessagesInfo(error)).toContain('Message pruning removed all messages');
  });

  it('formats the known token budget fields without leaking the raw SDK payload', () => {
    const result = formatContextLimitInfo(
      'Token budget breakdown:\n maxContextTokens: 500\n instructionTokens: 613\n messageTokens: 261\n availableForMessages: -138',
    );

    expect(result).toBe(
      'No messages fit after pruning because the context window is too small for this agent (maxContextTokens: 500, instructionTokens: 613, messageTokens: 261, availableForMessages: -138)',
    );
  });

  it('converts empty_messages into the existing typed input length error', () => {
    const error = new Error(
      '{"type":"empty_messages","info":"Token budget breakdown:\\n maxContextTokens: 500\\n instructionTokens: 613\\n messageTokens: 261\\n availableForMessages: -138"}',
    );

    expect(JSON.parse(getContextLimitErrorText(error))).toEqual({
      type: 'INPUT_LENGTH',
      info: 'No messages fit after pruning because the context window is too small for this agent (maxContextTokens: 500, instructionTokens: 613, messageTokens: 261, availableForMessages: -138)',
    });
  });

  it('ignores unrelated errors', () => {
    expect(getContextLimitErrorText(new Error('Provider failed'))).toBeNull();
  });
});
