import { createPageEvaluator } from './chrome-runtime.mjs';

export async function runInspectionScenario({ command }) {
  const evaluate = createPageEvaluator(command);
  const results = [];
  const record = async (label, expression) => {
    const value = await evaluate(expression);
    results.push({ label, pass: Boolean(value), ...(!value ? { details: await evaluate(`({ focus: document.activeElement?.outerHTML?.slice(0,300), viewport:[innerWidth,innerHeight], panels:[...document.querySelectorAll('.cardinal-inspection__panel')].map(n=>n.getBoundingClientRect().toJSON()), inspection: window.inspectionScene?.snapshot().inspection, views: [...document.querySelectorAll('.cardinal-inspection')].map(n=>n.textContent.slice(0,300)) })`) } : {}) });
  };
  const waitFor = async (expression) => {
    const start = Date.now();
    while (!await evaluate(expression)) {
      if (Date.now() - start > 6000) throw new Error(`Inspection condition timed out: ${expression}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  const key = async (key, code = key) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  };
  const click = async (selector) => {
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
  };
  let environment;
  try {
    await waitFor(`Boolean(document.querySelector('#inspection-fixture'))`);
    await evaluate(`document.querySelector('#inspection-fixture').click()`);
    await record('Lab exposes the public inspection and independent face controls', `(async()=>{
      const scene = (await import('/examples/card-engine-lab/main.js')).getScene();
      return scene.snapshot().desired.cards.length === 2 && typeof scene.inspect === 'function'
        && document.querySelector('#inspection-face option[value="details"]');
    })()`);
    await evaluate(`(async()=>{
      const { createCardScene } = await import('/packages/card-engine/src/index.js');
      const host = document.createElement('div'); host.id='inspection-test-host';
      host.style.cssText='position:fixed;inset:40px;z-index:200;background:#222;'; document.body.append(host);
      const button = document.createElement('button'); button.textContent='Restore focus here'; button.id='inspection-return-focus';
      button.style.cssText='position:fixed;top:4px;left:4px;z-index:201'; document.body.append(button);
      const text=(id,value)=>({id,type:'text',content:{text:value},style:{variant:id==='title'?'title':'flavour'}});
      window.inspectionSecretURL='/inspection-secret-'+Date.now()+'.png';
      window.inspectionPermitSecret=false; window.inspectionDenyRelated=false;
      window.inspectionScene=createCardScene({element:host, motion:{duration:300}, camera:{scaleMode:'stage',center:{x:450,y:250}},
        interaction:{touchDrag:true,rules:{canTake:()=>({allowed:true}),canPut:()=>({allowed:true}),canReveal:()=>({allowed:true}),canConceal:()=>({allowed:true}),canChangeFace:()=>({allowed:true})}},
        inspection:{input:{hover:true,dwell:100,dismissDelay:80,touchHold:200},rules:{canInspect:({cardId})=>({allowed:cardId!=='denied' && !(cardId==='unknown'&&inspectionDenyRelated)}),canInspectConcealed:()=>({allowed:window.inspectionPermitSecret})}}});
      const front={elements:[text('title','Visible Cardinal'),text('description','Full permitted content')]};
      const back={elements:[text('back','Common Sleeve')],background:'#222'};
      const card={id:'visible',feedback:{pending:true,actionable:true},activeFaceId:'summary',faceUp:true,back,dimensions:{width:160,height:220},pose:{scale:0.7},faces:{summary:front,details:{elements:[text('title','Details Face'),text('description','Long field notes. '.repeat(2000))]}}};
      inspectionScene.apply({cards:[card,{...structuredClone(card),id:'secret',faceUp:false,faces:{summary:{elements:[text('title','SECRET FRONT TITLE'),{id:'private-image',type:'image',content:{src:inspectionSecretURL}}]},details:card.faces.details}},
        {id:'unknown',faceUp:false,back,dimensions:{width:160,height:220}}, {...structuredClone(card),id:'denied',feedback:{disabled:true}}],
        zones:[{id:'row',geometry:{x:80,y:40,width:720,height:420,depth:0},cardIds:['visible','secret','unknown','denied'],arrangement:{type:'row',gap:30},presentation:{elements:['description']}}]});
      window.inspectionShell=host.querySelector('[data-card-id="visible"]'); inspectionScene.select(['visible']);
      window.inspectionView=inspectionScene.inspect('visible',{relatedCardIds:['secret','unknown','denied']});
      button.focus();
    })()`);
    environment = await evaluate(`({userAgent:navigator.userAgent,innerWidth,innerHeight,outerWidth,outerHeight,screenX,screenY,devicePixelRatio,stage:document.querySelector('#inspection-test-host').getBoundingClientRect().toJSON()})`);
    await record('Preview shows full permitted content over zone simplification without moving focus', `document.querySelector('.cardinal-inspection')?.textContent.includes('Visible Cardinal') && !inspectionShell.textContent.includes('Visible Cardinal') && document.activeElement.id==='inspection-return-focus'`);
    await record('Auxiliary view has distinct identity and adds no scene shell or gameplay controls', `Boolean(document.querySelector('.cardinal-inspection[data-view-id]')) && document.querySelectorAll('#inspection-test-host .cardinal-webgl-card').length===4 && !document.querySelector('.cardinal-inspection [data-card-id]')`);
    await record('Selection composes with pending/actionable feedback and disabled eligibility', `inspectionShell.dataset.selected==='true' && inspectionShell.getAttribute('aria-busy')==='true' && Boolean(document.querySelector('#inspection-test-host .cardinal-feedback[data-source-card-id="visible"][data-pending="true"][data-actionable="true"]')) && !inspectionScene.isSelectable('denied')`);
    await record('Related navigation omits denied targets' , `!document.querySelector('.cardinal-inspection [data-related-card-id="denied"]') && Boolean(document.querySelector('.cardinal-inspection [data-related-card-id="unknown"]'))`);
    await evaluate(`inspectionDenyRelated=true;inspectionScene.invalidateRules()`);
    await record('Permission revocation removes a related control without a content change', `!document.querySelector('.cardinal-inspection [data-related-card-id="unknown"]')`);
    await evaluate(`inspectionDenyRelated=false;inspectionScene.invalidateRules()`);
    await click('.cardinal-inspection [data-related-card-id="unknown"]');
    await record('Related navigation uses actual input and starts no parent drag', `inspectionView.snapshot().cardId==='unknown' && inspectionScene.snapshot().interaction.sessions.length===0`);
    await evaluate(`inspectionView.close(); inspectionView=inspectionScene.inspect('visible')`);
    await evaluate(`inspectionScene.transact([{type:'element',cardId:'visible',elementId:'title',action:'update',element:{content:{text:'Live Cardinal'}}}]);`);
    await waitFor(`document.querySelector('.cardinal-inspection')?.textContent.includes('Live Cardinal')`);
    await record('Open preview updates live and keeps the original scene shell', `document.querySelector('#inspection-test-host [data-card-id="visible"]')===inspectionShell && !document.querySelector('.cardinal-inspection').textContent.includes('Visible Cardinal')`);
    await evaluate(`inspectionView.close(); document.querySelector('#inspection-return-focus').focus(); inspectionView=inspectionScene.inspect('visible',{modal:true});`);
    await record('Explicit modal inspection receives focus', `document.querySelector('.cardinal-inspection')?.contains(document.activeElement)`);
    await key('Escape');
    await waitFor(`!document.querySelector('.cardinal-inspection')`);
    await record('Escape restores prior valid focus', `document.activeElement.id==='inspection-return-focus'`);
    await evaluate(`inspectionView=inspectionScene.inspect('visible',{mode:'inPlace'}); window.inspectionDesired=JSON.stringify(inspectionScene.snapshot().desired);`);
    await record('In-place inspection preserves one shell and committed state', `document.querySelector('#inspection-test-host [data-card-id="visible"]')===inspectionShell && JSON.stringify(inspectionScene.snapshot().desired)===inspectionDesired`);
    await evaluate(`inspectionScene.transact([{type:'move',cardId:'visible',position:{x:210,y:220}},{type:'scale',cardId:'visible',factor:0.9}]); inspectionView.close();`);
    await waitFor(`!inspectionScene.snapshot().settling`);
    await record('Closing in-place inspection retains the latest movement and scale', `(()=>{const p=inspectionScene.snapshot().visual.find(x=>x.cardId==='visible').pose;return p.x===210&&p.y===220&&p.scale===0.9;})()`);
    await evaluate(`inspectionScene.transact([{type:'contentFace',cardId:'visible',faceId:'details'}]); inspectionView=inspectionScene.inspect('visible',{modal:true});`);
    await waitFor(`document.querySelector('.cardinal-inspection')?.textContent.includes('Details Face')`);
    await record('Long preview is viewport bounded and scrollable', `(()=>{const v=document.querySelector('.cardinal-inspection');const r=v.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&[v,...v.querySelectorAll('*')].some(n=>n.scrollHeight>n.clientHeight&&['auto','scroll'].includes(getComputedStyle(n).overflowY));})()`);
    await evaluate(`inspectionView.close(); inspectionView=inspectionScene.inspect('secret');`);
    await record('Concealed preview exposes only its sleeve', `!document.querySelector('.cardinal-inspection').textContent.includes('SECRET FRONT TITLE') && !document.querySelector('#inspection-test-host [data-card-id="secret"]').textContent.includes('SECRET FRONT TITLE')`);
    await record('Concealed front image has not been requested', `!performance.getEntriesByType('resource').some(entry=>entry.name.endsWith(inspectionSecretURL))`);
    await evaluate(`inspectionScene.transact([{type:'contentFace',cardId:'secret',faceId:'details'}],{origin:'user'});`);
    await record('Content-face switch remains concealed in scene and preview', `inspectionScene.snapshot().desired.cards.find(c=>c.id==='secret').activeFaceId==='details' && !document.querySelector('.cardinal-inspection').textContent.includes('Details Face')`);
    await evaluate(`inspectionView.close();inspectionPermitSecret=true;inspectionView=inspectionScene.inspect('secret');`);
    await record('Explicit inspection permission can show supplied concealed content without revealing the card', `document.querySelector('.cardinal-inspection').textContent.includes('Details Face') && inspectionScene.snapshot().desired.cards.find(c=>c.id==='secret').faceUp===false`);
    await evaluate(`inspectionPermitSecret=false;inspectionScene.invalidateRules()`);
    await record('Revoking concealed inspection permission immediately closes the preview', `!document.querySelector('.cardinal-inspection')`);
    await evaluate(`inspectionView=inspectionScene.inspect('unknown');`);
    await record('Back-only unknown card can be inspected safely', `Boolean(document.querySelector('.cardinal-inspection')) && !document.querySelector('.cardinal-inspection').textContent.includes('SECRET FRONT TITLE')`);
    await evaluate(`inspectionView.close(); inspectionView=inspectionScene.inspect('visible'); const state=inspectionScene.snapshot().desired; state.cards=state.cards.filter(c=>c.id!=='visible'); state.zones[0].cardIds=state.zones[0].cardIds.filter(id=>id!=='visible'); inspectionScene.apply(state);`);
    await record('Removing the source closes its preview', `!document.querySelector('.cardinal-inspection')`);
    // Actual keyboard opening, not a synthetic DOM event.
    await evaluate(`document.querySelector('#inspection-test-host [data-card-id="unknown"]').focus()`);
    await key('i','KeyI');
    await waitFor(`Boolean(document.querySelector('.cardinal-inspection'))`);
    await record('Keyboard I opens focused-card inspection', `Boolean(document.querySelector('.cardinal-inspection'))`);
    await key('i','KeyI');
    await waitFor(`!document.querySelector('.cardinal-inspection')`);
    await record('Keyboard I toggles focused-card inspection closed', `!document.querySelector('.cardinal-inspection')`);
    await key('i','KeyI');
    await waitFor(`Boolean(document.querySelector('.cardinal-inspection'))`);
    await key('Escape');
    await waitFor(`!document.querySelector('.cardinal-inspection')`);
    await evaluate(`document.querySelector('#inspection-return-focus').focus()`);
    const point=await evaluate(`(()=>{const p=inspectionScene.snapshot().visual.find(x=>x.cardId==='unknown').pose;return inspectionScene.sceneToClient(p);})()`);
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1,radiusX:1,radiusY:1,force:1}]});
    await waitFor(`Boolean(document.querySelector('.cardinal-inspection'))`);
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await record('Touch hold opens inspection without a drag session', `Boolean(document.querySelector('.cardinal-inspection')) && !inspectionScene.snapshot().interaction.sessions.some(s=>['dragging','pending'].includes(s.phase))`);
    await key('Escape');
    await evaluate(`document.querySelector('#inspection-return-focus').focus()`);
    const hoverPoint = await evaluate(`inspectionScene.sceneToClient(inspectionScene.snapshot().visual.find(x=>x.cardId==='unknown').pose)`);
    const mouseMove = async (point, buttons=0) => command('Input.dispatchMouseEvent',{type:'mouseMoved',...point,buttons});
    const holdPastDwell = async () => {
      await evaluate(`window.inspectionTimerStart=performance.now()`);
      await waitFor(`performance.now()-inspectionTimerStart>=240`);
    };
    await mouseMove(hoverPoint);
    await waitFor(`Boolean(document.querySelector('.cardinal-inspection'))`);
    const previewPoint=await evaluate(`(()=>{const r=document.querySelector('.cardinal-inspection__panel').getBoundingClientRect();return {x:r.left+10,y:r.top+10};})()`);
    await mouseMove({x:10,y:10});
    await mouseMove(previewPoint);
    await holdPastDwell();
    await record('Returning to the hover preview cancels delayed dismissal', `Boolean(document.querySelector('.cardinal-inspection'))`);
    await mouseMove({x:10,y:10});
    await waitFor(`!document.querySelector('.cardinal-inspection')`);
    await mouseMove(hoverPoint);
    await mouseMove({x:10,y:10});
    await mouseMove(hoverPoint);
    await waitFor(`Boolean(document.querySelector('.cardinal-inspection'))`);
    await record('Returning after a cancelled dwell can open the same card again', `Boolean(document.querySelector('.cardinal-inspection'))`);
    await key('Escape');
    await mouseMove({x:10,y:10});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...hoverPoint,button:'left',buttons:1,clickCount:1});
    await mouseMove({x:hoverPoint.x+30,y:hoverPoint.y},1);
    await holdPastDwell();
    await record('Mouse dragging past the dwell time cannot open an inspection', `!document.querySelector('.cardinal-inspection') && inspectionScene.snapshot().interaction.sessions.some(s=>s.phase==='dragging')`);
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:hoverPoint.x+30,y:hoverPoint.y,button:'left',buttons:0,clickCount:1});
    await evaluate(`inspectionScene.closeInspection();document.querySelector('#inspection-return-focus').focus()`);
    await record('Denied cards cannot open inspection', `(()=>{try{const h=inspectionScene.inspect('denied');h?.close();return !h;}catch{return true;}})()`);
    await command('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true });
    await evaluate(`inspectionView=inspectionScene.inspect('secret',{modal:true});`);
    await record('Touch-sized viewport keeps preview navigation and dismissal inside the viewport', `(()=>{const p=document.querySelector('.cardinal-inspection__panel');const r=p.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()`);
    await evaluate(`(async()=>{
      inspectionView.close(); const desired=inspectionScene.snapshot().desired; inspectionScene.destroy();
      const {createCardScene}=await import('/packages/card-engine/src/index.js');
      inspectionScene=createCardScene({element:document.querySelector('#inspection-test-host'),motion:{reducedMotion:true}});
      inspectionScene.apply(desired); inspectionView=inspectionScene.inspect('secret');
      inspectionScene.transact([{type:'contentFace',cardId:'secret',faceId:'summary'},{type:'move',cardId:'secret',position:{x:0,y:0}}]);
    })()`);
    await record('Reduced-motion face switching and inspection stay concealed at the screen edge', `!inspectionScene.snapshot().settling && !document.querySelector('.cardinal-inspection').textContent.includes('SECRET FRONT TITLE') && !performance.getEntriesByType('resource').some(e=>e.name.endsWith(inspectionSecretURL))`);
    await evaluate(`(async()=>{
      inspectionView.close(); const desired=inspectionScene.snapshot().desired; inspectionScene.destroy();
      const {createCardScene}=await import('/packages/card-engine/src/index.js');
      inspectionScene=createCardScene({element:document.querySelector('#inspection-test-host'),renderMode:'css',motion:{reducedMotion:true}});
      inspectionScene.apply(desired);inspectionView=inspectionScene.inspect('secret');
    })()`);
    await record('CSS adapter also suppresses concealed DOM content and front asset requests', `(()=>{const f=document.querySelector('#inspection-test-host [data-card-id="secret"] .cardinal-card__surface--front');return f.hidden && !f.textContent && !f.querySelector('img') && !document.querySelector('.cardinal-inspection').textContent.includes('SECRET FRONT TITLE') && !performance.getEntriesByType('resource').some(e=>e.name.endsWith(inspectionSecretURL));})()`);
    return {ok:results.every(r=>r.pass),results,environment};
  } finally {
    await command('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}).catch(()=>{});
    await evaluate(`window.inspectionView?.close();window.inspectionScene?.destroy();document.querySelector('#inspection-test-host')?.remove();document.querySelector('#inspection-return-focus')?.remove();`).catch(()=>{});
    if (environment) await command('Emulation.setDeviceMetricsOverride', {width:environment.innerWidth,height:environment.innerHeight,deviceScaleFactor:environment.devicePixelRatio,mobile:false}).catch(()=>{});
  }
}
