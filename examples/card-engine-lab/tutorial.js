const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const TUTORIAL_ZONE_TOKENS = Object.freeze({ Lake: "lake", River: "river", Ocean: "ocean" });
const TUTORIAL_KEYWORDS = Object.freeze([
  "Arrangement & alignment", "Cross-zone selection", "Record next drag", "Set up inspection",
  "Run reshape demo", "Reduced motion", "Normally not pickable", "Preserve space", "Auto height",
  "Fixed size", "Touch drag", "Select all", "Grab point", "Card center", "3D lift", "Sent to",
  "Spawn in", "Not pickable", "Add", "Cards", "Selection", "Slot", "Zone controls", "Grid",
  "Row", "Column", "Splay", "Pile", "Stack", "Hand", "Natural", "Crisp", "Floaty", "Wizzard",
  "Dramatic dangle", "Lift scale", "Dangly", "Damping", "Landing", "Bounce", "Delay", "Move",
  "Rotate", "Scale", "Flip", "Spin", "Demo", "Random", "Test", "Dimensions", "Weight", "Reveal",
  "Conceal", "Inspection", "Content face", "Hide", "Remove", "Reflow", "Update text", "Benchmark",
  "Refresh the report", "Refresh report", "Copy report", "Next", "Back", "Finish", "Close",
]);
const TUTORIAL_KEYWORD_SET = new Set(TUTORIAL_KEYWORDS.map((keyword) => keyword.toLowerCase()));
const TUTORIAL_TOKEN_PATTERN = new RegExp(
  `(?<![A-Za-z0-9])(${Object.keys(TUTORIAL_ZONE_TOKENS).concat(TUTORIAL_KEYWORDS)
    .sort((first, second) => second.length - first.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(?![A-Za-z0-9])`,
  "gi",
);

function renderTutorialBody(body, text) {
  body.replaceChildren();
  let cursor = 0;
  for (const match of text.matchAll(TUTORIAL_TOKEN_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) body.append(document.createTextNode(text.slice(cursor, start)));
    const normalized = token.toLowerCase();
    const element = document.createElement("span");
    const zoneId = Object.entries(TUTORIAL_ZONE_TOKENS).find(([name]) => name.toLowerCase() === normalized)?.[1];
    element.className = zoneId ? `lab-tutorial__zone lab-tutorial__zone--${zoneId}`
      : TUTORIAL_KEYWORD_SET.has(normalized) ? "lab-tutorial__keyword" : "";
    element.textContent = token;
    body.append(element);
    cursor = start + token.length;
  }
  if (cursor < text.length) body.append(document.createTextNode(text.slice(cursor)));
}

function focusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((element) => element.getClientRects().length > 0);
}

