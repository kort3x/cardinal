import { createPageEvaluator } from './chrome-runtime.mjs';

export async function runTextureReuse({ command }) {
  const evaluate = createPageEvaluator(command);
  return evaluate(`(async () => {
    const { getScene } = await import('/examples/card-engine-lab/main.js');
    const scene = getScene();
    const original = scene.snapshot();
    const results = [];
    const record = (label, pass, details) => results.push({label,pass,details});
    const source = original.desired.cards.find(card => card.faceUp !== false);
    const cards = Array.from({length:100}, (_,index) => ({...structuredClone(source), id:'reuse-'+index, faceUp:true, positionMode:'absolute', pose:{...source.pose,x:index%10*50,y:Math.floor(index/10)*30}}));
    const work = () => scene.rendererDiagnostics();
    const faces = async face => scene.transact(cards.map(card => ({type:'face',cardId:card.id,face})), {immediate:true}).finished;
    const NativeImage = window.Image;
    const nativeSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const delayed = [];
    window.Image = function() {
      const image = new NativeImage();
      Object.defineProperty(image, 'src', {
        get() { return nativeSrc.get.call(image); },
        set(value) {
          if (!value.includes('reuse-delayed')) { nativeSrc.set.call(image,value); return; }
          delayed.push(() => new Promise((resolve,reject) => {
            image.addEventListener('load',resolve,{once:true});
            image.addEventListener('error',reject,{once:true});
            nativeSrc.set.call(image,value);
          }));
        },
      });
      return image;
    };
    try {
      scene.apply({...original.desired, cards:[], zones:[]});
      const before=work();
      scene.apply({...original.desired, cards, zones:[{id:'reuse', geometry:{x:0,y:0,width:1000,height:800,depth:0},cardIds:cards.map(card=>card.id)}]});
      const mounted=work();
      record('100 identical cards share two active surface textures', mounted.work.textureCreates-before.work.textureCreates === 2, mounted);
      await faces('faceDown');
      const concealed=work();
      record('concealment releases every front surface', concealed.mountedSurfaces === 100 && concealed.textures?.active === 1, concealed);
      const beforeReveal=work();
      await faces('faceUp');
      const revealed=work();
      record('revealing the cohort rasterizes one shared front', revealed.work.textureCreates-beforeReveal.work.textureCreates === 1, revealed);
      const snapshot=scene.snapshot().desired;
      const first=snapshot.cards[0];
      first.faces[first.activeFaceId].elements.find(e=>e.type==='text').content.text='Changed independently';
      const priorEdit=work();
      scene.apply(snapshot);
      const edited=work();
      record('editing one card keeps peer textures alive', edited.work.textureCreates-priorEdit.work.textureCreates === 1 && edited.textures?.active === 3, edited);
      const getContext = HTMLCanvasElement.prototype.getContext;
      try {
        HTMLCanvasElement.prototype.getContext = function(kind,...args) {
          return kind === '2d' ? null : getContext.call(this,kind,...args);
        };
        const unavailable = scene.snapshot().desired;
        unavailable.cards[0].faces[first.activeFaceId].elements.find(e=>e.type==='text').content.text='Unavailable replacement';
        scene.apply(unavailable);
        record('unavailable 2D allocation preserves existing textures',work().textures.active === 3
          && work().work.textureCreates === edited.work.textureCreates,work());
      } finally {
        HTMLCanvasElement.prototype.getContext = getContext;
      }
      scene.apply({...original.desired,cards:[],zones:[]});
      record('removing all cards releases shared GPU resources',work().textures?.active === 0
        && work().resources.textures === before.resources.textures,work());
      const beforeRemount=work();
      scene.apply({...original.desired, cards, zones:[{id:'reuse', geometry:{x:0,y:0,width:1000,height:800,depth:0},cardIds:cards.map(card=>card.id)}]});
      record('remount cannot reuse an idle front cache',work().work.textureCreates-beforeRemount.work.textureCreates === 2,work());
      for (const concealAll of [false,true]) {
        const pair = cards.slice(0,2).map(card => structuredClone(card));
        for (const card of pair) {
          const image = card.faces[card.activeFaceId].elements.find(e=>e.type==='image');
          image.content.src += '?reuse-delayed=' + concealAll;
        }
        scene.apply({...original.desired,cards:pair,zones:[{id:'reuse',geometry:{x:0,y:0,width:1000,height:800,depth:0},cardIds:pair.map(card=>card.id)}]});
        await scene.transact((concealAll ? pair : pair.slice(0,1)).map(card=>({type:'face',cardId:card.id,face:'faceDown'})),{immediate:true}).finished;
        const beforeLoad=work();
        if (delayed.length !== 1) throw new Error('Expected one deferred shared image source');
        await Promise.race([delayed.shift()(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Image timeout')),5000))]);
        await new Promise(requestAnimationFrame);
        const afterLoad=work();
        record(concealAll ? 'late image cannot redraw an evicted concealed front' : 'late image updates a revealed peer after original owner conceals',
          afterLoad.work.textureDraws-beforeLoad.work.textureDraws === (concealAll ? 0 : 1)
          && afterLoad.mountedSurfaces === (concealAll ? 2 : 3),afterLoad);
      }
      const filteredCards = cards.slice(0,2).map(card=>structuredClone(card));
      filteredCards[1].faceUp = false;
      for (const card of filteredCards) {
        const front = card.faces[card.activeFaceId];
        front.elements.find(e=>e.type==='image').content.src += '?reuse-delayed=private';
        front.elements.find(e=>e.id==='flavour').content.text = 'HIDDEN SENTINEL';
      }
      scene.apply({...original.desired,cards:filteredCards,zones:[{
        id:'reuse',geometry:{x:0,y:0,width:1000,height:800,depth:0},
        presentation:{elements:['title']},cardIds:filteredCards.map(card=>card.id),
      }]});
      const settleDeadline = performance.now()+5000;
      while (scene.snapshot().settling) {
        if (performance.now()>settleDeadline) throw new Error('Filtered fixture did not settle');
        await new Promise(requestAnimationFrame);
      }
      const canvas = document.querySelector('.cardinal-webgl-canvas');
      const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('Context-loss extension unavailable');
      const eventOnce = type => new Promise((resolve,reject) => {
        const timeout = setTimeout(()=>{canvas.removeEventListener(type,handler);reject(new Error(type+' timeout'));},5000);
        const handler = () => {clearTimeout(timeout);resolve();};
        canvas.addEventListener(type,handler,{once:true});
      });
      const lost=eventOnce('webglcontextlost');
      extension.loseContext();
      await lost;
      // Allow the loss event's default-prevention decision to finish dispatch.
      await new Promise(requestAnimationFrame);
      const restored=eventOnce('webglcontextrestored');
      extension.restoreContext();
      await restored;
      record('context restoration preserves presentation filtering and concealment',
        delayed.length === 0
        && !document.querySelector('.cardinal-webgl-accessibility').textContent.includes('HIDDEN SENTINEL')
        && work().mountedSurfaces === 3,work());
      const { createCardScene } = await import('/packages/card-engine/src/index.js');
      const host = document.createElement('div');
      host.style.cssText='position:absolute;left:-10000px;width:400px;height:300px';
      document.body.append(host);
      let custom;
      let draws=0;
      try {
        custom=createCardScene({element:host,elementRenderers:{probe:{draw({context,x,y,width,height}) {
          context.fillStyle = ++draws === 1 ? 'red' : 'blue';
          context.fillRect(x,y,width,height);
        }}}});
        const customCards=['custom-a','custom-b'].map(id=>({
          id,faceUp:true,activeFaceId:'front',faces:{front:{elements:[{
            id:'probe',type:'probe',layout:{mode:'overlay',x:0,y:0,width:1,height:1},
          }]}},back:{elements:[]},
        }));
        custom.apply({cards:customCards,zones:[{id:'custom',geometry:{x:0,y:0,width:400,height:300,depth:0},cardIds:customCards.map(card=>card.id)}]});
        record('custom drawing keeps private textures per card',draws === 2
          && custom.rendererDiagnostics().textures.active === 4,custom.rendererDiagnostics());
      } finally {
        custom?.destroy();
        host.remove();
      }
    } finally {
      window.Image = NativeImage;
      scene.apply(original.desired);
      scene.select(original.selection.cardIds,{override:true});
    }
    return {ok:results.every(r=>r.pass),results,environment:{userAgent:navigator.userAgent,
      innerWidth,innerHeight,outerWidth,outerHeight,screenX,screenY,devicePixelRatio,
      stage:document.querySelector('#stage').getBoundingClientRect().toJSON()}};
  })()`);
}
