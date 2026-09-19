import { normalizeElement } from "./model.js";

function affinityFor(value) {
  if (value === undefined) return "front";
  if (!["front", "back", "both"].includes(value)) {
    throw new TypeError(`Attachment affinity must be front, back, or both`);
  }
  return value;
}

function normalizeControls(controls, attachmentId) {
  if (controls === undefined) return undefined;
  if (!Array.isArray(controls)) throw new TypeError(`Attachment ${attachmentId} controls must be an array`);
  const ids = new Set();
  return controls.map((control) => {
    if (!control || typeof control.id !== "string" || !control.id
      || typeof control.label !== "string" || !control.label) {
      throw new TypeError(`Attachment ${attachmentId} controls require id and label`);
    }
    if (ids.has(control.id)) throw new Error(`Attachment ${attachmentId} control ids must be unique`);
    ids.add(control.id);
    if (control.disabled !== undefined && typeof control.disabled !== "boolean") {
      throw new TypeError(`Attachment ${attachmentId} control disabled must be boolean`);
    }
    return { id: control.id, label: control.label, ...(control.disabled === undefined ? {} : { disabled: control.disabled }) };
  });
}

export function normalizeAttachment(attachment, attachmentId, index = 0) {
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
    throw new TypeError(`Attachment ${attachmentId} requires an object`);
  }
  const element = normalizeElement({
    ...attachment,
    id: attachmentId,
    layout: {
      mode: "overlay", anchor: "card", missingAnchor: "hide",
      x: 0, y: 0, width: 0.5, height: 0.2, offsetX: 0, offsetY: 0, clip: true,
      ...(attachment.layout ?? {}),
    },
  }, index);
  const controls = normalizeControls(attachment.controls, attachmentId);
  const normalized = {
    ...element,
    affinity: affinityFor(attachment.affinity),
    ...(attachment.faceId === undefined ? {} : { faceId: attachment.faceId }),
    ...(controls === undefined ? {} : { controls }),
  };
  if (normalized.faceId !== undefined && (typeof normalized.faceId !== "string" || !normalized.faceId)) {
    throw new TypeError(`Attachment ${attachmentId} faceId must be a non-empty string`);
  }
  return normalized;
}

function appliesToFace(attachment, faceId) {
  if (attachment.faceId !== undefined) return attachment.faceId === faceId;
  if (faceId === "back") return attachment.affinity === "back" || attachment.affinity === "both";
  return attachment.affinity === "front" || attachment.affinity === "both";
}

export function validateAttachmentAnchors(attachments = []) {
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const visiting = new Set();
  const visited = new Set();
  function visit(attachment) {
    if (visited.has(attachment.id)) return;
    if (visiting.has(attachment.id)) throw new Error(`Attachment anchor cycle includes ${attachment.id}`);
    visiting.add(attachment.id);
    const anchor = attachment.layout?.anchor;
    if (anchor && anchor !== "card" && byId.has(anchor)) visit(byId.get(anchor));
    visiting.delete(attachment.id);
    visited.add(attachment.id);
  }
  for (const attachment of attachments) visit(attachment);
  return byId;
}

function applyPresentation(element, presentation) {
  if (!presentation) return element;
  const included = !presentation.elements || presentation.elements.includes(element.id);
  const visible = Object.hasOwn(presentation.visibility ?? {}, element.id)
    ? presentation.visibility[element.id] : element.visible !== false;
  return { ...element, visible: included && visible };
}

/** Project card-level attachments into a face's ordinary element contract. */
export function attachmentContent(card, faceId, presentation) {
  const face = faceId === "back" ? card.back : card.faces?.[faceId];
  const attachments = card.attachments ?? [];
  if (!attachments.length) return face;
  validateAttachmentAnchors(attachments);
  const applicable = attachments.filter((attachment) => appliesToFace(attachment, faceId));
  if (!applicable.length) return applyFacePresentation(face, presentation);
  const ordinary = (face?.elements ?? []).map((element) => applyPresentation(element, presentation));
  const elementsById = new Map([...ordinary, ...applicable].map((element) => [element.id, element]));
  const effectiveById = new Map();
  const resolving = new Set();
  const resolveAttachment = (attachment) => {
    if (effectiveById.has(attachment.id)) return effectiveById.get(attachment.id);
    if (resolving.has(attachment.id)) return { visible: false, fallback: false };
    resolving.add(attachment.id);
    const anchor = attachment.layout?.anchor;
    const anchorVisible = anchor === undefined || anchor === "card"
      ? true : elementsById.has(anchor) && resolveAttachment(elementsById.get(anchor)).visible;
    const included = !presentation?.elements || presentation.elements.includes(attachment.id);
    const requestedVisible = Object.hasOwn(presentation?.visibility ?? {}, attachment.id)
      ? presentation.visibility[attachment.id] : attachment.visible !== false;
    const fallback = !anchorVisible && attachment.layout?.missingAnchor === "card";
    const effective = {
      visible: included && requestedVisible && (anchorVisible || fallback),
      fallback,
    };
    effectiveById.set(attachment.id, effective);
    resolving.delete(attachment.id);
    return effective;
  };
  const projected = applicable.map((attachment, index) => {
    const effective = resolveAttachment(attachment);
    const missing = effective.fallback ? { layout: { ...attachment.layout, anchor: "card" } } : {};
    return {
      ...attachment,
      id: attachment.id,
      attachmentId: attachment.id,
      source: "attachment",
      attachmentVisibilityResolved: true,
      layout: { ...attachment.layout, order: attachment.layout?.order ?? ordinary.length + index },
      visible: effective.visible,
      ...missing,
    };
  });
  return { ...(face ?? {}), elements: [...ordinary, ...projected] };
}

function applyFacePresentation(face, presentation) {
  if (!presentation || !face?.elements) return face;
  return { ...face, elements: face.elements.map((element) => applyPresentation(element, presentation)) };
}
