//AIS-303: agent instructionspopup functionality
import { addThemeClasses, removeThemeClasses } from "./theme.js";

//popup styling
function getPopupStyles() {
  return {
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: "60%",
    height: "60%",
    "min-width": "300px",
    "min-height": "200px",
    overflow: "hidden",
    "border-radius": "0.5rem",
    "z-index": "99990",
    padding: "0.5rem",
    "box-shadow": "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex",
    "flex-direction": "column",
    "box-sizing": "border-box",
    border: "1px solid color-mix(in srgb, currentColor 20%, transparent)"
  };
}

function applyImportantStyles(element, styles) {
  var property;

  if (!element || !styles) {
    return;
  }

  for (property in styles) {
    if (
      Object.prototype.hasOwnProperty.call(styles, property)
    ) {
      element.style.setProperty(
        property,
        styles[property],
        "important"
      );
    }
  }
}

//Attach draggable behaviour to the popup
function attachDraggable(element, handle) {
  var isDragging = false;
  var startX;
  var startY;
  var startLeft;
  var startTop;

  if (
    !element ||
    !handle ||
    handle.getAttribute("data-kait-drag-attached") === "true"
  ) {
    return;
  }

  handle.setAttribute("data-kait-drag-attached", "true");

  function onMouseMove(event) {
    var left;
    var top;

    if (!isDragging) {
      return;
    }

    left = startLeft + event.clientX - startX;
    top = startTop + event.clientY - startY;

    left = Math.max(
      0,
      Math.min(left, window.innerWidth - 40)
    );

    top = Math.max(
      0,
      Math.min(top, window.innerHeight - 40)
    );

    element.style.setProperty(
      "left",
      left + "px",
      "important"
    );

    element.style.setProperty(
      "top",
      top + "px",
      "important"
    );
  }

  function onMouseUp() {
    if (!isDragging) {
      return;
    }

    isDragging = false;
    handle.style.cursor = "grab";
    document.body.style.userSelect = "";

    document.removeEventListener(
      "mousemove",
      onMouseMove
    );

    document.removeEventListener(
      "mouseup",
      onMouseUp
    );
  }

  handle.addEventListener("mousedown", function (event) {
    var rect;

    if (
      event.target &&
      event.target.closest &&
      event.target.closest("#__kait_popup_close__")
    ) {
      return;
    }

    rect = element.getBoundingClientRect();

    element.style.setProperty(
      "left",
      rect.left + "px",
      "important"
    );

    element.style.setProperty(
      "top",
      rect.top + "px",
      "important"
    );

    element.style.setProperty(
      "transform",
      "none",
      "important"
    );

    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    isDragging = true;

    handle.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    document.addEventListener(
      "mousemove",
      onMouseMove
    );

    document.addEventListener(
      "mouseup",
      onMouseUp
    );

    event.preventDefault();
  });
}


