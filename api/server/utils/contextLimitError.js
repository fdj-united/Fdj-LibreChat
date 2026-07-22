const { ErrorTypes } = require('librechat-data-provider');

const EMPTY_MESSAGES_TYPE = 'empty_messages';

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error == null) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object' && typeof error.message === 'string') {
    return error.message;
  }

  return String(error);
}

/**
 * @param {string} message
 * @returns {Record<string, unknown> | null}
 */
function parseEmbeddedJson(message) {
  const firstBrace = message.indexOf('{');
  const lastBrace = message.lastIndexOf('}');

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(message.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} error
 * @returns {string | null}
 */
function getEmptyMessagesInfo(error) {
  const message = getErrorMessage(error);

  if (error && typeof error === 'object' && 'type' in error && error.type === EMPTY_MESSAGES_TYPE) {
    return typeof error.info === 'string' ? error.info : message;
  }

  const json = parseEmbeddedJson(message);
  if (json?.type === EMPTY_MESSAGES_TYPE) {
    return typeof json.info === 'string' ? json.info : message;
  }

  if (/empty_messages|Message pruning removed all messages/i.test(message)) {
    return message;
  }

  return null;
}

/**
 * @param {string} info
 * @param {string} key
 * @returns {number | null}
 */
function readBudgetNumber(info, key) {
  const match = info.match(new RegExp(`${key}:\\s*(-?\\d+)`));
  return match ? Number(match[1]) : null;
}

/**
 * @param {string} info
 * @returns {string}
 */
function formatContextLimitInfo(info) {
  const details = [
    ['maxContextTokens', readBudgetNumber(info, 'maxContextTokens')],
    ['instructionTokens', readBudgetNumber(info, 'instructionTokens')],
    ['messageTokens', readBudgetNumber(info, 'messageTokens')],
    ['availableForMessages', readBudgetNumber(info, 'availableForMessages')],
  ].filter(([, value]) => value != null);

  const summary =
    'No messages fit after pruning because the context window is too small for this agent';

  if (details.length === 0) {
    return summary;
  }

  return `${summary} (${details.map(([key, value]) => `${key}: ${value}`).join(', ')})`;
}

/**
 * Converts the agents SDK "empty_messages" pruning failure into LibreChat's
 * existing typed input-length error so the UI can render a localized message.
 * @param {unknown} error
 * @returns {string | null}
 */
function getContextLimitErrorText(error) {
  const info = getEmptyMessagesInfo(error);

  if (!info) {
    return null;
  }

  return JSON.stringify({
    type: ErrorTypes.INPUT_LENGTH,
    info: formatContextLimitInfo(info),
  });
}

module.exports = {
  getContextLimitErrorText,
  getEmptyMessagesInfo,
  formatContextLimitInfo,
};
