import { writeFile } from "node:fs/promises";
import { createPageEvaluator } from "./chrome-runtime.mjs";

export async function runTutorialScenario({ command }) {
  const evaluate = createPageEvaluator(command);
  const results = [];
  const waitFor = async (expression) => {
    const started = Date.now();
    while (!await evaluate(expression)) {
      if (Date.now() - started > 6000) throw new Error(`Tutorial condition timed out: ${expression}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  const record = async (label, expression) => {
    const pass = Boolean(await evaluate(expression));
    results.push({ label, pass, ...(!pass ? { details: await evaluate(`({focus:document.activeElement?.outerHTML,step:document.querySelector('.lab-tutorial')?.dataset,dialog:document.querySelector('.lab-tutorial__panel')?.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight]})`) } : {}) });
  };
  const click = async (selector) => {
    const point = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
  };
  const key = async (key, code = key, modifiers = 0) => {
    const windowsVirtualKeyCode = { Enter: 13, Tab: 9, Escape: 27 }[key] ?? 0;
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode, ...(key === "Enter" ? {text: "\r"} : {}) });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode });
  };
  const panelFits = `(()=>{const r=document.querySelector('.lab-tutorial__panel')?.getBoundingClientRect();return r&&r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()`;
  let environment;
  try {
    await waitFor(`document.querySelectorAll('.cardinal-webgl-card').length>0`);
    environment = await evaluate(`({userAgent:navigator.userAgent,innerWidth,innerHeight,outerWidth,outerHeight,screenX,screenY,devicePixelRatio,stage:document.querySelector('#stage').getBoundingClientRect().toJSON()})`);
    await evaluate(`(async()=>{
      window.tutorialEntry=document.querySelector('script[type="module"][src$="main.js"]').src;
      window.tutorialScene=(await import(tutorialEntry)).getScene();
      window.tutorialSteps=(await import(new URL('./tutorial-steps.js',tutorialEntry).href)).LAB_TUTORIAL_STEPS;
      window.tutorialBefore=JSON.stringify(tutorialScene.snapshot().desired);
      window.tutorialSelection=JSON.stringify(tutorialScene.snapshot().selection);
      window.tutorialDetails=[...document.querySelectorAll('details')].map(node=>({node,open:node.open}));
    })()`);
    await record("Tutorial is opt-in and its targets exist in the default Lab", `!document.querySelector('.lab-tutorial:not([hidden])') && tutorialSteps.length>=10 && tutorialSteps.every(step=>!step.target||document.querySelector(step.target))`);
    await click("#start-tutorial");
    await waitFor(`Boolean(document.querySelector('.lab-tutorial__panel'))`);
    await record("Tutorial opens as a focused modal with visible progress", `(()=>{const p=document.querySelector('.lab-tutorial__panel');return p.getAttribute('role')==='dialog'&&p.getAttribute('aria-modal')==='true'&&p.contains(document.activeElement)&&document.querySelector('.lab-tutorial').textContent.includes(String(tutorialSteps.length));})()`);
    await record("Desktop explanation stays within the viewport", panelFits);
    await key("Tab", "Tab", 8);
    await record("Shift-Tab wraps to the last tutorial control", `document.activeElement.dataset.tutorialAction==='next'`);
    await key("Tab");
    await record("Tab wraps back to Close", `document.activeElement.dataset.tutorialAction==='close'`);
    await key("Tab");
    await key("Tab", "Tab", 8);
    await key("s", "KeyS");
    await record("Keyboard focus and selection stay inside the tutorial", `document.querySelector('.lab-tutorial__panel').contains(document.activeElement)&&JSON.stringify(tutorialScene.snapshot().selection)===tutorialSelection&&tutorialScene.snapshot().interaction.sessions.length===0`);
    // Back must return to the same first step, independent of content wording.
    const first = await evaluate(`document.querySelector('.lab-tutorial').dataset.stepId`);
    await click('[data-tutorial-action="next"]');
    await waitFor(`document.querySelector('.lab-tutorial').dataset.stepId!==${JSON.stringify(first)}`);
    await click('[data-tutorial-action="back"]');
    await record("Back returns to the previous explanation", `document.querySelector('.lab-tutorial').dataset.stepId===${JSON.stringify(first)}`);
    const count = await evaluate("tutorialSteps.length");
    for (let index = 0; index < count; index += 1) {
      await waitFor(`document.querySelector('.lab-tutorial')?.dataset.stepId===tutorialSteps[${index}].id`);
      await waitFor(panelFits);
      await record(`Desktop step ${index + 1} is readable and highlights its target`, `(${panelFits})&&(!tutorialSteps[${index}].target||!document.querySelector('.lab-tutorial__spotlight').hidden)`);
      if (index === 3) {
        await record("Tutorial colors zone names and keywords", `(()=>{const body=document.querySelector('.lab-tutorial__body');const ocean=body?.querySelector('.lab-tutorial__zone--ocean');const keyword=body?.querySelector('.lab-tutorial__keyword');return ocean?.textContent==='Ocean'&&keyword&&getComputedStyle(ocean).color==='rgb(97, 175, 239)'&&getComputedStyle(keyword).color==='rgb(229, 192, 123)';})()`);
      }
      if (index === 4 && process.env.CARDINAL_TUTORIAL_SCREENSHOT) {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(process.env.CARDINAL_TUTORIAL_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
      }
      await click('[data-tutorial-action="next"]');
    }
    await waitFor(`!document.querySelector('.lab-tutorial:not([hidden])')`);
    await record("Finish restores focus, toolboxes and scene state", `document.activeElement.id==='start-tutorial'&&tutorialDetails.every(({node,open})=>node.open===open)&&!document.querySelector('main').inert&&JSON.stringify(tutorialScene.snapshot().desired)===tutorialBefore`);
    await click("#start-tutorial");
    await key("Escape");
    await record("Escape closes the replay and restores focus", `!document.querySelector('.lab-tutorial:not([hidden])')&&document.activeElement.id==='start-tutorial'`);
    await click("#start-tutorial");
    await key("Tab");
    await key("Enter");
    await record("Enter advances the focused Next control", `document.querySelector('.lab-tutorial').dataset.stepIndex==='1'`);
    await key("Escape");

    // Resize only this isolated test session, then exercise every step with touch.
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await click("#start-tutorial");
    for (let index = 0; index < count; index += 1) {
      await waitFor(`document.querySelector('.lab-tutorial')?.dataset.stepId===tutorialSteps[${index}].id`);
      await waitFor(panelFits);
      await record(`Narrow step ${index + 1} stays within the viewport`, panelFits);
      await record(`Narrow step ${index + 1} keeps navigation visible`, `(()=>{const panel=document.querySelector('.lab-tutorial__panel').getBoundingClientRect();const next=document.querySelector('[data-tutorial-action="next"]');const r=next.getBoundingClientRect();return r.top>=panel.top&&r.bottom<=panel.bottom&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===next;})()`);
      if (index === 4 && process.env.CARDINAL_TUTORIAL_SCREENSHOT) {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(process.env.CARDINAL_TUTORIAL_SCREENSHOT.replace(/\.png$/, "-narrow.png"), Buffer.from(screenshot.data, "base64"));
      }
      const point = await evaluate(`(()=>{const r=document.querySelector('[data-tutorial-action="next"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
      await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await waitFor(`!document.querySelector('.lab-tutorial:not([hidden])')`);
    await record("Touch navigation completes without changing card data", `JSON.stringify(tutorialScene.snapshot().desired)===tutorialBefore&&!document.querySelector('main').inert`);
    await click("#start-tutorial");
    await evaluate(`document.activeElement.blur()`);
    await key("Escape");
    await record("Escape also closes after focus is lost during touch input", `!document.querySelector('.lab-tutorial:not([hidden])')&&!document.querySelector('main').inert`);
    await evaluate(`(async()=>{
      const {createLabTutorial}=await import(new URL('./tutorial.js',tutorialEntry).href);
      window.tutorialProbe=createLabTutorial({steps:[{id:'missing',title:'Unavailable control',body:'This step still closes safely.',target:'#missing-control'}]});
      window.tutorialPriorInert=document.createElement('aside');tutorialPriorInert.inert=true;document.body.append(tutorialPriorInert);
      tutorialProbe.start();
    })()`);
    await record("A missing target still produces a readable explanation", `document.querySelector('.lab-tutorial:not([hidden]) .lab-tutorial__panel').textContent.includes('Unavailable control')&&document.querySelector('.lab-tutorial:not([hidden]) .lab-tutorial__spotlight').hidden`);
    await evaluate(`tutorialProbe.destroy()`);
    await record("Destroy restores background access and preserves existing inert state", `!document.querySelector('.lab-tutorial:not([hidden])')&&!document.querySelector('main').inert&&tutorialPriorInert.inert`);
    await evaluate(`tutorialPriorInert.remove()`);
    return { ok: results.every(({ pass }) => pass), results, environment };
  } catch (error) {
    const details = await evaluate(`({step:{...document.querySelector('.lab-tutorial')?.dataset},viewport:[innerWidth,innerHeight],panel:document.querySelector('.lab-tutorial__panel')?.getBoundingClientRect().toJSON(),next:document.querySelector('[data-tutorial-action="next"]')?.getBoundingClientRect().toJSON(),focus:document.activeElement?.tagName})`);
    if (process.env.CARDINAL_TUTORIAL_SCREENSHOT) {
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.CARDINAL_TUTORIAL_SCREENSHOT.replace(/\.png$/, "-failure.png"), Buffer.from(screenshot.data, "base64"));
    }
    results.push({ label: error.message, pass: false, details });
    return { ok: false, results, environment };
  } finally {
    await key("Escape");
    if (environment) await command("Emulation.setDeviceMetricsOverride", { width: environment.innerWidth, height: environment.innerHeight, deviceScaleFactor: environment.devicePixelRatio, mobile: false });
  }
}
