import test from "node:test";
import assert from "node:assert/strict";
import { attachmentControlKey, resolveAttachmentGeometry } from "../src/renderers/attachment-renderer.js";

test("attachment control keys keep delimiter-containing identities distinct", () => {
  assert.notEqual(attachmentControlKey("a:b", "c", "d"), attachmentControlKey("a", "b:c", "d"));
  assert.deepEqual(JSON.parse(attachmentControlKey("card", "attachment", "control")), ["card", "attachment", "control"]);
});

test("attachment geometry uses current flow boxes and card fallback without screen rectangles", () => {
  const content = {
    elements: [
      { id: "image", type: "image", layout: { mode: "flow", height: 0.4 } },
      { id: "sticker", type: "text", source: "attachment", attachmentId: "sticker", content: { text: "!" }, layout: {
        mode: "overlay", anchor: "image", x: 0.5, y: 0, width: 0.5, height: 0.5, offsetX: 3, offsetY: 4,
      } },
      { id: "stamp", type: "text", source: "attachment", attachmentId: "stamp", content: { text: "stamp" }, layout: {
        mode: "overlay", anchor: "missing", missingAnchor: "hide", width: 1, height: 0.2,
      } },
      { id: "counter", type: "text", source: "attachment", attachmentId: "counter", content: { text: "1" }, layout: {
        mode: "overlay", anchor: "missing", missingAnchor: "card", x: 0, y: 0, width: 0.25, height: 0.2,
      } },
    ],
  };
  const boxes = resolveAttachmentGeometry(content, { width: 200, height: 300 });
  assert.deepEqual(boxes.get("image"), { x: 18, y: 18, width: 164, height: 120, mode: "flow", element: content.elements[0] });
  assert.equal(boxes.get("sticker").x, 103);
  assert.equal(boxes.get("sticker").y, 22);
  assert.equal(boxes.has("stamp"), false);
  assert.equal(boxes.get("counter").width, 50);
});

test("presentation removes attachment boxes before control or plane consumers see them", () => {
  const content = { elements: [
    { id: "visible", type: "text", source: "attachment", layout: { mode: "overlay", width: 1, height: 1 } },
    { id: "hidden", type: "text", source: "attachment", layout: { mode: "overlay", width: 1, height: 1 } },
  ] };
  const boxes = resolveAttachmentGeometry(content, { width: 100, height: 100 }, {}, null, { elements: ["visible"] });
  assert.deepEqual([...boxes.keys()], ["visible"]);
});

test("attachment flow geometry shares card sizing text measurement", () => {
  const content = { elements: [{ id: "title", type: "text", variant: "title", content: { text: "hello\nworld" }, layout: { mode: "flow" } }] };
  const boxes = resolveAttachmentGeometry(content, { width: 200, height: 300 });
  assert.equal(boxes.get("title").height, 42);
});

test("attachment flow geometry preserves zero spacer heights", () => {
  const content = { elements: [{ id: "gap", type: "spacer", content: { height: 0 }, layout: { mode: "flow" } }] };
  const boxes = resolveAttachmentGeometry(content, { width: 200, height: 300 });
  assert.equal(boxes.get("gap").height, 0);
});
