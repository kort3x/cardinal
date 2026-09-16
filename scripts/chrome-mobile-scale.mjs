import { createPageEvaluator } from "./chrome-runtime.mjs";

// Same-origin lab viewports keep the user's Chrome window untouched.
// DOM controls test responsive defaults, not pointer/touch input behavior.
export async function runMobileScaleScenario({ command }) {
  return createPageEvaluator(command)(`(async () => {
    const results = [];
    const environment = { userAgent: navigator.userAgent, innerWidth, innerHeight,
      outerWidth, outerHeight, screenX, screenY, devicePixelRatio, fixtures: [] };
    const record = (label, pass) => results.push({ label, pass: Boolean(pass) });
    for (const width of [390, 640, 641, 2515]) {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;left:0;top:0;border:0;height:844px;width:' + width + 'px';
      try {
        const loaded = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Lab fixture load timed out')), 10000);
          frame.onload = () => { clearTimeout(timer); resolve(); };
        });
        frame.src = location.href;
        document.body.append(frame);
        await loaded;
        const win = frame.contentWindow;
        const doc = frame.contentDocument;
        const scene = await win.eval("import('/examples/card-engine-lab/main.js').then(module => module.getScene())");
        if (!scene) throw new Error('Lab fixture scene unavailable at width ' + width);
        const waitFor = async (predicate) => {
          const deadline = performance.now() + 5000;
          while (!predicate()) {
            if (performance.now() > deadline) throw new Error('Scale fixture did not settle');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        };
        const expected = width <= 640 ? 0.5 : 1;
        const expectedTouch = win.navigator.maxTouchPoints > 0
          || "ontouchstart" in win
          || win.matchMedia("(pointer: coarse)").matches;
        const touchEnabled = () => doc.querySelector('#drag-touch').checked;
        const scale = () => scene.snapshot().desired.cards[0].pose.scale;
        environment.fixtures.push({ width: win.innerWidth, height: win.innerHeight,
          dpr: win.devicePixelRatio, stage: doc.querySelector('#stage').getBoundingClientRect().toJSON() });
        record(width + 'px: initial card and scale control use default',
          win.innerWidth === width && scale() === expected
          && Number(doc.querySelector('#scale-slider').value) === expected
          && doc.querySelector('#scale-value').textContent === expected * 100 + '%'
          && touchEnabled() === expectedTouch);
        doc.querySelector('[data-scale="0.25"]').click();
        await waitFor(() => scale() === 0.25 && !scene.snapshot().settling);
        frame.style.width = (width <= 640 ? 1000 : 390) + 'px';
        await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
        record(width + 'px: viewport resize preserves manual scale', scale() === 0.25);
        frame.style.width = width + 'px';
        await new Promise(resolve => win.requestAnimationFrame(resolve));
        doc.querySelector('#add-card').click();
        await waitFor(() => scene.snapshot().desired.cards.length === 2 && !scene.snapshot().settling);
        record(width + 'px: added card uses default without changing existing card',
          scale() === 0.25 && scene.snapshot().desired.cards[1].pose.scale === expected
          && Number(doc.querySelector('#scale-slider').value) === expected);
      } finally { frame.remove(); }
    }
    return { ok: results.every(result => result.pass), results, environment };
  })()`);
}