function targetFor(step) {
  if (!step?.target || typeof step.target !== "string") return null;
  try {
    return document.querySelector(step.target);
  } catch {
    return null;
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function createLabTutorial({ steps = [], trigger } = {}) {
  const tutorialSteps = Array.isArray(steps) ? steps.filter(Boolean) : [];
  let overlay;
  let dialog;
  let spotlight;
  let title;
  let body;
  let progress;
  let previousButton;
  let nextButton;
  let closeButton;
  let currentIndex = 0;
  let activeElement;
  let running = false;
  let destroyed = false;
  let inertElements = [];
  let expandedDetails = new Map();

  const resizeTargets = () => positionCurrentStep();

  function makeButton(label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lab-tutorial__button ${className}`;
    button.textContent = label;
    return button;
  }

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "lab-tutorial";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const backdrop = document.createElement("div");
    backdrop.className = "lab-tutorial__backdrop";
    backdrop.setAttribute("aria-hidden", "true");

    spotlight = document.createElement("div");
    spotlight.className = "lab-tutorial__spotlight";
    spotlight.setAttribute("aria-hidden", "true");

    dialog = document.createElement("section");
    dialog.className = "lab-tutorial__dialog lab-tutorial__panel";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "lab-tutorial-title");
    dialog.setAttribute("aria-describedby", "lab-tutorial-body");
    dialog.tabIndex = -1;

    const header = document.createElement("div");
    header.className = "lab-tutorial__header";
    progress = document.createElement("p");
    progress.className = "lab-tutorial__progress";
    progress.setAttribute("aria-live", "polite");
    title = document.createElement("h2");
    title.className = "lab-tutorial__title";
    title.id = "lab-tutorial-title";
    closeButton = makeButton("Close", "lab-tutorial__close");
    closeButton.setAttribute("aria-label", "Close Lab tutorial");
    closeButton.dataset.tutorialAction = "close";
    header.append(progress, title, closeButton);

    body = document.createElement("p");
    body.className = "lab-tutorial__body";
    body.id = "lab-tutorial-body";

    const footer = document.createElement("div");
    footer.className = "lab-tutorial__footer";
    previousButton = makeButton("Back", "lab-tutorial__previous");
    nextButton = makeButton("Next", "lab-tutorial__next");
    previousButton.dataset.tutorialAction = "back";
    nextButton.dataset.tutorialAction = "next";
    footer.append(previousButton, nextButton);

    dialog.append(header, body, footer);
    overlay.append(backdrop, spotlight, dialog);
    document.body.append(overlay);

    closeButton.addEventListener("click", close);
    previousButton.addEventListener("click", () => showStep(currentIndex - 1));
    nextButton.addEventListener("click", () => {
      if (currentIndex === tutorialSteps.length - 1) close();
      else showStep(currentIndex + 1);
    });
    overlay.addEventListener("keydown", (event) => event.stopPropagation());
  }

  function setInert(value) {
    if (value) {
      inertElements = [...document.body.children]
        .filter((element) => element !== overlay)
        .map((element) => ({ element, inert: element.inert }));
      inertElements.forEach(({ element }) => { element.inert = true; });
    } else {
      inertElements.forEach(({ element, inert }) => { element.inert = inert; });
      inertElements = [];
    }
  }

  function openTargetDetails(target) {
    if (!target) return;
    let ancestor = target.matches("details") ? target : target.parentElement;
    while (ancestor) {
      if (ancestor.matches("details")) {
        if (!expandedDetails.has(ancestor)) {
          const summary = ancestor.querySelector(":scope > summary");
          expandedDetails.set(ancestor, {
            element: ancestor,
            open: ancestor.open,
            id: ancestor.id,
            className: ancestor.className,
            summary: summary?.textContent.trim(),
            zoneId: ancestor.closest("[data-zone-id]")?.dataset.zoneId,
          });
        }
        ancestor.open = true;
      }
      ancestor = ancestor.parentElement;
    }
  }

  function restoreTargetDetails() {
    expandedDetails.forEach(({ element, open, id, className, summary, zoneId }) => {
      if (element.isConnected) {
        element.open = open;
        return;
      }
      const replacement = id
        ? document.getElementById(id)
        : [...document.querySelectorAll("details")].find((candidate) => {
          const candidateSummary = candidate.querySelector(":scope > summary");
          return candidate.className === className && candidateSummary?.textContent.trim() === summary
            && candidate.closest("[data-zone-id]")?.dataset.zoneId === zoneId;
        });
      if (replacement) replacement.open = open;
    });
    expandedDetails.clear();
  }

  function scrollTargetIntoView(target) {
    if (!target) return;
    try {
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    } catch {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function prepareCurrentTarget() {
    const target = targetFor(tutorialSteps[currentIndex]);
    openTargetDetails(target);
    scrollTargetIntoView(target);
  }

  function clippedTargetRect(target) {
    const rect = target.getBoundingClientRect();
    const viewport = {
      left: 0,
      top: 0,
      right: document.documentElement.clientWidth || window.innerWidth,
      bottom: document.documentElement.clientHeight || window.innerHeight,
    };
    const clipped = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      const style = window.getComputedStyle(ancestor);
      if ([style.overflow, style.overflowX, style.overflowY].some((value) => value !== "visible")) {
        const ancestorRect = ancestor.getBoundingClientRect();
        clipped.left = Math.max(clipped.left, ancestorRect.left);
        clipped.top = Math.max(clipped.top, ancestorRect.top);
        clipped.right = Math.min(clipped.right, ancestorRect.right);
        clipped.bottom = Math.min(clipped.bottom, ancestorRect.bottom);
      }
      ancestor = ancestor.parentElement;
    }
    clipped.left = Math.max(clipped.left, viewport.left);
    clipped.top = Math.max(clipped.top, viewport.top);
    clipped.right = Math.min(clipped.right, viewport.right);
    clipped.bottom = Math.min(clipped.bottom, viewport.bottom);
    return clipped.right > clipped.left && clipped.bottom > clipped.top ? {
      ...clipped,
      width: clipped.right - clipped.left,
      height: clipped.bottom - clipped.top,
    } : null;
  }

  function positionCurrentStep() {
    if (!running || !dialog) return;
    const step = tutorialSteps[currentIndex];
    const target = targetFor(step);

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const margin = 16;
    const targetBox = target ? clippedTargetRect(target) : null;

    overlay.classList.toggle("lab-tutorial--no-target", !targetBox);
    spotlight.hidden = !targetBox;
    if (targetBox) {
      const left = Math.max(0, targetBox.left - 8);
      const top = Math.max(0, targetBox.top - 8);
      spotlight.style.left = `${left}px`;
      spotlight.style.top = `${top}px`;
      spotlight.style.width = `${Math.min(viewportWidth, targetBox.right + 8) - left}px`;
      spotlight.style.height = `${Math.min(viewportHeight, targetBox.bottom + 8) - top}px`;
    }

    const dialogRect = dialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width;
    const dialogHeight = dialogRect.height;
    const gap = 18;
    const alignedLeft = targetBox ? clamp(targetBox.left, margin, viewportWidth - dialogWidth - margin) : margin;
    const alignedTop = targetBox ? clamp(targetBox.top, margin, viewportHeight - dialogHeight - margin) : margin;
    const candidates = targetBox ? [
      [alignedLeft, targetBox.bottom + gap],
      [alignedLeft, targetBox.top - dialogHeight - gap],
      [targetBox.right + gap, alignedTop],
      [targetBox.left - dialogWidth - gap, alignedTop],
    ] : [[(viewportWidth - dialogWidth) / 2, (viewportHeight - dialogHeight) / 2]];
    const fits = ([left, top]) => (
      left >= margin && top >= margin
      && left + dialogWidth <= viewportWidth - margin
      && top + dialogHeight <= viewportHeight - margin
    );
    const [left, top] = candidates.find(fits) ?? candidates[0];
    dialog.style.left = `${clamp(left, margin, viewportWidth - dialogWidth - margin)}px`;
    dialog.style.top = `${clamp(top, margin, viewportHeight - dialogHeight - margin)}px`;
  }

  function showStep(index) {
    if (!running || index < 0 || index >= tutorialSteps.length) return;
    currentIndex = index;
    const step = tutorialSteps[currentIndex];
    overlay.dataset.stepId = step.id == null ? "" : String(step.id);
    overlay.dataset.stepIndex = String(currentIndex);
    progress.textContent = `Step ${currentIndex + 1} of ${tutorialSteps.length}`;
    title.textContent = typeof step.title === "string" ? step.title : "Lab tutorial";
    renderTutorialBody(body, typeof step.body === "string" ? step.body : "");
    previousButton.disabled = currentIndex === 0;
    nextButton.textContent = currentIndex === tutorialSteps.length - 1 ? "Finish" : "Next";
    body.scrollTop = 0;
    prepareCurrentTarget();
    positionCurrentStep();
  }

  function handleKeydown(event) {
    if (!running) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") {
      if (!dialog.contains(event.target)) event.stopPropagation();
      return;
    }
    const focusable = focusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function start() {
    if (destroyed || running || !tutorialSteps.length) return;
    if (!overlay) buildOverlay();
    activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    running = true;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    setInert(true);
    document.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", resizeTargets);
    window.addEventListener("scroll", resizeTargets, true);
    window.visualViewport?.addEventListener("resize", resizeTargets);
    window.visualViewport?.addEventListener("scroll", resizeTargets);
    showStep(0);
    closeButton.focus();
  }

  function close() {
    if (!running) return;
    running = false;
    document.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("resize", resizeTargets);
    window.removeEventListener("scroll", resizeTargets, true);
    window.visualViewport?.removeEventListener("resize", resizeTargets);
    window.visualViewport?.removeEventListener("scroll", resizeTargets);
    restoreTargetDetails();
    setInert(false);
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    if (activeElement?.isConnected && typeof activeElement.focus === "function") activeElement.focus();
    activeElement = null;
  }

  function destroy() {
    if (destroyed) return;
    close();
    destroyed = true;
    trigger?.removeEventListener("click", start);
    overlay?.remove();
    overlay = undefined;
  }

  trigger?.addEventListener("click", start);

  return { start, close, destroy };
}

export { createLabTutorial };
