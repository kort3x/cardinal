import { createPageEvaluator } from "./chrome-runtime.mjs";
import { runBatchAcceptance } from "./batch-scenario.mjs";

const MAC_MODIFIER = 4;
const CTRL_MODIFIER = 2;
const SHIFT_MODIFIER = 8;

function modifierMask({ toggle = false, shift = false } = {}) {
  return (toggle ? (process.platform === "darwin" ? MAC_MODIFIER : CTRL_MODIFIER) : 0)
    | (shift ? SHIFT_MODIFIER : 0);
}

function keyInfo(key) {
  const values = {
    " ": { key: " ", code: "Space", keyCode: 32, text: " " },
    a: { key: "a", code: "KeyA", keyCode: 65, text: "a" },
    A: { key: "A", code: "KeyA", keyCode: 65, text: "A" },
    Enter: { key: "Enter", code: "Enter", keyCode: 13 },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    Tab: { key: "Tab", code: "Tab", keyCode: 9 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  };
  return values[key] ?? { key, code: key, keyCode: 0 };
}

export async function runBatchScenario({ command } = {}) {
  if (typeof command !== "function") throw new TypeError("Batch scenario requires a CDP command function");
  const evaluate = createPageEvaluator(command);
  let mouseDown = false;
  let touchActive = false;
  let pickupPoint = null;

  async function mouseEvent(type, point, { buttons = mouseDown ? 1 : 0, modifiers = 0, button = "none", pointerType = "mouse" } = {}) {
    return command("Input.dispatchMouseEvent", {
      type, x: point.x, y: point.y, button, buttons, modifiers, pointerType,
      ...(type === "mousePressed" || type === "mouseReleased" ? { clickCount: 1 } : {}),
    });
  }

  const pointer = {
    async move(point) {
      return mouseEvent("mouseMoved", point);
    },
    async click(point, options = {}) {
      const modifiers = modifierMask(options);
      await mouseEvent("mouseMoved", point, { modifiers });
      await mouseEvent("mousePressed", point, { buttons: 1, modifiers, button: "left" });
      try {
        await mouseEvent("mouseReleased", point, { modifiers, button: "left" });
      } finally {
        mouseDown = false;
      }
    },
    async drag(start, destination, { steps = 8 } = {}) {
      pickupPoint = null;
      await mouseEvent("mouseMoved", start);
      await mouseEvent("mousePressed", start, { buttons: 1, button: "left" });
      mouseDown = true;
      try {
        for (let index = 1; index <= steps; index += 1) {
          const fraction = index / steps;
          const point = {
            x: start.x + (destination.x - start.x) * fraction,
            y: start.y + (destination.y - start.y) * fraction,
          };
          pickupPoint ??= point;
          await mouseEvent("mouseMoved", point, { buttons: 1, button: "left" });
        }
      } catch (error) {
        await pointer.cleanup().catch(() => {});
        throw error;
      }
    },
    get pickupPoint() {
      return pickupPoint;
    },
    async release(point) {
      if (!mouseDown) return;
      try {
        await mouseEvent("mouseReleased", point, { button: "left" });
      } finally {
        mouseDown = false;
      }
    },
    async cleanup() {
      if (!mouseDown) return;
      try {
        await mouseEvent("mouseReleased", { x: 0, y: 0 }, { button: "left" });
      } finally {
        mouseDown = false;
      }
    },
  };

  async function touchEvent(type, point, id = 1) {
    touchActive = type !== "touchEnd";
    try {
      return await command("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: point.x, y: point.y, id }],
        modifiers: 0,
      });
    } finally {
      if (type === "touchEnd" || type === "touchCancel") touchActive = false;
    }
  }

  const touch = {
    async tap(point) {
      await touchEvent("touchStart", point);
      await touchEvent("touchEnd", point);
    },
    async drag(start, destination, { steps = 8 } = {}) {
      await touchEvent("touchStart", start);
      try {
        for (let index = 1; index <= steps; index += 1) {
          const fraction = index / steps;
          await touchEvent("touchMove", {
            x: start.x + (destination.x - start.x) * fraction,
            y: start.y + (destination.y - start.y) * fraction,
          });
        }
      } catch (error) {
        await touch.cleanup().catch(() => {});
        throw error;
      }
    },
    async release(point) {
      if (touchActive) await touchEvent("touchEnd", point);
    },
    async cleanup() {
      if (touchActive) await touchEvent("touchEnd", { x: 0, y: 0 });
    },
  };

  let penDown = false;
  async function penEvent(type, point, { buttons = penDown ? 1 : 0, modifiers = 0, button = "none" } = {}) {
    try {
      return await mouseEvent(type, point, { buttons, modifiers, button, pointerType: "pen" });
    } finally {
      if (type === "mousePressed") penDown = true;
      if (type === "mouseReleased") penDown = false;
    }
  }

  const pen = {
    supported: true,
    async tap(point) {
      await penEvent("mouseMoved", point);
      await penEvent("mousePressed", point, { buttons: 1, button: "left" });
      await penEvent("mouseReleased", point, { button: "left" });
    },
    async click(point, options = {}) {
      const modifiers = modifierMask(options);
      await penEvent("mouseMoved", point, { modifiers });
      await penEvent("mousePressed", point, { buttons: 1, modifiers, button: "left" });
      await penEvent("mouseReleased", point, { modifiers, button: "left" });
    },
    async drag(start, destination, { steps = 8 } = {}) {
      await penEvent("mouseMoved", start);
      await penEvent("mousePressed", start, { buttons: 1, button: "left" });
      try {
        for (let index = 1; index <= steps; index += 1) {
          const fraction = index / steps;
          await penEvent("mouseMoved", {
            x: start.x + (destination.x - start.x) * fraction,
            y: start.y + (destination.y - start.y) * fraction,
          }, { buttons: 1, button: "left" });
        }
      } catch (error) {
        await pen.cleanup().catch(() => {});
        throw error;
      }
    },
    async release(point) {
      if (penDown) await penEvent("mouseReleased", point, { button: "left" });
    },
    async cleanup() {
      if (penDown) await penEvent("mouseReleased", { x: 0, y: 0 }, { button: "left" });
    },
  };

  const keyboard = {
    async press(key, options = {}) {
      const info = keyInfo(key);
      const modifiers = modifierMask(options);
      const base = {
        key: info.key,
        code: info.code,
        modifiers,
        windowsVirtualKeyCode: info.keyCode,
        nativeVirtualKeyCode: info.keyCode,
      };
      await command("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(info.text ? { text: info.text } : {}) });
      await command("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },
  };

  try {
    return await runBatchAcceptance({
      evaluate,
      pointer,
      keyboard,
      touch,
      pen,
      label: "Chrome batch acceptance",
      labUrl: process.env.CARDINAL_LAB_URL ?? "http://127.0.0.1:4173/",
    });
  } finally {
    await pointer.cleanup().catch(() => {});
    await touch.cleanup().catch(() => {});
    await pen.cleanup().catch(() => {});
    await evaluate(`(() => {
      const scene = globalThis.__cardinalGetScene?.();
      for (const session of scene?.snapshot?.().interaction?.sessions ?? []) {
        if (session.phase === "pending") scene.resolveDrop(session.id, { accepted: false });
      }
      globalThis.__cardinalBatchProbe?.unsubscribe?.();
      globalThis.__cardinalBatchProbe = null;
      return true;
    })()`).catch(() => {});
  }
}
