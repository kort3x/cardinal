// Interaction feedback is a presentation layer; it never changes card content or
// owns input. WebGL keeps its one persistent accessible shell per logical card.
export function createFeedback({ element, scene }) {
  const doc = element?.ownerDocument;
  if (!doc?.createElement) return { updateCard() {}, remove() {}, destroy() {} };
  const layer = doc.createElement('div');
  layer.className = 'cardinal-feedback-layer';
  layer.setAttribute('aria-hidden', 'true');
  element.append(layer);
  const entries = new Map();
  let hoverId = null;
  let focusId = null;
  const shellId = (target) => target?.closest?.('[data-card-id]')?.dataset.cardId ?? null;
  const paint = (id) => {
    const entry = entries.get(id);
    if (!entry) return;
    const { card, pose, node } = entry;
    const feedback = card.feedback ?? {};
    const focused = focusId === id;
    const hovered = hoverId === id;
    const show = focused || hovered || feedback.disabled || feedback.pending || feedback.actionable;
    node.hidden = !show || pose.visible === false;
    if (node.hidden) return;
    const rect = element.getBoundingClientRect();
    const scale = (pose.scale ?? 1) * (pose.layoutScale ?? 1) * (pose.depthScale ?? 1);
    const point = scene.sceneToClient(pose);
    const edge = scene.sceneToClient({ ...pose, x: pose.x + pose.width * scale / 2, y: pose.y + pose.height * scale / 2 });
    node.style.left = `${point.x - rect.left + element.scrollLeft}px`;
    node.style.top = `${point.y - rect.top + element.scrollTop}px`;
    node.style.width = `${Math.abs(edge.x - point.x) * 2 + 8}px`;
    node.style.height = `${Math.abs(edge.y - point.y) * 2 + 8}px`;
    node.style.transform = `translate(-50%, -50%) rotate(${pose.angle ?? 0}deg)`;
    node.dataset.focused = String(focused);
    node.dataset.hovered = String(hovered);
    node.dataset.disabled = String(Boolean(feedback.disabled));
    node.dataset.pending = String(Boolean(feedback.pending));
    node.dataset.actionable = String(Boolean(feedback.actionable));
    node.textContent = [feedback.disabled && 'Unavailable', feedback.pending && 'Pending', feedback.actionable && !feedback.disabled && 'Actionable'].filter(Boolean).join(' · ');
  };
  const hover = (event) => {
    if (event.pointerType === 'touch' || event.buttons) return;
    const point = scene.clientToScene({ x: event.clientX, y: event.clientY });
    const next = scene.hitTest(point)?.cardId ?? null;
    if (next === hoverId) return;
    const previous = hoverId; hoverId = next; paint(previous); paint(next);
  };
  const leave = () => { const previous = hoverId; hoverId = null; paint(previous); };
  const focus = (event) => { const previous = focusId; focusId = shellId(event.target); paint(previous); paint(focusId); };
  const blur = (event) => { const previous = focusId; focusId = shellId(event.relatedTarget); paint(previous); paint(focusId); };
  element.addEventListener('pointermove', hover);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('pointerdown', leave);
  element.addEventListener('focusin', focus);
  element.addEventListener('focusout', blur);
  return {
    updateCard(card, pose) {
      let entry = entries.get(card.id);
      if (!entry) {
        const node = doc.createElement('div');
        node.className = 'cardinal-feedback'; node.dataset.sourceCardId = card.id;
        layer.append(node); entry = { node }; entries.set(card.id, entry);
      }
      entry.card = card; entry.pose = pose; paint(card.id);
    },
    remove(id) { entries.get(id)?.node.remove(); entries.delete(id); },
    destroy() {
      element.removeEventListener('pointermove', hover); element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointerdown', leave); element.removeEventListener('focusin', focus); element.removeEventListener('focusout', blur);
      layer.remove(); entries.clear();
    },
  };
}
