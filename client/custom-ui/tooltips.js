//AIS-502: "upload file" tooltips
import { addThemeClasses } from './theme.js';

export function createTooltipsAmendment() {
  var MENU_ITEMS = {
    'Upload to Provider':
      'This sends the file directly to the model (e.g. GPT or Claude), using its native vision capabilities. Loads all of the information in the context window. Good for reading images and PDFs, not good for very large documents or a large number of documents.',

    'Upload as Text':
      'Loads the whole file (as text) into the prompt. This is expensive and not suitable for large or lots of documents. Suitable if you want to analyse or summarise the entire contents of a document.',

    'Upload File (in context)':
      'Loads the whole file (as text) into the prompt. This is expensive and not suitable for large or lots of documents. Suitable if you want to analyse or summarise the entire contents of a document.',

    'Upload for File Search':
      'This uses retrieval (RAG), meaning it is very good for large documents or a large number of documents that would be too large for the context window. It retrieves relevant chunks of the files based on the prompt, so it is not suitable if you need to analyse the entire contents of a file.',

    'Upload to Code Environment':
      'Loads the file for Python analysis. Good if you want reliable and accurate calculations, or have a large amount of data that does not make sense to load into context.',

    'From SharePoint': 'This is a one-off load of a file from SharePoint. This is not a live feed.',
  };

  var INJECT_ATTR = 'data-kait-info-injected';
  var ORIGINAL_TEXT_ATTR = 'data-kait-original-text';
  var TOOLTIP_ID = '__kait_tooltip__';

  function getTooltipElement() {
    var tooltip = document.getElementById(TOOLTIP_ID);

    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = TOOLTIP_ID;
      tooltip.setAttribute('role', 'tooltip');

      tooltip.style.cssText = [
        'position:fixed',
        'z-index:99999',
        'max-width:260px',
        'padding:8px 12px',
        'font-size:12px',
        'font-family:inherit',
        'line-height:1.5',
        'border-radius:8px',
        'border-left:3px solid currentColor',
        'box-shadow:0 4px 16px color-mix(in srgb, currentColor 20%, transparent)',
        'pointer-events:none',
        'opacity:0',
        'display:none',
        'transition:opacity 0.15s ease',
        'white-space:normal',
      ].join(';');

      document.body.appendChild(tooltip);
    }

    addThemeClasses(tooltip, 'tooltip');

    return tooltip;
  }

  function createTooltipIcon(tooltipText, tooltipElement) {
    var icon = document.createElement('span');

    icon.setAttribute('aria-label', 'More information');

    icon.setAttribute('tabindex', '0');

    icon.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'width:16px',
      'height:16px',
      'border-radius:50%',
      'border:1.5px solid currentColor',
      'font-size:11px',
      'font-style:normal',
      'font-weight:bold',
      'line-height:1',
      'flex-shrink:0',
      'margin-left:auto',
      'opacity:0.6',
      'cursor:help',
      'pointer-events:auto',
    ].join(';');

    icon.textContent = 'i';

    function showTooltip() {
      var rect = icon.getBoundingClientRect();
      var top = rect.top + rect.height / 2;
      var left = rect.right + 10;

      tooltipElement.textContent = tooltipText;
      tooltipElement.style.display = 'block';
      tooltipElement.style.opacity = '0';

      if (left + 260 > window.innerWidth - 16) {
        left = rect.left - 270;
      }

      left = Math.max(8, left);

      tooltipElement.style.top = top + 'px';
      tooltipElement.style.left = left + 'px';
      tooltipElement.style.transform = 'translateY(-50%)';
      tooltipElement.style.opacity = '1';
    }

    function hideTooltip() {
      tooltipElement.style.opacity = '0';
      tooltipElement.style.display = 'none';
    }

    icon.addEventListener('mouseenter', showTooltip);

    icon.addEventListener('mouseleave', hideTooltip);

    icon.addEventListener('focus', showTooltip);

    icon.addEventListener('blur', hideTooltip);

    icon.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });

    return icon;
  }

  function getTargetText(element) {
    var text;

    if (!element) {
      return '';
    }

    text = element.getAttribute(ORIGINAL_TEXT_ATTR);

    if (text) {
      return text;
    }

    text = element.innerText ? element.innerText.trim() : '';

    if (Object.prototype.hasOwnProperty.call(MENU_ITEMS, text)) {
      element.setAttribute(ORIGINAL_TEXT_ATTR, text);

      return text;
    }

    return '';
  }

  function isTarget(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    if (element.getAttribute('role') !== 'menuitem' && element.tagName !== 'BUTTON') {
      return false;
    }

    return !!getTargetText(element);
  }

  function injectInfoIcon(element) {
    var text;
    var tooltip;
    var icon;

    if (element.getAttribute(INJECT_ATTR) === 'true') {
      return;
    }

    text = getTargetText(element);

    if (!text || !MENU_ITEMS[text]) {
      return;
    }

    tooltip = getTooltipElement();
    icon = createTooltipIcon(MENU_ITEMS[text], tooltip);

    element.style.setProperty('display', 'flex');

    element.style.setProperty('align-items', 'center');

    element.style.setProperty('justify-content', 'flex-start');

    element.style.setProperty('gap', '8px');

    element.appendChild(icon);

    element.setAttribute(INJECT_ATTR, 'true');
  }

  function processRoot(root) {
    var candidates;
    var i;

    if (!root || root.nodeType !== 1) {
      return;
    }

    if (isTarget(root)) {
      injectInfoIcon(root);
    }

    if (!root.querySelectorAll) {
      return;
    }

    candidates = root.querySelectorAll('[role="menuitem"], button');

    for (i = 0; i < candidates.length; i++) {
      if (isTarget(candidates[i])) {
        injectInfoIcon(candidates[i]);
      }
    }
  }

  return {
    init: function () {
      var candidates = document.querySelectorAll('[role="menuitem"], button');
      var i;

      getTooltipElement();

      for (i = 0; i < candidates.length; i++) {
        if (isTarget(candidates[i])) {
          injectInfoIcon(candidates[i]);
        }
      }
    },

    checkNode: processRoot,
  };
}
