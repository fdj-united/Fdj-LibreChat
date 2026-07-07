import { getModelDisplayName } from './modelDisplay';

describe('getModelDisplayName', () => {
  it('formats family-first Claude ids (v4+)', () => {
    expect(getModelDisplayName('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
    expect(getModelDisplayName('claude-opus-4-1')).toBe('Claude Opus 4.1');
    expect(getModelDisplayName('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(getModelDisplayName('claude-haiku-4-5')).toBe('Claude Haiku 4.5');
    expect(getModelDisplayName('claude-fable-5')).toBe('Claude Fable 5');
    expect(getModelDisplayName('claude-sonnet-4-0')).toBe('Claude Sonnet 4.0');
    expect(getModelDisplayName('claude-sonnet-4')).toBe('Claude Sonnet 4');
  });

  it('does not treat a date suffix as a minor version', () => {
    // regression: `-20250514` is a date, not minor `.20250514`
    expect(getModelDisplayName('claude-sonnet-4-20250514')).toBe('Claude Sonnet 4');
    expect(getModelDisplayName('claude-opus-4-20250514')).toBe('Claude Opus 4');
    // a real minor followed by a date keeps the minor, drops the date
    expect(getModelDisplayName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
    expect(getModelDisplayName('claude-opus-4-1-20250805')).toBe('Claude Opus 4.1');
  });

  it('formats version-first Claude ids (v3.x)', () => {
    expect(getModelDisplayName('claude-3-7-sonnet-latest')).toBe('Claude Sonnet 3.7');
    expect(getModelDisplayName('claude-3-5-haiku-20241022')).toBe('Claude Haiku 3.5');
    expect(getModelDisplayName('claude-3-5-sonnet-latest')).toBe('Claude Sonnet 3.5');
    expect(getModelDisplayName('claude-3-opus-20240229')).toBe('Claude Opus 3');
  });

  it('handles bedrock inference-profile ARNs', () => {
    expect(
      getModelDisplayName(
        'arn:aws:bedrock:eu-central-1:029109262688:inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0',
      ),
    ).toBe('Claude Haiku 4.5');
    expect(getModelDisplayName('eu.anthropic.claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
    expect(getModelDisplayName('claude-sonnet-4-6-via-gateway')).toBe('Claude Sonnet 4.6');
  });

  it('formats GPT and Qwen ids', () => {
    expect(getModelDisplayName('gpt-4o-mini')).toBe('GPT-4o mini');
    expect(getModelDisplayName('gpt-4o')).toBe('GPT-4o');
    expect(getModelDisplayName('chatgpt-4o-latest')).toBe('GPT-4o');
    expect(getModelDisplayName('gpt-5.4')).toBe('GPT-5.4');
    expect(getModelDisplayName('gpt-5-nano')).toBe('GPT-5 nano');
    expect(getModelDisplayName('qwen.qwen3-32b-v1:0')).toBe('Qwen 3.32B');
  });

  it('falls back to the raw id for unknown models and empty input', () => {
    expect(getModelDisplayName('some-unknown-model')).toBe('some-unknown-model');
    expect(getModelDisplayName('')).toBe('');
  });
});
