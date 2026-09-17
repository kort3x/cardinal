import { createCardScene } from "/packages/card-engine/src/index.js";

const stage = document.querySelector("#stage");
const message = document.querySelector("#message");
const membership = document.querySelector("#state");
const selection = document.querySelector("#selection");
const geometry = { x: 0, y: 500, width: 600, height: 360, depth: 0 };
const initial = {
  cards: Array.from({ length: 6 }, (_, index) => ({
    id: `card-${index + 1}`, activeFaceId: "front", faceUp: true,
    dimensions: { width: 110, height: 150 }, thickness: 6,
    faces: { front: { background: ["#e5c07b", "#98c379", "#61afef"][Math.floor(index / 2)], elements: [
      { id: "title", type: "text", content: { text: `Card ${index + 1}` }, style: { variant: "title" } },
      { id: "body", type: "text", content: { text: "Responsive zones" } },
    ] } },
    back: { background: "#17212b", elements: [] },
  })),
  zones: [
    { id: "lake", anchor: "#lake", capacity: 6, cardIds: ["card-1", "card-2"], arrangement: { type: "grid", gap: 18 } },
    { id: "ocean", anchor: "#ocean", capacity: 6, cardIds: ["card-3", "card-4"], arrangement: { type: "grid", gap: 18 } },
    { id: "river", geometry, capacity: 6, cardIds: ["card-5", "card-6"], arrangement: { type: "hand", curve: "concave" } },
  ],
};

export let scene;
function update() {
  const state = scene.snapshot();
  membership.textContent = state.desired.zones.map((zone) => `${zone.id}: ${zone.cardIds.join(", ") || "empty"}`).join("\n")
    + `\n${state.renderer} · ${state.settling ? "animating" : "stable"}`;
  for (const input of selection.querySelectorAll("input")) input.checked = state.selection.cardIds.includes(input.value);
  const view = scene.viewport();
  const outline = document.querySelector("#spatial-outline");
  outline.style.left = `${(geometry.x - view.center.x + view.width / 2) * stage.clientWidth / view.width}px`;
  outline.style.top = `${(geometry.y - view.center.y + view.height / 2) * stage.clientHeight / view.height}px`;
  outline.style.width = `${geometry.width * stage.clientWidth / view.width}px`;
  outline.style.height = `${geometry.height * stage.clientHeight / view.height}px`;
}

function start(snapshot = initial) {
  scene?.destroy();
  scene = createCardScene({ element: stage, camera: { center: { x: 450, y: 450 } }, motion: { duration: 700, reducedMotion: document.querySelector("#reduced").checked } });
  scene.apply(snapshot);
  scene.on("change", update);
  scene.on("renderer-status", update);
  scene.select(["card-1", "card-2"]);
  update();
}

for (const card of initial.cards) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = card.id;
  input.title = `Select or deselect ${card.id}.`;
  input.addEventListener("change", () => scene.select([card.id], { mode: "toggle" }));
  label.append(input, card.id);
  selection.append(label);
}

async function transfer(to) {
  try {
    const index = Number(document.querySelector("#slot").value);
    const cards = scene.snapshot().selection.cardIds;
    const operations = cards.map((cardId, offset) => ({ type: "move", cardId, to, index: index + offset }));
    message.textContent = `Moving ${cards.length} cards to ${to}…`;
    await scene.transact(operations).finished;
    message.textContent = `Transfer to ${to} finished.`;
  } catch (error) { message.textContent = error.message; }
}
document.querySelectorAll("[data-to]").forEach((button) => button.addEventListener("click", () => transfer(button.dataset.to)));
document.querySelector("#route").addEventListener("click", async (event) => {
  event.target.disabled = true;
  try { for (const zone of ["ocean", "river", "lake"]) await transfer(zone); }
  finally { event.target.disabled = false; }
});
document.querySelector("#reflow").addEventListener("click", (event) => {
  event.target.setAttribute("aria-pressed", String(stage.classList.toggle("narrow")));
});
document.querySelector("#hide-zone").addEventListener("click", (event) => {
  const anchor = document.querySelector("#ocean");
  anchor.hidden = !anchor.hidden;
  event.target.setAttribute("aria-pressed", String(anchor.hidden));
  event.target.textContent = anchor.hidden ? "Restore Ocean" : "Hide Ocean";
});
document.querySelector("#depth").addEventListener("click", (event) => {
  const enabled = event.target.getAttribute("aria-pressed") !== "true";
  scene.transact([{ type: "zone", zoneId: "ocean", changes: { depth: enabled ? -180 : 0 } }]);
  event.target.setAttribute("aria-pressed", String(enabled));
});
document.querySelector("#scroll").addEventListener("click", () => window.scrollBy({ top: 220, behavior: "smooth" }));
document.querySelector("#reduced").addEventListener("change", () => start(scene.snapshot().desired));
start();
