import { createCardScene } from "../../packages/card-engine/src/index.js";

const stage = document.querySelector("#stage");
const status = document.querySelector("#status");
const flipButton = document.querySelector("#flip");
const spinButton = document.querySelector("#spin");

const card = {
  id: "inventory-token",
  activeFaceId: "front",
  faceUp: true,
  faces: {
    front: {
      title: "Inventory token",
      flavour: "An independent consumer of Cardinal.",
      background: "#367c83",
      textColor: "#f7f4e9",
      mutedTextColor: "#c5e4df",
    },
  },
  back: {
    title: "Concealed",
    flavour: "The token is face down.",
    background: "#17212b",
    textColor: "#f7f4e9",
    mutedTextColor: "#bdcbd0",
  },
  template: "token",
};

const scene = createCardScene({
  element: stage,
  templates: { token: { width: 180, height: 250, shape: "rounded-rectangle" } },
  motion: { duration: 500 },
});

scene.apply({
  cards: [card],
  zones: [{
    id: "inventory",
    cardIds: [card.id],
    geometry: { x: 0, y: 0, width: 900, height: 500, depth: 0 },
    arrangement: { type: "grid", gap: 16 },
  }],
});

function updateStatus() {
  const state = scene.snapshot();
  const current = currentCard(state);
  status.textContent = `${state.renderer} · ${current.faceUp ? "front" : "back"} · ${state.settling ? "animating" : "stable"}`;
  flipButton.textContent = current.faceUp ? "Show back" : "Show front";
}

function currentCard(state = scene.snapshot()) {
  return state.desired.cards[0];
}

scene.on("change", updateStatus);
flipButton.addEventListener("click", () => {
  scene.transact([{
    type: "face",
    cardId: card.id,
    face: currentCard().faceUp ? "faceDown" : "faceUp",
    axis: "y",
  }]);
});

let spin;
spinButton.addEventListener("click", () => {
  if (spin?.active) {
    spin.stop();
    spin = undefined;
  } else {
    spin = scene.spin(card.id, { axis: "y", direction: 1, speed: 180 });
  }
  spinButton.setAttribute("aria-pressed", String(Boolean(spin?.active)));
});

updateStatus();
