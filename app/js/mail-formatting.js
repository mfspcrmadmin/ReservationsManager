export function initMailFormatting() {
  const editor = document.getElementById("mail-content-edit-visual");
  const toolbar = document.getElementById("mail-format-toolbar");
  const modal = document.getElementById("mail-content-edit-modal");
  if (!editor || !toolbar || !modal) return;
  let savedRange = null;

  function isEditorRange(range) {
    return range && editor.contains(range.startContainer) && editor.contains(range.endContainer);
  }

  function rememberSelection() {
    if (modal.hidden) return;
    const selection = window.getSelection();
    if (selection.rangeCount && isEditorRange(selection.getRangeAt(0))) {
      savedRange = selection.getRangeAt(0).cloneRange();
      toolbar.querySelectorAll("[data-mail-format]").forEach(function (button) {
        button.setAttribute("aria-pressed", String(document.queryCommandState(button.dataset.mailFormat)));
      });
    }
  }

  function restoreSelection() {
    if (modal.hidden || !editor.isContentEditable) return false;
    editor.focus();
    if (isEditorRange(savedRange)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    return true;
  }

  function applyHighlight() {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed || !isEditorRange(selection.getRangeAt(0))) return;
    const color = toolbar.querySelector('[data-mail-color="highlight"]').value;
    // Native highlighting keeps inline formatting, selection and undo history.
    document.execCommand("hiliteColor", false, color);
  }

  document.addEventListener("selectionchange", rememberSelection);
  editor.addEventListener("keyup", rememberSelection);
  editor.addEventListener("mouseup", rememberSelection);
  toolbar.addEventListener("mousedown", function (event) {
    rememberSelection();
    if (event.target.closest("button")) event.preventDefault();
  });
  toolbar.addEventListener("click", function (event) {
    if (event.target.closest("[data-mail-highlight]")) {
      if (!restoreSelection()) return;
      applyHighlight();
      rememberSelection();
      return;
    }
    const button = event.target.closest("[data-mail-format]");
    if (!button || !restoreSelection()) return;
    // Native editing commands preserve the editor's undo history.
    document.execCommand(button.dataset.mailFormat, false, null);
    rememberSelection();
  });
  toolbar.addEventListener("change", function (event) {
    const input = event.target.closest("[data-mail-color]");
    if (!input || !restoreSelection()) return;
    if (input.dataset.mailColor === "text") {
      document.execCommand("foreColor", false, input.value);
    } else if (input.dataset.mailColor === "highlight") {
      applyHighlight();
    }
    rememberSelection();
  });

  new MutationObserver(function () {
    savedRange = null;
    toolbar.querySelectorAll("[data-mail-format]").forEach(function (button) {
      button.setAttribute("aria-pressed", "false");
    });
  }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });

  new MutationObserver(function () {
    toolbar.querySelectorAll("button, input").forEach(function (control) {
      control.disabled = !editor.isContentEditable;
    });
  }).observe(editor, { attributes: true, attributeFilter: ["contenteditable"] });
}
