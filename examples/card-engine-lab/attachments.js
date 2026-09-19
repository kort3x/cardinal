/* Project-owned attachment examples.  Cardinal owns placement and lifecycle;
 * these renderers only describe the Lab's visual meaning and controls. */

function textValue(element, fallback = "") {
  return String(element?.content?.text ?? element?.content?.value ?? fallback);
}

function roundedRect(context, x, y, width, height, radius = 8) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export const attachmentRenderers = Object.freeze({
  stamp: {
    measure: () => 30,
    draw: ({ context, element, x, y, width, height }) => {
      context.save();
      context.fillStyle = "#d7a84d";
      context.strokeStyle = "#4b3210";
      context.lineWidth = 2;
      roundedRect(context, x, y, width, height, 7);
      context.fill();
      context.stroke();
      context.fillStyle = "#21170a";
      context.font = "700 12px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(textValue(element, "TRAVEL"), x + width / 2, y + height / 2);
      context.restore();
    },
    accessibleLabel: ({ element }) => `Stamp: ${textValue(element, "travelling")}`,
  },
  counter: {
    measure: () => 34,
    draw: ({ context, element, x, y, width, height }) => {
      const value = Number(element?.content?.value ?? 0);
      context.save();
      context.fillStyle = "#202833";
      context.strokeStyle = "#e5c07b";
      context.lineWidth = 2;
      roundedRect(context, x, y, width, height, height / 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#f2f4f7";
      context.font = "700 16px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(value), x + width / 2, y + height / 2);
      context.restore();
    },
    accessibleLabel: ({ element }) => `Counter: ${Number(element?.content?.value ?? 0)}`,
    onAction: ({ cardId, attachmentId, controlId }) => ({ cardId, attachmentId, controlId }),
  },
  sticker: {
    measure: () => 42,
    draw: ({ context, element, x, y, width, height }) => {
      context.save();
      context.fillStyle = element?.content?.color ?? "#e7edf4";
      context.strokeStyle = "#273341";
      context.lineWidth = 2;
      context.shadowColor = "rgb(0 0 0 / 24%)";
      context.shadowBlur = 5;
      roundedRect(context, x, y, width, height, 10);
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = "#1d2732";
      context.font = "700 11px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(textValue(element, "sticker"), x + width / 2, y + height / 2);
      context.restore();
    },
    accessibleLabel: ({ element }) => `Sticker: ${textValue(element, "sticker")}`,
  },
});

export function stampAttachment(id = "travelling-stamp") {
  return { id, type: "stamp", content: { text: "TRAVELLING" }, affinity: "both",
    layout: { mode: "overlay", anchor: "card", x: 0.06, y: 0.06, width: 0.48, height: 0.14, clip: true, zIndex: 8 } };
}

export function counterAttachment(id = "trip-counter", value = 0) {
  return { id, type: "counter", content: { label: "Trips", value }, affinity: "front",
    layout: { mode: "flow", width: 0.32, height: 0.12, clip: true, zIndex: 9 },
    controls: [{ id: "increment", label: "Increment counter" }] };
}

export function stickerAttachment(id, label, anchor = "image", missingAnchor = "hide") {
  return { id, type: "sticker", content: { text: label, color: "#d9e8f7" }, affinity: "front",
    layout: { mode: "overlay", anchor, missingAnchor, x: id.endsWith("beta") ? 0.58 : 0.12,
      y: id.endsWith("beta") ? 0.62 : 0.16, width: 0.3, height: 0.18,
      offsetX: id.endsWith("beta") ? -6 : 8, offsetY: id.endsWith("beta") ? -5 : 5, clip: false, zIndex: 12 } };
}
