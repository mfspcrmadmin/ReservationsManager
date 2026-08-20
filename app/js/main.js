import { init } from "./booking-controller.js";
import { initFloatingLayer } from "./floating-layer.js";

function addDialogCloseButton(panel) {
  if (!panel || panel.querySelector("[data-dialog-dismiss]")) {
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
  const dialog = button.closest(".booking-action-dialog");
  const columnsPanel = button.closest(".columns-panel");
  const outlookConfirm = button.closest("#mail-outlook-confirm");

  if (columnsPanel) {
    columnsPanel.querySelector("#close-service-columns").click();
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

    if (dialog.parentElement === document.body) {
      dialog.remove();
    } else {
      dialog.hidden = true;
    }
  }
}

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
init();
