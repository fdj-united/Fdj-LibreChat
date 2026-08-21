import DOMPurify from 'dompurify';

export const CONFIG_HTML_INLINE_TAGS = ['a', 'strong', 'b', 'em', 'i', 'br', 'code'] as const;
export const CONFIG_HTML_TEXT_TAGS = [...CONFIG_HTML_INLINE_TAGS, 'span'] as const;
export const CONFIG_HTML_BLOCK_TAGS = [...CONFIG_HTML_TEXT_TAGS, 'p'] as const;
export const CONFIG_HTML_MEDIA_TAGS = [...CONFIG_HTML_TEXT_TAGS, 'img'] as const;
export const CONFIG_HTML_LINK_ATTR = ['href', 'target', 'rel'] as const;
export const CONFIG_HTML_CLASS_ATTR = [...CONFIG_HTML_LINK_ATTR, 'class'] as const;
export const CONFIG_HTML_MEDIA_ATTR = [...CONFIG_HTML_CLASS_ATTR, 'src', 'alt'] as const;

export const CONFIG_HTML_BANNER_TAGS = [...CONFIG_HTML_TEXT_TAGS, 'div'] as const;
export const CONFIG_HTML_BANNER_ATTR = [...CONFIG_HTML_CLASS_ATTR, 'style'] as const;

const CSS_PX_MAX = 200;
const CSS_PX_PART_RE = /^-?\d+(\.\d+)?px$/;

function isSafePxValue(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return (
    parts.length > 0 &&
    parts.every((part) => {
      if (!CSS_PX_PART_RE.test(part)) {
        return false;
      }
      const n = parseFloat(part);
      return n >= -CSS_PX_MAX && n <= CSS_PX_MAX;
    })
  );
}

/** Per-property CSS validators for banner messages. Properties absent from this map are dropped. */
export const BANNER_CSS_VALIDATORS: Record<string, (value: string) => boolean> = {
  'background-color': () => true,
  color: () => true,
  'border-radius': isSafePxValue,
  padding: isSafePxValue,
  'padding-top': isSafePxValue,
  'padding-right': isSafePxValue,
  'padding-bottom': isSafePxValue,
  'padding-left': isSafePxValue,
  margin: isSafePxValue,
  'margin-top': isSafePxValue,
  'margin-right': isSafePxValue,
  'margin-bottom': isSafePxValue,
  'margin-left': isSafePxValue,
  'text-decoration': () => true,
  'white-space': () => true,
  'font-weight': () => true,
  'font-style': () => true,
};

const CONFIG_HTML_SAFE_URI =
  /^(?:(?:https?|mailto|tel):|(?!(?:\s*[a-z][a-z0-9+.-]*:|\s*\/\/))[\s\S])/i;

type ConfigHtmlSanitizerOptions = {
  allowedTags?: readonly string[];
  allowedAttr?: readonly string[];
  /** When set, the style attribute is rebuilt from only validated declarations. */
  cssValidators?: Record<string, (value: string) => boolean>;
};

export function createConfigHtmlSanitizer({
  allowedTags = CONFIG_HTML_INLINE_TAGS,
  allowedAttr = CONFIG_HTML_LINK_ATTR,
  cssValidators,
}: ConfigHtmlSanitizerOptions = {}) {
  const sanitizer = DOMPurify();
  sanitizer.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (cssValidators && node.hasAttribute('style')) {
      const { style } = node as HTMLElement;
      const safe: string[] = [];
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        const validator = cssValidators[prop];
        const value = style.getPropertyValue(prop);
        if (validator?.(value)) {
          const priority = style.getPropertyPriority(prop);
          safe.push(priority ? `${prop}: ${value} !important` : `${prop}: ${value}`);
        }
      }
      if (safe.length > 0) {
        node.setAttribute('style', safe.join('; '));
      } else {
        node.removeAttribute('style');
      }
    }
  });

  return (html?: string | null): string => {
    if (!html) {
      return '';
    }
    return sanitizer.sanitize(html, {
      ALLOWED_TAGS: [...allowedTags],
      ALLOWED_ATTR: [...allowedAttr],
      ALLOWED_URI_REGEXP: CONFIG_HTML_SAFE_URI,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
  };
}

export function sanitizeConfigHtml(html?: string | null, options?: ConfigHtmlSanitizerOptions) {
  return createConfigHtmlSanitizer(options)(html);
}
