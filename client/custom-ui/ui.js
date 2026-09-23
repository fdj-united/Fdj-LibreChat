//AIS-1062: GTM failing on edge browser, creating custom UI to replace it
import { createAgentInstructionsAmendment } from "./instructions-popup.js";
import { createTooltipsAmendment } from "./tooltips.js";
import { createSidebarExpandableLabelsAmendment } from "./sidebar-labels.js";
import { patchSpeechRecognition } from "./microphone.js";

var LOG_PREFIX = "[KAIT UI]";

function safelyRun(name, callback) {
  try {
    callback();
  } catch (error) {
    console.error(LOG_PREFIX + " " + name + " failed", error);
  }
}

safelyRun("speech recognition patch", patchSpeechRecognition);

function start() {
  var amendments = [
    createAgentInstructionsAmendment(),
    createTooltipsAmendment(),
    createSidebarExpandableLabelsAmendment()
  ];

  amendments.forEach(function (amendment, index) {
    safelyRun(
      "amendment " + index + " initialisation",
      function () {
        if (amendment && typeof amendment.init === "function") {
          amendment.init();
        }
      }
    );
  });

  var domObserver = new MutationObserver(function (mutations) {
    var i;
    var j;
    var node;

    for (i = 0; i < mutations.length; i++) {
      for (j = 0; j < mutations[i].addedNodes.length; j++) {
        node = mutations[i].addedNodes[j];

        if (node.nodeType !== 1) {
          continue;
        }

        amendments.forEach(function (amendment, index) {
          safelyRun(
            "amendment " + index + " DOM check",
            function () {
              if (
                amendment &&
                typeof amendment.checkNode === "function"
              ) {
                amendment.checkNode(node);
              }
            }
          );
        });
      }
    }
  });

  domObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.info(LOG_PREFIX + " Custom amendments loaded");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
