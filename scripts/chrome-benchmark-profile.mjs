import { writeFile } from 'node:fs/promises';
import { createPageEvaluator } from './chrome-runtime.mjs';

// Profile the actual Lab button; pin only its random sequence for comparisons.
export async function runBenchmarkProfile({ command }) {
  const evaluate = createPageEvaluator(command);
  await evaluate(`(() => {
    globalThis.__cardinalProfileRandom = Math.random;
    let seed = 123456789;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    return true;
  })()`);
  await command('Profiler.enable');
  await command('Profiler.start');
  let report;
  let profile;
  try {
    report = await evaluate(`(async () => {
      const { getScene } = await import('/examples/card-engine-lab/main.js');
      const baseline = getScene().snapshot();
      document.querySelector('#run-diagnostics-benchmark').click();
      const deadline = performance.now() + 120000;
      while (document.querySelector('#run-diagnostics-benchmark').disabled) {
        if (performance.now() > deadline) throw new Error('Benchmark timeout');
        await new Promise(r => setTimeout(r, 100));
      }
      const status = document.querySelector('#diagnostics-status').textContent;
      const result = JSON.parse(document.querySelector('#diagnostics-report').textContent);
      return { result, status, restored: getScene().snapshot().desired.cards.length === baseline.desired.cards.length };
    })()`);
  } finally {
    ({ profile } = await command('Profiler.stop'));
    await command('Profiler.disable');
    await evaluate(`(() => {
      Math.random = globalThis.__cardinalProfileRandom;
      delete globalThis.__cardinalProfileRandom;
      return true;
    })()`);
  }
  if (process.env.CARDINAL_PROFILE_PATH) await writeFile(process.env.CARDINAL_PROFILE_PATH, JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const totals = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const frame = nodes.get(profile.samples[i])?.callFrame;
    if (!frame) continue;
    const key = `${frame.functionName || '(anonymous)'} ${frame.url}:${frame.lineNumber + 1}`;
    totals.set(key, (totals.get(key) || 0) + profile.timeDeltas[i] / 1000);
  }
  const hot = [...totals].sort((a,b) => b[1]-a[1]).slice(0,25).map(([frame,ms])=>({frame,ms:Math.round(ms)}));
  const results = [
    { label:'Profile runs the Lab benchmark', pass:report.status.includes('Benchmark complete') },
    { label:'Profile restores the card count', pass:report.restored },
  ];
  return { ok:results.every(r=>r.pass), results, environment:{browser:report.result.browser,device:report.result.device,viewport:report.result.viewport,webgl:report.result.webgl}, measurements:{benchmark:report.result.lab.benchmark, cpuSelfTime:hot} };
}
