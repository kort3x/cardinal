import { writeFile } from "node:fs/promises";
import { createPageEvaluator } from "./chrome-runtime.mjs";
import { checkAttachmentPixels } from "./chrome-attachment-pixels.mjs";

export async function runAttachmentsScenario({ command }) {
  const evaluate = createPageEvaluator(command);
  const results = [];
  const record = async (label, expression) => {
    const value = await evaluate(expression);
    results.push({ label, pass: Boolean(value), ...(value ? {} : { details: await evaluate(`(async()=>({ active: document.activeElement?.outerHTML?.slice(0,240), scene: (await import('/examples/card-engine-lab/main.js')).getScene().snapshot(), controls: [...document.querySelectorAll('.cardinal-webgl-attachment-controls button')].map((node) => node.outerHTML) }))()`) }) });
  };
  const waitFor = async (expression, timeout = 7000) => {
    const started = Date.now();
    while (!(await evaluate(expression))) {
      if (Date.now() - started > timeout) {
        const capture = await command("Page.captureScreenshot", { format: "png" });
        await writeFile("/tmp/cardinal-attachments-failure.png", Buffer.from(capture.data, "base64"));
        const detail = await evaluate(`(async()=>{const s=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot();return {card:s.desired.cards[0],pose:s.visual[0],active:document.activeElement?.outerHTML?.slice(0,300),controls:[...document.querySelectorAll('.cardinal-webgl-attachment-controls')].map(n=>n.outerHTML)}})()`);
        throw new Error(`Attachment condition timed out: ${expression}\n${JSON.stringify(detail)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
  };
  const click = async (selector) => {
    const point = await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Missing '+${JSON.stringify(selector)});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, buttons: 0 });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
  };
  const key = async (key, code) => {
    const keyCode = key === "Enter" ? 13 : key === "Tab" ? 9 : undefined;
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code: code ?? key, windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode, ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code: code ?? key, windowsVirtualKeyCode: keyCode });
  };
  const environment = await evaluate(`({userAgent:navigator.userAgent,innerWidth,innerHeight,outerWidth,outerHeight,screenX,screenY,devicePixelRatio,stage:document.querySelector('#stage').getBoundingClientRect().toJSON()})`);
  const baseline = await evaluate(`(async()=>structuredClone((await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired))()`);
  const baselineHeight = await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();return scene.snapshot().visual.find(v=>v.cardId==='cardinal-demo')?.pose.height})()`);
  const baselineBackHeight = await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();return scene.snapshot().visual.find(v=>v.cardId==='ice-demo')?.pose.height})()`);
  await evaluate(`window.__attachmentShellBeforeRestore=document.querySelector('.cardinal-webgl-card[data-card-id="cardinal-demo"]')`);
  try {
    await record("concealed Lab cards keep portrait geometry", `(async()=>{const pose=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().visual.find(v=>v.cardId==='ice-demo')?.pose;return pose?.height>pose?.width;})()`);
    await evaluate(`(async()=>{(await import('/examples/card-engine-lab/main.js')).getScene().select(['cardinal-demo'])})()`);
    await click('.attachments-group > summary');
    await click('[data-attachment-demo="stamp"]');
    await waitFor(`(async()=> (await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].attachments?.some(a=>a.id==='travelling-stamp'))()`);
    await record("stamping a selected travelling card commits an identified attachment", `(async()=>{const c=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0];return c.attachments.some(a=>a.id==='travelling-stamp')&&c.id==='cardinal-demo';})()`);

    await click('[data-attachment-demo="counter"]');
    await waitFor(`(async()=> (await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].attachments?.some(a=>a.id==='trip-counter'))()`);
    await waitFor(`(async()=> !(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().settling)()`);
    await click('.cardinal-webgl-attachment-controls button[data-attachment-id="trip-counter"][data-control-id="increment"]');
    await waitFor(`(async()=> (await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].attachments.find(a=>a.id==='trip-counter')?.content.value===1)()`);
    await waitFor(`(async()=> !(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().settling)()`);
    await record("actual pointer input increments a renderer-owned projected counter", `(async()=>{const s=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot();const c=s.desired.cards[0];const b=document.querySelector('.cardinal-webgl-attachment-controls button[data-attachment-id="trip-counter"][data-control-id="increment"]');const r=b?.getBoundingClientRect();return c.attachments.find(a=>a.id==='trip-counter')?.content.value===1&&b&&!b.closest('.cardinal-webgl-accessibility')&&!b.hidden&&r.width>0&&r.height>0&&s.visual.find(v=>v.cardId==='cardinal-demo')?.pose.height>${baselineHeight};})()`);
    await key("Enter", "Enter");
    await waitFor(`(async()=> (await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].attachments.find(a=>a.id==='trip-counter')?.content.value===2)()`);
    await record("renderer counter control accepts keyboard activation", `document.activeElement?.dataset?.attachmentId==='trip-counter'&&document.activeElement?.dataset?.controlId==='increment'`);
    const counterFrontHeight = await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();return scene.snapshot().visual.find(v=>v.cardId==='cardinal-demo')?.pose.height})()`);
    await evaluate(`(async()=>{(await import('/examples/card-engine-lab/main.js')).getScene().transact([{type:'face',cardId:'cardinal-demo',face:'faceDown',axis:'y',angle:180}],{zoneFacePolicy:'override'})})()`);
    await waitFor(`(async()=> !(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().settling)()`);
    await record("concealed counter card keeps the public back geometry", `(async()=>{const pose=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().visual.find(v=>v.cardId==='cardinal-demo')?.pose;return pose?.height===${baselineBackHeight}&&pose.height<${counterFrontHeight};})()`);
    await evaluate(`(async()=>{(await import('/examples/card-engine-lab/main.js')).getScene().transact([{type:'face',cardId:'cardinal-demo',face:'faceUp',axis:'y',angle:0}],{zoneFacePolicy:'override'})})()`);
    await waitFor(`(async()=> !(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().settling)()`);

    await click('[data-attachment-demo="stickers"]');
    await waitFor(`(async()=> (await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].attachments.filter(a=>a.type==='sticker').length===2)()`);
    await record("two same-type stickers retain independent IDs", `(async()=>{const a=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].attachments.filter(x=>x.type==='sticker');return a.length===2&&new Set(a.map(x=>x.id)).size===2;})()`);
    await waitFor(`(async()=> !(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().settling)()`);
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    const visiblePixels = Buffer.from(screenshot.data, "base64");
    await writeFile("/tmp/cardinal-attachments-visible.png", visiblePixels);
    await record("visible attachment render is captured before cleanup", `document.querySelectorAll('.cardinal-webgl-card').length>0&&document.querySelector('.cardinal-webgl-attachment-controls button[data-attachment-id="trip-counter"][data-control-id="increment"]')?.getBoundingClientRect().width>0`);

    await evaluate(`document.querySelector('.cardinal-webgl-attachment-controls button[data-attachment-id="trip-counter"][data-control-id="increment"]').focus()`);
    await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();scene.transact([{type:'attachment',cardId:'cardinal-demo',attachmentId:'trip-counter',action:'remove'}]);})()`);
    await waitFor(`(async()=> !(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].attachments.some(a=>a.id==='trip-counter'))()`);
    await record("removing the focused attachment returns focus to the stable card shell", `document.activeElement?.matches?.('.cardinal-webgl-card[data-card-id="cardinal-demo"]')&&!document.querySelector('.cardinal-webgl-attachment-controls button[data-attachment-id="trip-counter"]')`);
    await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();scene.transact([{type:'attachment',cardId:'cardinal-demo',attachmentId:'trip-counter',action:'add',attachment:{id:'trip-counter',type:'counter',content:{label:'Trips',value:0},affinity:'front',layout:{mode:'flow',width:0.32,height:0.12,clip:true,zIndex:9},controls:[{id:'increment',label:'Increment counter'}]}}]);})()`);
    await waitFor(`Boolean(document.querySelector('.cardinal-webgl-attachment-controls button[data-attachment-id="trip-counter"][data-control-id="increment"]'))`);

    await evaluate(`(()=>{const scene=window.__attachmentScene ?? null;return scene;})()`);
    await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();const c=scene.snapshot().desired.cards[0];scene.transact([{type:'attachment',cardId:c.id,attachmentId:'sticker-alpha',action:'update',attachment:{...c.attachments.find(a=>a.id==='sticker-alpha'),layout:{...c.attachments.find(a=>a.id==='sticker-alpha').layout,x:0.92,y:0.88,width:0.32,height:0.22,clip:false}}}]);})()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const overflowScreenshot = await command("Page.captureScreenshot", { format: "png" });
    const overflowPixels = Buffer.from(overflowScreenshot.data, "base64");
    results.push({ label: "overlay sticker render changes when clipping is disabled and anchor moves", pass: !overflowPixels.equals(visiblePixels), details: { visibleBytes: visiblePixels.length, overflowBytes: overflowPixels.length } });

    await click('[data-attachment-demo="hide-anchor"]');
    await waitFor(`(async()=> (await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].faces['face-a'].elements.find(e=>e.id==='image')?.visible===false)()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const hiddenScreenshot = await command("Page.captureScreenshot", { format: "png" });
    const hiddenPixels = Buffer.from(hiddenScreenshot.data, "base64");
    results.push({ label: "hiding the image anchor changes rendered pixels", pass: !hiddenPixels.equals(overflowPixels), details: { overflowBytes: overflowPixels.length, hiddenBytes: hiddenPixels.length } });

    const race = await evaluate(`(async()=>{const scene=(await import('/examples/card-engine-lab/main.js')).getScene();const c=scene.snapshot().desired.cards[0];const original=c.attachments.find(a=>a.id==='sticker-alpha');scene.transact([{type:'face',cardId:c.id,face:'faceDown',axis:'y',angle:180},{type:'attachment',cardId:c.id,attachmentId:'sticker-alpha',action:'remove'},{type:'attachment',cardId:c.id,attachmentId:'sticker-alpha',action:'add',attachment:{...original,content:{...original.content,text:'REPLACEMENT'}}}],{zoneFacePolicy:'override'});return scene.snapshot().desired.cards[0].attachments.find(a=>a.id==='sticker-alpha')?.content.text;})()`);
    await record("remove and re-add of the same sticker ID during a flip keeps the replacement", `(${JSON.stringify(race)})==='REPLACEMENT'`);
    await waitFor(`(async()=> !(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().settling)()`);
    await record("concealed surface has no visible or tabbable attachment controls", `(()=>{const layer=document.querySelector('.cardinal-webgl-attachment-controls');const buttons=[...document.querySelectorAll('.cardinal-webgl-attachment-controls button')];return (!layer||layer.hidden||getComputedStyle(layer).visibility==='hidden'||layer.getBoundingClientRect().width===0)&&buttons.every(b=>b.hidden||b.disabled||b.tabIndex<0||b.closest('[hidden]'));})()`);

    await evaluate(`(async()=>{(await import('/examples/card-engine-lab/main.js')).getScene().apply(${JSON.stringify(baseline)})})()`);
    await evaluate(`(async()=>{(await import('/examples/card-engine-lab/main.js')).getScene().select(['cardinal-demo'])})()`);
    await record("restoration returns the captured original state and preserves the shell", `(async()=>{const s=(await import('/examples/card-engine-lab/main.js')).getScene().snapshot();return JSON.stringify(s.desired)===${JSON.stringify(JSON.stringify(baseline))}&&document.querySelectorAll('.cardinal-webgl-card').length===${baseline.cards.length}&&document.querySelector('.cardinal-webgl-card[data-card-id="cardinal-demo"]')===window.__attachmentShellBeforeRestore;})()`);
    await click('[data-attachment-demo="stamp"]');
    await click('[data-attachment-demo="restore"]');
    await record("Lab restore action removes demo attachments without losing the original card", `(async()=>!(await import('/examples/card-engine-lab/main.js')).getScene().snapshot().desired.cards[0].attachments?.length)()`);
    results.push(...await checkAttachmentPixels(command));
    return { ok: results.every((result) => result.pass), results, environment, measurementNotes: { screenshot: "/tmp/cardinal-attachments-visible.png", input: "CDP mouse and keyboard input; state setup uses public scene API", skips: 0 } };
  } finally {
    await evaluate(`(async()=>{(await import('/examples/card-engine-lab/main.js')).getScene().apply(${JSON.stringify(baseline)})})()`).catch(() => {});
  }
}
