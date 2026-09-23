//AIS-796: sidebar label & collapse/expand functionality
export function createSidebarExpandableLabelsAmendment() {
  var LABELS_BY_TESTID = {
    'close-sidebar-button': 'Close',
    'new-chat-button': 'New chat',
    'nav-panel-conversations': 'History',
    'nav-panel-agents': 'Agents',
    'nav-panel-skills': 'Skills',
    'nav-panel-prompts': 'Prompts',
    'nav-panel-memories': 'Memories',
    'nav-panel-bookmarks': 'Bookmarks',
    'nav-panel-files': 'Files',
    'nav-panel-mcp-builder': 'MCP',
    'nav-panel-review-agent': 'Review',
    'nav-user': 'Account',
  };

  var LABELS_BY_ARIA = {
    'Close sidebar': 'Close',
    'New chat': 'New chat',
    'Chat History': 'History',
    'Agent Builder': 'Agents',
    Skills: 'Skills',
    Prompts: 'Prompts',
    Memories: 'Memories',
    Bookmarks: 'Bookmarks',
    'Attach Files': 'Files',
    'MCP Settings': 'MCP',
    Review: 'Review',
    'Account Settings': 'Account',
  };

  var INJECT_ATTR = 'data-kait-sidebar-label-injected';
  var STYLE_ID = 'kait-sidebar-expand-style';
  var TOGGLE_ID = 'kait-sidebar-expand-toggle';
  var HTML_CLASS = 'kait-sidebar-expanded';
  var STORAGE_KEY = 'kait-sidebar-expanded';

  var savedStateApplied = false;

  function getCloseButton() {
    return (
      document.getElementById('close-sidebar-button') ||
      document.querySelector('[data-testid="close-sidebar-button"]')
    );
  }

  function getRail() {
    var closeButton = getCloseButton();
    var element;

    if (!closeButton) {
      return null;
    }

    element = closeButton.parentElement;

    while (element && element !== document.body) {
      if (
        element.tagName === 'DIV' &&
        element.classList.contains('border-r') &&
        element.classList.contains('bg-surface-primary-alt')
      ) {
        return element;
      }

      element = element.parentElement;
    }

    return closeButton.closest('div');
  }

  function getScrollSection(rail) {
    if (!rail) {
      return null;
    }

    return rail.querySelector('.flex.flex-col.gap-1.overflow-y-auto');
  }

  function getBottomSection(rail) {
    if (!rail) {
      return null;
    }

    return rail.querySelector('.mt-auto.flex.flex-col.items-center.gap-2');
  }

  function getLabel(element) {
    var testId = element.getAttribute('data-testid');
    var aria = element.getAttribute('aria-label');

    if (testId && LABELS_BY_TESTID[testId]) {
      return LABELS_BY_TESTID[testId];
    }

    if (aria && LABELS_BY_ARIA[aria]) {
      return LABELS_BY_ARIA[aria];
    }

    return null;
  }

  function isRailAction(element) {
    var rail = getRail();

    if (!element || element.nodeType !== 1 || !rail) {
      return false;
    }

    if (element.tagName !== 'BUTTON' && element.tagName !== 'A') {
      return false;
    }

    if (element.id === TOGGLE_ID) {
      return false;
    }

    if (!rail.contains(element)) {
      return false;
    }

    return !!getLabel(element);
  }

  function injectStyles() {
    var style;

    if (document.getElementById(STYLE_ID)) {
      return;
    }

    style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = [
      'html body .kait-sidebar-rail {',
      '  transition: width 0.2s ease, min-width 0.2s ease;',
      '}',

      'html.' + HTML_CLASS + ' body .kait-sidebar-rail {',
      '  width: 220px !important;',
      '  min-width: 220px !important;',
      '  align-items: stretch !important;',
      '}',

      'html.' + HTML_CLASS + ' body .kait-sidebar-scroll-section {',
      '  align-items: stretch !important;',
      '}',

      'html.' + HTML_CLASS + ' body .kait-sidebar-bottom-section {',
      '  align-items: stretch !important;',
      '}',

      'html body .kait-sidebar-inline-label {',
      '  display: none;',
      '  white-space: nowrap;',
      '  font-size: 14px;',
      '  line-height: 1;',
      '  color: var(--text-primary, currentColor) !important;',
      '  pointer-events: none;',
      '  flex: 0 1 auto;',
      '}',

      'html.' + HTML_CLASS + ' body .kait-sidebar-inline-label {',
      '  display: inline;',
      '}',

      'html.' + HTML_CLASS + ' body .kait-sidebar-rail button[' + INJECT_ATTR + '="true"],',

      'html.' + HTML_CLASS + ' body .kait-sidebar-rail a[' + INJECT_ATTR + '="true"],',

      'html.' + HTML_CLASS + ' body #' + TOGGLE_ID + ' {',
      '  width: 100% !important;',
      '  min-width: 0 !important;',
      '  justify-content: flex-start !important;',
      '  padding-left: 10px !important;',
      '  padding-right: 10px !important;',
      '  gap: 10px !important;',
      '  box-sizing: border-box !important;',
      '}',

      'html body #' + TOGGLE_ID + ' .kait-toggle-label {',
      '  display: none;',
      '  white-space: nowrap;',
      '  font-size: 14px;',
      '  line-height: 1;',
      '  color: var(--text-primary, currentColor) !important;',
      '  pointer-events: none;',
      '}',

      'html.' + HTML_CLASS + ' body #' + TOGGLE_ID + ' .kait-toggle-label {',
      '  display: inline;',
      '}',

      'html body #' + TOGGLE_ID + ' .kait-toggle-icon {',
      '  width: 20px;',
      '  height: 20px;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  flex: 0 0 auto;',
      '}',

      'html body #' + TOGGLE_ID + ' svg {',
      '  display: block;',
      '}',
    ].join('\n');

    document.head.appendChild(style);
  }

  function getToggleIconSvg() {
    return (
      '<svg viewBox="0 0 24 24" width="20" height="20" ' +
      'fill="none" xmlns="http://www.w3.org/2000/svg" ' +
      'aria-hidden="true">' +
      '<path d="M4 6H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M4 12H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M4 18H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>'
    );
  }

  function getToggleButtonClassName() {
    return [
      'inline-flex',
      'items-center',
      'justify-center',
      'gap-2',
      'whitespace-nowrap',
      'text-sm',
      'font-medium',
      'ring-offset-background',
      'transition-colors',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
      'disabled:pointer-events-none',
      'disabled:opacity-50',
      'hover:bg-surface-hover',
      'hover:text-accent-foreground',
      'size-10',
      'cursor-pointer',
      'h-9',
      'w-9',
      'rounded-lg',
      'text-text-secondary',
    ].join(' ');
  }

  function isExpanded() {
    return document.documentElement.classList.contains(HTML_CLASS);
  }

  function updateToggleState() {
    var toggle = document.getElementById(TOGGLE_ID);
    var expanded = isExpanded();
    var label;

    if (!toggle) {
      return;
    }

    toggle.setAttribute('aria-pressed', expanded ? 'true' : 'false');

    toggle.setAttribute('title', expanded ? 'Collapse sidebar labels' : 'Expand sidebar labels');

    toggle.setAttribute(
      'aria-label',
      expanded ? 'Collapse sidebar labels' : 'Expand sidebar labels',
    );

    label = toggle.querySelector('.kait-toggle-label');

    if (label) {
      label.textContent = expanded ? 'Collapse' : 'Expand';
    }
  }

  function setExpandedState(expanded) {
    document.documentElement.classList.toggle(HTML_CLASS, expanded);

    try {
      localStorage.setItem(STORAGE_KEY, expanded ? 'true' : 'false');
    } catch (error) {
      console.warn('[KAIT UI] could not save sidebar state', error);
    }

    updateToggleState();
  }

  function applySavedStateOnce() {
    var saved;

    if (savedStateApplied) {
      return;
    }

    savedStateApplied = true;

    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      saved = null;
    }

    document.documentElement.classList.toggle(HTML_CLASS, saved === 'true');
  }

  function createToggleButton() {
    var button = document.createElement('button');
    var icon = document.createElement('span');
    var label = document.createElement('span');

    button.type = 'button';
    button.id = TOGGLE_ID;
    button.className = getToggleButtonClassName();

    icon.className = 'kait-toggle-icon';
    icon.innerHTML = getToggleIconSvg();

    label.className = 'kait-toggle-label';
    label.textContent = 'Expand';

    button.appendChild(icon);
    button.appendChild(label);

    button.addEventListener('click', function () {
      setExpandedState(!isExpanded());
    });

    return button;
  }

  function ensureToggleButton() {
    var rail = getRail();
    var existing;
    var closeButton;
    var toggle;

    if (!rail) {
      return;
    }

    existing = document.getElementById(TOGGLE_ID);

    if (existing) {
      return;
    }

    toggle = createToggleButton();
    closeButton = getCloseButton();

    if (closeButton && closeButton.parentNode) {
      closeButton.parentNode.insertBefore(toggle, closeButton.nextSibling);
    } else {
      rail.insertBefore(toggle, rail.firstChild);
    }
  }

  function ensureRailMarkers() {
    var rail = getRail();
    var scrollSection;
    var bottomSection;

    if (!rail) {
      return;
    }

    rail.classList.add('kait-sidebar-rail');

    scrollSection = getScrollSection(rail);

    if (scrollSection) {
      scrollSection.classList.add('kait-sidebar-scroll-section');
    }

    bottomSection = getBottomSection(rail);

    if (bottomSection) {
      bottomSection.classList.add('kait-sidebar-bottom-section');
    }
  }

  function injectLabel(element) {
    var labelText;
    var label;

    if (element.getAttribute(INJECT_ATTR) === 'true') {
      return;
    }

    labelText = getLabel(element);

    if (!labelText) {
      return;
    }

    label = document.createElement('span');
    label.className = 'kait-sidebar-inline-label';
    label.textContent = labelText;

    element.appendChild(label);

    element.setAttribute(INJECT_ATTR, 'true');
  }

  function processRoot(root) {
    var items;
    var i;

    if (!root || !root.querySelectorAll) {
      return;
    }

    if (isRailAction(root)) {
      injectLabel(root);
    }

    items = root.querySelectorAll(
      'button[aria-label], ' + 'a[aria-label], ' + 'button[data-testid], ' + 'a[data-testid]',
    );

    for (i = 0; i < items.length; i++) {
      if (isRailAction(items[i])) {
        injectLabel(items[i]);
      }
    }
  }

  function runAll() {
    injectStyles();
    applySavedStateOnce();
    ensureRailMarkers();
    ensureToggleButton();
    processRoot(document);
    updateToggleState();
  }

  return {
    init: runAll,

    checkNode: function (node) {
      if (!node || node.nodeType !== 1) {
        return;
      }

      ensureRailMarkers();
      ensureToggleButton();

      if (isRailAction(node)) {
        injectLabel(node);
      }

      processRoot(node);
      updateToggleState();
    },
  };
}
