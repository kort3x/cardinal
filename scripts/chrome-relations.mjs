import { createPageEvaluator } from "./chrome-runtime.mjs";

export async function runRelationsScenario({ command }) {
  const evaluate = createPageEvaluator(command);
  const results = [];
  const record = async (label, expression) => {
    const pass = Boolean(await evaluate(expression));
    results.push({ label, pass });
  };
  const baseline = await evaluate(`(async()=>structuredClone((await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired))()`);
  const cards = baseline.cards.slice(0, 3);
  const setup = { cards, zones: [
    { id: "relation-lake", geometry: { x: 0, y: 0, width: 500, height: 400, depth: 0 }, cardIds: [cards[0].id] },
    { id: "relation-river", geometry: { x: 600, y: 0, width: 500, height: 400, depth: 0 }, cardIds: [cards[1].id, cards[2].id] },
  ], relationships: [
    { id: "relation-child", parentId: cards[0].id, childId: cards[1].id, offsetX: 22, angle: 8, affinity: "both" },
    { id: "relation-grandchild", parentId: cards[1].id, childId: cards[2].id, offsetY: 18, scale: 0.7, affinity: "both" },
  ] };
  try {
    await evaluate(`(async()=>{(await import('/examples/card-engine-lab/main.js')).getScene().apply(${JSON.stringify(setup)})})()`);
    await record("nested relations retain all card shells", `(async()=>{const s=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot();return s.visual.length===3&&s.desired.relationships.length===2;})()`);
    await record("children do not consume independent arrangement slots", `(async()=>{const s=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot();return s.desired.zones[0].cardIds.length===1&&s.visual.find(v=>v.cardId===${JSON.stringify(cards[1].id)})?.pose;})()`);
    await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();await scene.transact([{type:'move',cardId:${JSON.stringify(cards[0].id)},to:'relation-river',index:0},{type:'face',cardId:${JSON.stringify(cards[0].id)},face:'faceDown'}],{zoneFacePolicy:'override'}).finished;})()`);
    await record("parent move carries the nested subtree across zones", `(async()=>{const s=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot();return JSON.stringify(s.desired.zones.map(z=>z.cardIds))===${JSON.stringify(JSON.stringify([[], cards.map(c=>c.id)]))};})()`);
    await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();await scene.transact([{type:'detach',childId:${JSON.stringify(cards[1].id)}}]).finished;})()`);
    await record("detach preserves child identity and removes only its relation", `(async()=>{const s=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot();return s.desired.relationships.length===1&&s.desired.cards.some(c=>c.id===${JSON.stringify(cards[1].id)});})()`);
    return { ok: results.every(({ pass }) => pass), results, measurementNotes: { input: "public scene API setup and transactions", skips: 0 } };
  } finally {
    await evaluate(`(async()=>{(await import('/examples/card-engine-lab/main.js')).getScene().apply(${JSON.stringify(baseline)})})()`).catch(() => {});
  }
}
