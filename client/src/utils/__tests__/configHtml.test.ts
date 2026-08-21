import {
  BANNER_CSS_VALIDATORS,
  CONFIG_HTML_BANNER_ATTR,
  CONFIG_HTML_BANNER_TAGS,
  CONFIG_HTML_BLOCK_TAGS,
  CONFIG_HTML_CLASS_ATTR,
  CONFIG_HTML_INLINE_TAGS,
  CONFIG_HTML_MEDIA_ATTR,
  CONFIG_HTML_MEDIA_TAGS,
  createConfigHtmlSanitizer,
  sanitizeConfigHtml,
} from '../configHtml';

describe('configHtml', () => {
  it('removes active attributes and unsupported elements', () => {
    const sanitized = sanitizeConfigHtml(
      '<img src=x onerror="alert(1)"><a href="javascript:alert(1)" onclick="alert(1)"><strong>Learn</strong></a><script>alert(1)</script><svg onload="alert(1)"></svg>',
    );

    expect(sanitized).toBe(
      '<a target="_blank" rel="noopener noreferrer"><strong>Learn</strong></a>',
    );
  });

  it('keeps configured rich text tags and normalizes links', () => {
    const sanitize = createConfigHtmlSanitizer({
      allowedTags: CONFIG_HTML_BLOCK_TAGS,
      allowedAttr: CONFIG_HTML_CLASS_ATTR,
    });
    const sanitized = sanitize(
      '<p class="notice">Read <a href="https://example.com" target="_self"><strong>more</strong></a><br><code>safe</code></p>',
    );

    expect(sanitized).toBe(
      '<p class="notice">Read <a href="https://example.com" target="_blank" rel="noopener noreferrer"><strong>more</strong></a><br><code>safe</code></p>',
    );
  });

  it('keeps relative links but removes protocol-relative links', () => {
    const sanitize = createConfigHtmlSanitizer({
      allowedTags: CONFIG_HTML_INLINE_TAGS,
    });
    const sanitized = sanitize(
      '<a href="/docs">Docs</a> <a href="//example.com/remote">Remote</a>',
    );

    expect(sanitized).toBe(
      '<a href="/docs" target="_blank" rel="noopener noreferrer">Docs</a> <a target="_blank" rel="noopener noreferrer">Remote</a>',
    );
  });

  it('keeps inline images with safe sources under media tags', () => {
    const sanitize = createConfigHtmlSanitizer({
      allowedTags: CONFIG_HTML_MEDIA_TAGS,
      allowedAttr: CONFIG_HTML_MEDIA_ATTR,
    });
    const sanitized = sanitize(
      '<span>Powered by <img src="/assets/brand.svg" alt="Brand" onerror="alert(1)"> AI</span><img src="javascript:alert(1)">',
    );

    expect(sanitized).toBe(
      '<span>Powered by <img src="/assets/brand.svg" alt="Brand"> AI</span><img>',
    );
  });
});

describe('banner sanitizer', () => {
  const makeBannerSanitize = () =>
    createConfigHtmlSanitizer({
      allowedTags: CONFIG_HTML_BANNER_TAGS,
      allowedAttr: CONFIG_HTML_BANNER_ATTR,
      cssValidators: BANNER_CSS_VALIDATORS,
    });

  it('preserves safe banner styles', () => {
    const sanitize = makeBannerSanitize();
    const result = sanitize(
      '<div style="background-color: #040458; color: white; padding: 14px 16px; margin: -1px -16px;">Message</div>',
    );
    expect(result).toContain('background-color');
    expect(result).toMatch(/(?<!-)color\s*:/);
    expect(result).toContain('padding');
    expect(result).toContain('margin');
  });

  it('strips layout-takeover properties: transform, display, position', () => {
    const sanitize = makeBannerSanitize();
    const result = sanitize(
      '<div style="transform: translateY(100vh) scale(1000); display: none; position: fixed; background-color: red;">x</div>',
    );
    expect(result).not.toMatch(/transform\s*:/);
    expect(result).not.toMatch(/\bdisplay\s*:/);
    expect(result).not.toMatch(/position\s*:/);
    expect(result).toContain('background-color');
  });

  it('strips unbounded padding and margin values exceeding 200px', () => {
    const sanitize = makeBannerSanitize();
    const result = sanitize('<div style="padding: 100000px; margin: -100000px;">x</div>');
    expect(result).not.toContain('100000px');
  });

  it('does not allow style or div through the shared sanitizer', () => {
    const sharedSanitize = createConfigHtmlSanitizer({
      allowedTags: CONFIG_HTML_BLOCK_TAGS,
      allowedAttr: CONFIG_HTML_CLASS_ATTR,
    });
    const result = sharedSanitize('<div style="background-color: red;">text</div>');
    expect(result).not.toContain('style=');
    expect(result).not.toContain('<div');
  });

  it('BANNER_CSS_VALIDATORS does not contain layout-affecting properties', () => {
    expect(BANNER_CSS_VALIDATORS).not.toHaveProperty('transform');
    expect(BANNER_CSS_VALIDATORS).not.toHaveProperty('display');
    expect(BANNER_CSS_VALIDATORS).not.toHaveProperty('position');
    expect(BANNER_CSS_VALIDATORS).not.toHaveProperty('z-index');
  });
});
