import { init } from "./booking-controller.js";
import { initInterfaceSystem } from "./interface-system.js";
import { initQueueDropdowns } from "./queue-dropdowns.js";
import { initFloatingLayer } from "./floating-layer.js";
import { initMailFormatting } from "./mail-formatting.js";
import { onToggleServiceColumnsPanel } from "./services-controller.js";
import { initServiceTravelers } from "./service-travelers.js";

function addDialogCloseButton(panel) {
  if (!panel || panel.querySelector("[data-dialog-dismiss], [data-dismiss]")) {
    return;
  }

  const closeButton = document.createElement("button");
  closeButton.className = "booking-action-dialog-dismiss";
  closeButton.type = "button";
  closeButton.setAttribute("data-dialog-dismiss", "");
  closeButton.setAttribute("aria-label", "Close dialog");
  closeButton.title = "Close";
  closeButton.textContent = "×";
  panel.insertBefore(closeButton, panel.firstChild);
}

function addDialogCloseButtons(root) {
  if (!root) {
    return;
  }

  const dialogPanelSelector = ".booking-action-dialog-panel, .columns-panel-dialog, .mail-outlook-confirm-dialog";

  if (root.nodeType === Node.ELEMENT_NODE && root.matches(dialogPanelSelector)) {
    addDialogCloseButton(root);
  }

  if (root.querySelectorAll) {
    root.querySelectorAll(dialogPanelSelector).forEach(addDialogCloseButton);
  }
}

function closeDialogFromDismissButton(button) {
  const dialog = button.closest(".booking-action-dialog, dialog");
  const columnsPanel = button.closest(".columns-panel");
  const outlookConfirm = button.closest("#mail-outlook-confirm");

  if (columnsPanel) {
    onToggleServiceColumnsPanel();
    return;
  }

  if (outlookConfirm) {
    outlookConfirm.querySelector("#mail-outlook-confirm-no").click();
    return;
  }

  if (dialog) {
    const existingClose = dialog.querySelector("[data-close], [id$='-dialog-close']");
    if (existingClose) {
      existingClose.click();
      return;
    }

    if (dialog.tagName === "DIALOG") {
      dialog.close();
    } else if (dialog.parentElement === document.body) {
      dialog.remove();
    } else {
      dialog.hidden = true;
    }
  }
}

initMailFormatting();
addDialogCloseButtons(document);
document.addEventListener("click", function (event) {
  const dismissButton = event.target.closest("[data-dialog-dismiss]");
  if (dismissButton) {
    closeDialogFromDismissButton(dismissButton);
  }
});

new MutationObserver(function (records) {
  records.forEach(function (record) {
    record.addedNodes.forEach(addDialogCloseButtons);
  });
}).observe(document.body, { childList: true, subtree: true });

initFloatingLayer();
initQueueDropdowns();
initInterfaceSystem();
initServiceTravelers();
init();
