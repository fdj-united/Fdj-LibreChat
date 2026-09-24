import type { SettingDefinition } from './generate';
import { applyModelAwareDefaults, paramSettings } from './parameterSettings';
import { EModelEndpoint, BedrockProviders } from './types';

const googleParams = paramSettings[EModelEndpoint.google] as SettingDefinition[];
const anthropicParams = paramSettings[EModelEndpoint.anthropic] as SettingDefinition[];
const bedrockAnthropicParams = paramSettings[
  `${EModelEndpoint.bedrock}-${BedrockProviders.Anthropic}`
] as SettingDefinition[];
const maxOut = (params: SettingDefinition[]) => params.find((p) => p.key === 'maxOutputTokens');
const hasSetting = (params: SettingDefinition[], key: string) =>
  params.some((setting) => setting.key === key);

describe('applyModelAwareDefaults', () => {
  it('resolves the Google maxOutputTokens default for current Gemini models', () => {
    const result = applyModelAwareDefaults(googleParams, EModelEndpoint.google, 'gemini-2.5-pro');
    expect(maxOut(result)?.default).toBe(65535);
  });

  it('resolves the legacy default for older Gemini models', () => {
    const result = applyModelAwareDefaults(googleParams, EModelEndpoint.google, 'gemini-1.5-flash');
    expect(maxOut(result)?.default).toBe(8192);
  });

  it('resolves the image default for Gemini image models', () => {
    const result = applyModelAwareDefaults(
      googleParams,
      EModelEndpoint.google,
      'gemini-2.5-flash-image',
    );
    expect(maxOut(result)?.default).toBe(32768);
  });

  it('returns settings unchanged for non-Google endpoints', () => {
    const result = applyModelAwareDefaults(
      googleParams,
      EModelEndpoint.anthropic,
      'gemini-2.5-pro',
    );
    expect(result).toBe(googleParams);
  });

  it('hides unsupported thinking and sampling controls for Opus 5.5', () => {
    const result = applyModelAwareDefaults(
      anthropicParams,
      EModelEndpoint.anthropic,
      'claude-opus-5-5',
    );

    expect(hasSetting(result, 'thinking')).toBe(false);
    expect(hasSetting(result, 'thinkingBudget')).toBe(false);
    expect(hasSetting(result, 'temperature')).toBe(false);
    expect(hasSetting(result, 'topP')).toBe(false);
    expect(hasSetting(result, 'topK')).toBe(false);
    expect(hasSetting(result, 'effort')).toBe(true);
  });

  it('applies the Opus 5.5 filter to Bedrock model ids', () => {
    const result = applyModelAwareDefaults(
      bedrockAnthropicParams,
      EModelEndpoint.bedrock,
      'eu.anthropic.claude-opus-5-5',
    );

    expect(hasSetting(result, 'thinking')).toBe(false);
    expect(hasSetting(result, 'temperature')).toBe(false);
    expect(result.length).toBeGreaterThan(0);
  });

  it('keeps thinking and sampling controls for Opus 5', () => {
    const result = applyModelAwareDefaults(
      anthropicParams,
      EModelEndpoint.anthropic,
      'claude-opus-5',
    );
    expect(result).toBe(anthropicParams);
  });

  it('returns settings unchanged when no model is provided', () => {
    expect(applyModelAwareDefaults(googleParams, EModelEndpoint.google, '')).toBe(googleParams);
  });

  it('does not mutate the original settings', () => {
    const before = maxOut(googleParams)?.default;
    applyModelAwareDefaults(googleParams, EModelEndpoint.google, 'gemini-2.5-pro');
    expect(maxOut(googleParams)?.default).toBe(before);
  });

  it('lets a configured override applied afterward take precedence', () => {
    const modelAware = applyModelAwareDefaults(
      googleParams,
      EModelEndpoint.google,
      'gemini-2.5-pro',
    );
    const override = { ...maxOut(modelAware), default: 2048 } as SettingDefinition;
    const final = modelAware.map((p) => (p.key === 'maxOutputTokens' ? override : p));
    expect(maxOut(final)?.default).toBe(2048);
  });
});
