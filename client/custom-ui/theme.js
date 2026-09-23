//reading libreChat theme classes
export var THEME_CLASSES = {
  popup: ['bg-surface-primary', 'text-text-primary'],
  field: ['bg-surface-secondary', 'text-text-primary'],
  tooltip: ['bg-surface-secondary', 'text-text-primary'],
  button: ['text-text-secondary', 'hover:bg-surface-hover'],
};

export function addThemeClasses(element, key) {
  var classes = THEME_CLASSES[key];
  var i;

  if (!element || !classes) {
    return;
  }

  for (i = 0; i < classes.length; i++) {
    element.classList.add(classes[i]);
  }
}

export function removeThemeClasses(element, key) {
  var classes = THEME_CLASSES[key];
  var i;

  if (!element || !classes) {
    return;
  }

  for (i = 0; i < classes.length; i++) {
    element.classList.remove(classes[i]);
  }
}
