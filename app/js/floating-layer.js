const TOOLTIP_OFFSET = 8;
const VIEWPORT_GUTTER = 8;

let tooltip;
let activeTrigger;

function getTooltip() {
  if (tooltip) {
    return tooltip;
  }

  tooltip = document.createElement("div");
  tooltip.className = "app-floating-tooltip";
  tooltip.id = "app-floating-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  return tooltip;
}

function positionTooltip() {
  if (!activeTrigger || !tooltip || tooltip.hidden) {
    return;
  }

  const triggerRect = activeTrigger.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const roomAbove = triggerRect.top - TOOLTIP_OFFSET;
  const showAbove = roomAbove >= tooltipRect.height + VIEWPORT_GUTTER;
  const top = showAbove
    ? triggerRect.top - tooltipRect.height - TOOLTIP_OFFSET
    : triggerRect.bottom + TOOLTIP_OFFSET;
  const idealLeft = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
  const left = Math.max(
    VIEWPORT_GUTTER,
    Math.min(idealLeft, window.innerWidth - tooltipRect.width - VIEWPORT_GUTTER)
  );

  tooltip.style.left = Math.round(left) + "px";
  tooltip.style.top = Math.round(top) + "px";
  tooltip.dataset.placement = showAbove ? "top" : "bottom";
}

function showTooltip(trigger) {
  const message = trigger.getAttribute("data-tooltip");
  if (!message) {
    return;
  }

  activeTrigger = trigger;
  const element = getTooltip();
  element.textContent = message;
  element.hidden = false;
  trigger.setAttribute("aria-describedby", element.id);
  positionTooltip();
}

function hideTooltip(trigger) {
  if (trigger && trigger !== activeTrigger) {
    return;
  }

  if (activeTrigger) {
    activeTrigger.removeAttribute("aria-describedby");
  }
  activeTrigger = null;
  if (tooltip) {
    tooltip.hidden = true;
  }
}

export function initFloatingLayer() {
  document.addEventListener("pointerover", function (event) {
    const trigger = event.target.closest("[data-tooltip]");
    if (trigger && !trigger.contains(event.relatedTarget)) {
      showTooltip(trigger);
    }
  });

  document.addEventListener("pointerout", function (event) {
    const trigger = event.target.closest("[data-tooltip]");
    if (trigger && !trigger.contains(event.relatedTarget)) {
      hideTooltip(trigger);
    }
  });

  document.addEventListener("focusin", function (event) {
    const trigger = event.target.closest("[data-tooltip]");
    if (trigger) {
      showTooltip(trigger);
    }
  });

  document.addEventListener("focusout", function (event) {
    const trigger = event.target.closest("[data-tooltip]");
    if (trigger) {
      hideTooltip(trigger);
    }
  });

  window.addEventListener("resize", positionTooltip);
  document.addEventListener("scroll", positionTooltip, true);
}
