import { createPageEvaluator } from "./chrome-runtime.mjs";

// Solid-color fixtures make clipping/layer assertions independent of Lab art.
export async function checkAttachmentPixels(command) {
  const pageEvaluate = createPageEvaluator(command);
  const evaluate = (expression) => pageEvaluate(`(async()=>(${expression}))()`);
  const results = [];
  const sceneExpression = `(await import('/examples/card-engine-lab/main.js')).getScene()`;
  const baseline = await evaluate(`(${sceneExpression}).snapshot().desired`);
  const solid = (color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="${color}" d="M0 0h100v100H0z"/></svg>`)}`;
  const attachment = (id, color, clip, zIndex) => ({
    id, type: "image", content: { src: solid(color), alt: id }, affinity: "front",
    layout: { mode: "overlay", anchor: "card", x: .8, y: .2, width: .4, height: .4, clip, zIndex },
  });
  const fixture = {
    cards: [{ id: "pixels", faceUp: true, activeFaceId: "front", dimensions: { width: 200, height: 200 },
      faces: { front: { background: "#101010", elements: [] } }, back: { background: "#202020", elements: [] },
      attachments: [attachment("overflow", "#00ffff", false, -1), attachment("clipped", "#ff0000", true, 10)] }],
    zones: [{ id: "table", cardIds: ["pixels"], geometry: { x: 100, y: 100, width: 600, height: 600, depth: 0 }, arrangement: { type: "grid" } }],
  };
  const ready = async () => {
    const until = Date.now() + 7000;
    while (Date.now() < until) {
      if (await evaluate(`(async()=>{const s=${sceneExpression};return !s.snapshot().settling && s.rendererDiagnostics().imageSources.pending===0})()`)) {
        await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error("Attachment pixel fixture did not settle/load");
  };
  const sample = async (offsets) => {
    const points = await evaluate(`(async()=>{const s=${sceneExpression};const p=s.snapshot().visual.find(v=>v.cardId==='pixels').pose;return ${JSON.stringify(offsets)}.map(([x,y])=>s.sceneToClient({x:p.x+x,y:p.y+y,z:p.z+3.1}));})()`);
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    return evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${screenshot.data}';await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ${JSON.stringify(points)}.map(p=>[...ctx.getImageData(Math.round(p.x*devicePixelRatio),Math.round(p.y*devicePixelRatio),1,1).data]);})()`);
  };
  const red = (p) => p[0] > 220 && p[1] < 35 && p[2] < 35;
  const cyan = (p) => p[0] < 35 && p[1] > 220 && p[2] > 220;
  const green = (p) => p[0] < 35 && p[1] > 220 && p[2] < 35;
  try {
    await evaluate(`(${sceneExpression}).apply(${JSON.stringify(fixture)})`);
    await ready();
    const [inside, outside] = await sample([[85, -40], [120, -40]]);
    results.push({ label: "higher clipped attachment covers lower unclipped attachment inside the shell", pass: red(inside), details: inside });
    results.push({ label: "lower unclipped attachment remains visible outside the shell", pass: cyan(outside), details: outside });
    await evaluate(`(${sceneExpression}).transact([{type:'attachment',cardId:'pixels',attachmentId:'clipped',action:'hide'}])`);
    await ready();
    const [lowerInside] = await sample([[85, -40]]);
    results.push({ label: "negative attachment layer order remains above the card surface", pass: cyan(lowerInside), details: lowerInside });
    await evaluate(`(${sceneExpression}).transact([{type:'attachment',cardId:'pixels',attachmentId:'clipped',action:'show'},{type:'attachment',cardId:'pixels',attachmentId:'overflow',action:'remove'}])`);
    await ready();
    const [clippedOutside] = await sample([[120, -40]]);
    results.push({ label: "clipped attachment produces no pixels outside the shell", pass: !red(clippedOutside) && !cyan(clippedOutside), details: clippedOutside });
    await evaluate(`(${sceneExpression}).transact([{type:'attachment',cardId:'pixels',attachmentId:'clipped',action:'hide'}])`);
    await ready();
    const [hidden] = await sample([[85, -40]]);
    results.push({ label: "hiding an attachment removes its actual rendered pixels", pass: !red(hidden), details: hidden });
    await evaluate(`(${sceneExpression}).transact([
      {type:'attachment',cardId:'pixels',attachmentId:'rear',action:'add',attachment:${JSON.stringify({ ...attachment("rear", "#00ffff", false, 0), affinity: "back" })}},
      {type:'face',cardId:'pixels',face:'faceDown',axis:'y'}
    ])`);
    await ready();
    const [rearInside, rearOutside] = await sample([[85, -40], [120, -40]]);
    results.push({ label: "back-affinity overflow follows the back face's local coordinates", pass: cyan(rearInside) && cyan(rearOutside), details: [rearInside, rearOutside] });
    await evaluate(`(${sceneExpression}).transact([{type:'attachment',cardId:'pixels',attachmentId:'rear',action:'update',attachment:{layout:{mode:'overlay',anchor:'card',x:.8,y:.2,width:.4,height:.4,clip:true}}}])`);
    await ready();
    const [rearClipped, rearClippedOutside] = await sample([[85, -40], [120, -40]]);
    results.push({ label: "clipped back attachment keeps its local placement and shell boundary", pass: cyan(rearClipped) && !cyan(rearClippedOutside), details: [rearClipped, rearClippedOutside] });
    const anchored = structuredClone(fixture);
    anchored.cards[0].faces.front.elements = [{ id: "region", type: "spacer", content: { height: 80 } }];
    anchored.cards[0].attachments = [{ ...attachment("anchored", "#00ff00", true, 0),
      layout: { mode: "overlay", anchor: "region", x: 0, y: 0, width: 1, height: 1 } }];
    await evaluate(`(${sceneExpression}).apply(${JSON.stringify(anchored)})`);
    await ready();
    const [beforeResize] = await sample([[0, -30]]);
    await evaluate(`(${sceneExpression}).transact([{type:'element',cardId:'pixels',elementId:'region',action:'update',element:{content:{height:40}}}])`);
    await ready();
    const [oldLocation, newLocation] = await sample([[0, -30], [0, -62]]);
    results.push({ label: "region-anchored pixels follow the region's resized geometry", pass: green(beforeResize) && !green(oldLocation) && green(newLocation), details: [beforeResize, oldLocation, newLocation] });
    await evaluate(`(${sceneExpression}).transact([{type:'element',cardId:'pixels',elementId:'region',action:'hide'}])`);
    await ready();
    const [missing] = await sample([[0, -62]]);
    results.push({ label: "hidden anchor removes its attachment pixels", pass: !green(missing), details: missing });
    await evaluate(`(${sceneExpression}).transact([{type:'attachment',cardId:'pixels',attachmentId:'anchored',action:'update',attachment:{layout:{mode:'overlay',anchor:'region',missingAnchor:'card',x:.2,y:.2,width:.4,height:.4}}}])`);
    await ready();
    const [fallback] = await sample([[-20, -20]]);
    results.push({ label: "explicit fallback renders against current card bounds", pass: green(fallback), details: fallback });
    await command("Network.enable");
    await command("Network.setCacheDisabled", { cacheDisabled: true });
    await command("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    const delayed = { ...attachment("delayed", "#ff0000", false, 20),
      content: { src: `/examples/card-engine-lab/majestic.png?attachment-race=${Date.now()}` },
      layout: { mode: "overlay", anchor: "card", x: .2, y: .2, width: .4, height: .4, clip: false, zIndex: 20 } };
    await evaluate(`(${sceneExpression}).transact([{type:'attachment',cardId:'pixels',attachmentId:'delayed',action:'add',attachment:${JSON.stringify(delayed)}}])`);
    const pending = await evaluate(`(${sceneExpression}).rendererDiagnostics().imageSources.pending`);
    results.push({ label: "replacement race starts with an actual pending browser image", pass: pending > 0, details: { pending } });
    const replacement = { ...delayed, content: { src: solid("#00ffff") } };
    await evaluate(`(${sceneExpression}).transact([{type:'attachment',cardId:'pixels',attachmentId:'delayed',action:'remove'},{type:'attachment',cardId:'pixels',attachmentId:'delayed',action:'add',attachment:${JSON.stringify(replacement)}}])`);
    await command("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await ready();
    const [replacementPixel] = await sample([[-20, -20]]);
    results.push({ label: "late image completion cannot repaint a replacement attachment", pass: cyan(replacementPixel), details: replacementPixel });
    return results;
  } finally {
    await command("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await command("Network.setCacheDisabled", { cacheDisabled: false });
    await evaluate(`(${sceneExpression}).apply(${JSON.stringify(baseline)})`);
  }
}