//popup functionality
export function createAgentInstructionsAmendment() {
  var SELECTOR = "textarea#instructions";

  var OPEN_BUTTON_ID = "open-controls-pop-up";
  var HANDLE_ID = "__kait_popup_handle__";
  var DRAG_AREA_ID = "__kait_popup_drag_area__";
  var CLOSE_BUTTON_ID = "__kait_popup_close__";
  var SCROLL_ID = "__kait_popup_scroll__";
  var RESIZE_ID = "__kait_popup_resize__";

  var MIN_SHELL_WIDTH = 280;
  var MIN_SHELL_HEIGHT = 200;

  var instructionsBox = null;
  var previousStyleText = "";
  var savedClasses = "";
  var savedSize = null;

  //popup icons from lucide.dev/icons
  function getPopupIconHtml(kind) {
    var svgStart =
      '<svg xmlns="http://www.w3.org/2000/svg" ' +
      'width="16" height="16" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">';

    var svgEnd = "</svg>";

    if (kind === "collapse") {
      return (
        svgStart +
        '<path d="M13 21h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6"/>' +
        '<path d="m3 21 9-9"/>' +
        '<path d="M9 21H3v-6"/>' +
        svgEnd
      );
    }

    return (
      svgStart +
      '<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>' +
      '<path d="m21 3-9 9"/>' +
      '<path d="M15 3h6v6"/>' +
      svgEnd
    );
  }
  
  //match colours to libreChat theme
  function applyThemeClasses() {
    var closeButton = document.getElementById(CLOSE_BUTTON_ID);
    var openButton = document.getElementById(OPEN_BUTTON_ID);
    var textarea = document.querySelector(SELECTOR);
    var isOpen =
      instructionsBox &&
      instructionsBox.getAttribute("data-state") === "open";

    if (instructionsBox) {
      if (isOpen) {
        addThemeClasses(instructionsBox, "popup");
      } else {
        removeThemeClasses(instructionsBox, "popup");
      }
    }

    if (textarea) {
      if (isOpen) {
        addThemeClasses(textarea, "field");
      } else {
        removeThemeClasses(textarea, "field");
      }
    }

    addThemeClasses(closeButton, "button");
    addThemeClasses(openButton, "button");
  }

  //fit the textarea to the wrapper
  function fitTextareaToWrapper() {
    var scrollWrapper =
      document.getElementById(SCROLL_ID);
    var textarea = document.querySelector(SELECTOR);
    var child;
    var i;

    if (
      !instructionsBox ||
      instructionsBox.getAttribute("data-state") !==
        "open"
    ) {
      return;
    }

    if (!scrollWrapper || !textarea) {
      return;
    }

    scrollWrapper.style.setProperty(
      "display",
      "flex",
      "important"
    );

    scrollWrapper.style.setProperty(
      "flex-direction",
      "column",
      "important"
    );

    scrollWrapper.style.setProperty(
      "flex",
      "1",
      "important"
    );

    scrollWrapper.style.setProperty(
      "min-height",
      "0",
      "important"
    );

    scrollWrapper.style.setProperty(
      "overflow",
      "hidden",
      "important"
    );

    for (
      i = 0;
      i < scrollWrapper.children.length;
      i++
    ) {
      child = scrollWrapper.children[i];

      if (child === textarea) {
        break;
      }

      child.style.setProperty(
        "flex-shrink",
        "0",
        "important"
      );
    }

    textarea.style.setProperty(
      "flex",
      "1 1 auto",
      "important"
    );

    textarea.style.setProperty(
      "min-height",
      "0",
      "important"
    );

    textarea.style.setProperty(
      "height",
      "0",
      "important"
    );

    textarea.style.setProperty(
      "width",
      "100%",
      "important"
    );

    textarea.style.setProperty(
      "box-sizing",
      "border-box",
      "important"
    );

    textarea.style.setProperty(
      "resize",
      "none",
      "important"
    );

    textarea.style.setProperty(
      "overflow",
      "auto",
      "important"
    );
  }

  //attach resize behaviour to the popup
  function attachResizeBehaviour(box, grip) {
    if (
      grip.getAttribute(
        "data-kait-resize-attached"
      ) === "true"
    ) {
      return;
    }

    grip.setAttribute(
      "data-kait-resize-attached",
      "true"
    );

    grip.addEventListener("mousedown", function (event) {
      var startX;
      var startY;
      var startWidth;
      var startHeight;
      var rect;

      event.preventDefault();
      event.stopPropagation();

      rect = box.getBoundingClientRect();

      startX = event.clientX;
      startY = event.clientY;
      startWidth = rect.width;
      startHeight = rect.height;

      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";

      function onMouseMove(moveEvent) {
        var width =
          startWidth + moveEvent.clientX - startX;
        var height =
          startHeight + moveEvent.clientY - startY;

        width = Math.max(MIN_SHELL_WIDTH, width);
        height = Math.max(MIN_SHELL_HEIGHT, height);

        box.style.setProperty(
          "width",
          width + "px",
          "important"
        );

        box.style.setProperty(
          "height",
          height + "px",
          "important"
        );

        savedSize = {
          width: width + "px",
          height: height + "px"
        };

        fitTextareaToWrapper();
      }

      function onMouseUp() {
        document.removeEventListener(
          "mousemove",
          onMouseMove
        );

        document.removeEventListener(
          "mouseup",
          onMouseUp
        );

        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }

      document.addEventListener(
        "mousemove",
        onMouseMove
      );

      document.addEventListener(
        "mouseup",
        onMouseUp
      );
    });
  }

  function closeState() {
    var handle;
    var resizeGrip;
    var openButton;
    var textarea;

    if (!instructionsBox) {
      return;
    }

    instructionsBox.setAttribute(
      "data-state",
      "closed"
    );

    instructionsBox.className = savedClasses;
    instructionsBox.style.cssText = previousStyleText;

    handle = document.getElementById(HANDLE_ID);
    resizeGrip = document.getElementById(RESIZE_ID);
    openButton = document.getElementById(
      OPEN_BUTTON_ID
    );
    textarea = document.querySelector(SELECTOR);

    if (handle) {
      handle.style.display = "none";
    }

    if (resizeGrip) {
      resizeGrip.style.display = "none";
    }

    if (openButton) {
      openButton.style.display = "flex";
    }

    if (textarea) {
      textarea.style.cssText = "height: 100px;";
    }

    applyThemeClasses();
  }

  function buildShell() {
    var handle;
    var dragArea;
    var closeButton;
    var scrollWrapper;
    var resizeGrip;

    if (
      !instructionsBox ||
      instructionsBox.getAttribute(
        "data-kait-shell-built"
      ) === "true"
    ) {
      return;
    }

    instructionsBox.setAttribute(
      "data-kait-shell-built",
      "true"
    );

    handle = document.createElement("div");
    handle.id = HANDLE_ID;
    handle.style.cssText = [
      "display:flex",
      "align-items:center",
      "width:100%",
      "min-height:1.25rem",
      "padding:0.25rem 0.75rem",
      "box-sizing:border-box",
      "margin:0",
      "cursor:grab",
      "flex-shrink:0",
      "user-select:none"
    ].join(";");

    dragArea = document.createElement("div");
    dragArea.id = DRAG_AREA_ID;
    dragArea.style.cssText = [
      "flex:1",
      "align-self:stretch",
      "min-height:100%",
      "cursor:grab"
    ].join(";");

    closeButton = document.createElement("button");
    closeButton.id = CLOSE_BUTTON_ID;
    closeButton.type = "button";
    closeButton.setAttribute(
      "aria-label",
      "Minimise instructions"
    );
    closeButton.innerHTML =
      getPopupIconHtml("collapse");

    closeButton.style.cssText = [
      "background:none",
      "border:none",
      "font-size:1rem",
      "cursor:pointer",
      "line-height:0",
      "padding:0",
      "flex-shrink:0",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "width:1.25rem",
      "height:1.25rem",
      "color:inherit"
    ].join(";");

    closeButton.addEventListener(
      "mousedown",
      function (event) {
        event.stopPropagation();
      }
    );

    closeButton.addEventListener(
      "click",
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        closeState();
      }
    );

    handle.appendChild(dragArea);
    handle.appendChild(closeButton);

    scrollWrapper = document.createElement("div");
    scrollWrapper.id = SCROLL_ID;
    scrollWrapper.style.cssText =
      "overflow-y:auto;flex:1;min-height:0;";

    while (instructionsBox.firstChild) {
      scrollWrapper.appendChild(
        instructionsBox.firstChild
      );
    }

    instructionsBox.appendChild(handle);
    instructionsBox.appendChild(scrollWrapper);

    resizeGrip = document.createElement("div");
    resizeGrip.id = RESIZE_ID;
    resizeGrip.textContent = "◢";

    resizeGrip.style.cssText = [
      "position:absolute",
      "right:2px",
      "bottom:2px",
      "width:16px",
      "height:16px",
      "line-height:16px",
      "text-align:center",
      "font-size:12px",
      "cursor:nwse-resize",
      "user-select:none",
      "z-index:2"
    ].join(";");

    instructionsBox.appendChild(resizeGrip);

    attachDraggable(instructionsBox, handle);
    attachResizeBehaviour(
      instructionsBox,
      resizeGrip
    );
  }

  function applyOpenLayout() {
    var handle =
      document.getElementById(HANDLE_ID);
    var scrollWrapper =
      document.getElementById(SCROLL_ID);
    var dragArea =
      document.getElementById(DRAG_AREA_ID);
    var textarea = document.querySelector(SELECTOR);
    var child;
    var i;

    if (!instructionsBox) {
      return;
    }

    instructionsBox.style.setProperty(
      "padding",
      "0",
      "important"
    );

    if (handle) {
      handle.style.setProperty(
        "margin",
        "0",
        "important"
      );

      handle.style.setProperty(
        "width",
        "100%",
        "important"
      );

      handle.style.setProperty(
        "min-height",
        "1.25rem",
        "important"
      );

      handle.style.setProperty(
        "padding",
        "0.25rem 0.75rem",
        "important"
      );

      handle.style.setProperty(
        "box-sizing",
        "border-box",
        "important"
      );
    }

    if (dragArea) {
      dragArea.style.setProperty(
        "min-height",
        "1.25rem",
        "important"
      );
    }

    if (scrollWrapper) {
      scrollWrapper.style.setProperty(
        "padding",
        "0 0.75rem 0.75rem",
        "important"
      );

      scrollWrapper.style.setProperty(
        "box-sizing",
        "border-box",
        "important"
      );

      if (textarea) {
        for (
          i = 0;
          i < scrollWrapper.children.length;
          i++
        ) {
          child = scrollWrapper.children[i];

          if (child === textarea) {
            break;
          }

          child.style.setProperty(
            "margin-top",
            "0",
            "important"
          );

          child.style.setProperty(
            "margin-bottom",
            "0.25rem",
            "important"
          );
        }
      }
    }

    fitTextareaToWrapper();
  }

  function openState() {
    var handle;
    var resizeGrip;
    var openButton;

    if (!instructionsBox) {
      return;
    }

    savedClasses = instructionsBox.className;
    previousStyleText =
      instructionsBox.style.cssText;

    instructionsBox.setAttribute(
      "data-state",
      "open"
    );

    buildShell();

    instructionsBox.style.cssText = "";
    applyImportantStyles(
      instructionsBox,
      getPopupStyles()
    );

    if (savedSize) {
      instructionsBox.style.setProperty(
        "width",
        savedSize.width,
        "important"
      );

      instructionsBox.style.setProperty(
        "height",
        savedSize.height,
        "important"
      );
    }

    applyOpenLayout();
    applyThemeClasses();

    handle = document.getElementById(HANDLE_ID);
    resizeGrip = document.getElementById(RESIZE_ID);
    openButton = document.getElementById(
      OPEN_BUTTON_ID
    );

    if (handle) {
      handle.style.display = "flex";
    }

    if (resizeGrip) {
      resizeGrip.style.display = "block";
    }

    if (openButton) {
      openButton.style.display = "none";
    }

    fitTextareaToWrapper();
  }

  function handleToggle(event) {
    var textarea =
      document.querySelector(SELECTOR);

    if (!textarea) {
      return;
    }

    if (!instructionsBox) {
      instructionsBox = textarea.parentElement;
    }

    if (!instructionsBox) {
      return;
    }

    instructionsBox.setAttribute(
      "data-kait-popup",
      "true"
    );

    if (!instructionsBox.getAttribute("data-state")) {
      instructionsBox.setAttribute(
        "data-state",
        "closed"
      );
    }

    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (
      instructionsBox.getAttribute("data-state") ===
      "closed"
    ) {
      openState();
    } else {
      closeState();
    }
  }

  function ensureExpandButton() {
    var textarea =
      document.querySelector(SELECTOR);
    var button =
      document.getElementById(OPEN_BUTTON_ID);
    var box;

    if (!textarea) {
      return;
    }

    box =
      textarea.closest(
        '[data-kait-popup="true"]'
      ) ||
      instructionsBox ||
      textarea.parentElement;

    if (!box) {
      return;
    }

    instructionsBox = box;

    instructionsBox.setAttribute(
      "data-kait-popup",
      "true"
    );

    if (!instructionsBox.getAttribute("data-state")) {
      instructionsBox.setAttribute(
        "data-state",
        "closed"
      );
    }

    if (!button) {
      button = document.createElement("button");
      button.id = OPEN_BUTTON_ID;
      button.type = "button";

      button.setAttribute(
        "aria-label",
        "Expand instructions"
      );

      button.setAttribute(
        "title",
        "Expand instructions"
      );

      button.innerHTML =
        getPopupIconHtml("expand");

      button.style.cssText = [
        "background:none",
        "border:none",
        "cursor:pointer",
        "line-height:0",
        "padding:0",
        "margin-top:0.5rem",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "width:1.25rem",
        "height:1.25rem",
        "color:inherit"
      ].join(";");

      button.addEventListener(
        "click",
        handleToggle
      );

      if (textarea.nextSibling) {
        textarea.parentNode.insertBefore(
          button,
          textarea.nextSibling
        );
      } else {
        textarea.parentNode.appendChild(button);
      }
    }

    button.style.display =
      instructionsBox.getAttribute("data-state") ===
      "open"
        ? "none"
        : "flex";

    applyThemeClasses();
  }

  function refresh() {
    var textarea =
      document.querySelector(SELECTOR);
    var box;

    if (!textarea) {
      return;
    }

    box = textarea.closest(
      '[data-kait-popup="true"]'
    );

    if (!box) {
      box = textarea.parentElement;
    }

    if (!box) {
      return;
    }

    instructionsBox = box;

    instructionsBox.setAttribute(
      "data-kait-popup",
      "true"
    );

    if (!instructionsBox.getAttribute("data-state")) {
      instructionsBox.setAttribute(
        "data-state",
        "closed"
      );
    }

    ensureExpandButton();
    applyThemeClasses();
  }

  return {
    init: refresh,

    checkNode: function (node) {
      if (!node || node.nodeType !== 1) {
        return;
      }

      if (
        node.matches &&
        node.matches(SELECTOR)
      ) {
        refresh();
        return;
      }

      if (
        node.querySelector &&
        node.querySelector(SELECTOR)
      ) {
        refresh();
      }
    }
  };
}
