'use strict';
const $=id=>document.getElementById(id);
const scene=$('scene'), ctx=scene.getContext('2d');
let modules=[], code, link, phase=0, goal=0, frame, audio, hits=[], pressed=new Map();
// Tiny Tunes state: a tune is a row of steps, each a key (0-12) or a rest (null).
const CH='0123456789abc', STEP=230, MAX=96, TWINKLE='0077997.5544220';
let steps=[], rec=null, timers=[], playing=false, received=false, autoplay=false, typing;
const unpack=s=>[...s].slice(0,MAX).map(c=>{const n=CH.indexOf(c);return n<0?null:n});
const pack=()=>steps.map(n=>n===null||n===undefined?'.':CH[n]).join('').replace(/\.+$/,'');
const orders=new Map();
const notes=()=>steps.filter(n=>n!=null).length;
const white=[0,2,4,5,7,9,11,12], black=[1,3,null,6,8,10];
const keys='awsedftgyhujk';
let yaw=.32, pitch=.42, pointer=null;
const clamp=x=>Math.max(0,Math.min(1,x));
function parts(){
 const list=[];
 function add(dark,name,x,y,z,w,d,h,note=null){list.push({dark,name,x,y,z,w,d,h,note,volume:w*d*h})}
 // A shallow, tall cabinet with projecting keyboard, feet and pedals.
 add(true,'cabinet',0,3.2,.6,16,2.1,10.5);
 add(true,'cap',-.2,3,11.1,16.4,2.5,.55);
 add(true,'rail',0,0,4.5,16,3.2,.55);
 add(true,'rail',0,0,5.05,.65,3.2,.9);
 add(true,'rail',15.35,0,5.05,.65,3.2,.9);
 // The shelf rests just above the black keys, and the panel starts where the shelf ends: no overlaps.
 add(true,'panel',.65,3,6.35,14.7,.2,4.3);
 add(true,'rail',.55,2.7,6.05,14.9,.5,.3);
 for(const x of [.25,14.65]){
  add(true,'leg',x,.35,.5,1.1,1.2,4);
  add(true,'foot',x-.15,0,0,1.4,5.4,.5);
 }
 // Pale rear soundboard also gives the white QR modules a substantial home.
 add(false,'soundboard',.65,5.3,1.1,14.7,.28,9.4);
 for(const x of [6.1,7.6,9.1])add(false,'pedal',x,1,.65,.55,2.2,.25);
 white.forEach((note,i)=>add(false,'key',.72+i*1.82,0,5.06,1.72,2.95,.55,note));
 black.forEach((note,i)=>{if(note!==null)add(true,'key',2.02+i*1.82,1.35,5.61,.85,1.6,.42,note)});
 return list;
}
// Fitted pieces preserve the QR mapping while forming a continuous cabinet.
function split(box,count,out){
 if(count===1){out.push(box);return}
 const axes=[['x','w'],['y','d'],['z','h']].sort((a,b)=>box[b[1]]-box[a[1]]);
 const [pos,size]=axes[0],left=Math.floor(count/2),length=box[size]*left/count;
 split({...box,[size]:length},left,out);
 split({...box,[pos]:box[pos]+length,[size]:box[size]-length},count-left,out);
}
function assign(sources,parts){
 const total=parts.reduce((s,p)=>s+p.volume,0),spare=sources.length-parts.length;
 let weight=0,assigned=0;const targets=[];
 for(const p of parts){weight+=p.volume;let upto=Math.round(weight/total*spare);split(p,1+upto-assigned,targets);assigned=upto}
 // Nearby modules travel together; colour and source identity stay fixed throughout.
 sources.sort((a,b)=>a.col-b.col||a.row-b.row);
 targets.sort((a,b)=>(a.x+.46*a.y)-(b.x+.46*b.y)||a.y-b.y);
 return sources.map((s,i)=>({...s,...targets[i]}));
}
// keep=true swaps in a fresh QR without refolding the piano (used while composing).
function generate(raw,keep){
 const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.href.length>2200)throw Error();
 const next=new QRCode(-1,1);next.addData(url.href);next.make();
 const sources=[[],[]];next.modules.forEach((row,r)=>row.forEach((dark,c)=>sources[+dark].push({row:r,col:c})));
 const shape=parts();const blocks=sources.flatMap((cells,i)=>assign(cells,shape.filter(p=>+p.dark===i)));
 if(!keep){cancelAnimationFrame(frame);phase=goal=0}
 code=next;link=url.href;modules=blocks;orders.clear();draw();describe();
}
function describe(){
 let label=!goal?(received?'Someone sent you a tiny tune · Tap to unfold':'Tap to unfold the piano')
  :rec?(rec.t0===null?'Recording · Play your first note to begin':'Recording · Press stop when you are done')
  :playing?'Playing…':'Drag to look around · Tap keys to play · Tap body to fold';
 scene.ariaLabel=label+' · Keyboard: A W S E D F T G Y H U J K. R records, P plays. Arrow keys rotate. Enter folds.';
 scene.removeAttribute('title');$('announce').textContent=label;$('hint').textContent=label;
 scene.style.cursor=goal?'grab':'pointer';sync();
}
// Keeps the menu controls, message card and button states in step with the app state.
function sync(){
 const n=notes(),msg=$('msg').value.trim();
// Controls live in the side menu and work folded or unfolded.
 document.body.classList.toggle('recording',!!rec);
 $('rec').setAttribute('aria-pressed',!!rec);$('rec').lastElementChild.textContent=rec?'Stop':'Record';
 $('playbtn').lastElementChild.textContent=playing?'Pause':'Play';$('playbtn').disabled=!n||!!rec;$('clear').disabled=!n&&!rec;
 $('count').textContent=n?`${n} note${n===1?'':'s'}`:'No notes yet';
 $('note').textContent=msg;$('note').classList.toggle('show',!!(goal&&msg));
}
function project(x,y,z){
 x-=8;y-=2.7;z-=5.8;
 const rx=x*Math.cos(yaw)+y*Math.sin(yaw), ry=-x*Math.sin(yaw)+y*Math.cos(yaw);
 return [400+38*rx,400-38*(z*Math.cos(pitch)+ry*Math.sin(pitch)),z*Math.sin(pitch)-ry*Math.cos(pitch)];
}
// ---- Exact back-to-front order for the settled piano ----
// Sorting by average depth breaks when neighbouring bricks differ in size, which showed up as
// stray triangles and dashes. For axis-aligned boxes the true order depends only on which way
// the camera leans (the signs of its direction), so we work it out once per lean and cache it.
// A box must be painted before another when it sits entirely behind it along some axis and
// is never in front of it along another.
function backToFront(gx,gy){
 const n=modules.length,g=[gx,gy,1],lo=new Float64Array(3*n),hi=new Float64Array(3*n),E=1e-6;
 for(let i=0;i<n;i++){const m=modules[i];lo[3*i]=m.x;hi[3*i]=m.x+m.w;lo[3*i+1]=m.y;hi[3*i+1]=m.y+m.d;lo[3*i+2]=m.z;hi[3*i+2]=m.z+m.h}
 let cap=1<<18,from=new Int32Array(cap),to=new Int32Array(cap),ne=0;
 for(let a=0;a<n;a++)for(let b=a+1;b<n;b++){
  let behind=false,front=false;
  for(let k=0;k<3;k++){
   const al=lo[3*a+k],ah=hi[3*a+k],bl=lo[3*b+k],bh=hi[3*b+k];
   if(g[k]>0){if(ah<=bl+E)behind=true;else if(bh<=al+E)front=true}
   else{if(al>=bh-E)behind=true;else if(bl>=ah-E)front=true}
  }
  if(behind===front)continue;
  if(ne===cap){cap*=2;const f=new Int32Array(cap),t=new Int32Array(cap);f.set(from);t.set(to);from=f;to=t}
  if(behind){from[ne]=a;to[ne++]=b}else{from[ne]=b;to[ne++]=a}
 }
 const start=new Int32Array(n+1),indeg=new Int32Array(n),next=new Int32Array(ne);
 for(let e=0;e<ne;e++){start[from[e]+1]++;indeg[to[e]]++}
 for(let i=0;i<n;i++)start[i+1]+=start[i];
 const fill=start.slice(0,n);for(let e=0;e<ne;e++)next[fill[from[e]]++]=to[e];
 const out=[],queue=[];for(let i=0;i<n;i++)if(!indeg[i])queue.push(i);
 for(let h=0;h<queue.length;h++){const a=queue[h];out.push(a);for(let e=start[a];e<start[a+1];e++)if(!--indeg[next[e]])queue.push(next[e])}
 if(out.length<n){ // a rare tie: paint whatever is left by average depth
  const done=new Set(out),depth=i=>g[0]*(lo[3*i]+hi[3*i])+g[1]*(lo[3*i+1]+hi[3*i+1])+g[2]*(lo[3*i+2]+hi[3*i+2]);
  const rest=[];for(let i=0;i<n;i++)if(!done.has(i))rest.push(i);
  rest.sort((a,b)=>depth(a)-depth(b));out.push(...rest);
 }
 return out;
}
function drawSolid(){
 const gx=Math.sin(yaw)>=0?1:-1,gy=Math.cos(yaw)>=0?-1:1,key=gx+2*gy;
 let list=orders.get(key);if(!list){list=backToFront(gx,gy);orders.set(key,list)}
 const front=gy<0?[0,1,5,4]:[2,6,7,3],side=gx>0?[1,3,7,5]:[0,4,6,2];
 hits=[];
 for(const i of list){
  const m=modules[i],lit=m.note!==null&&pressed.has(m.note),drop=lit?.16:0;
  const palette=lit?(m.dark?['#9a7620','#b58a2a','#6b5116']:['#ffe9a3','#d8b95a','#f3da8c']):m.dark?['#292b2a','#343735','#181b19']:['#fffdf4','#c8c6bc','#e6e3d8'];
  const verts=[];for(let v=0;v<8;v++)verts.push(project(m.x+(v&1)*m.w,m.y+((v>>1)&1)*m.d,m.z+((v>>2)&1)*m.h-drop));
  for(const [shade,ids] of [[2,front],[1,side],[0,[4,5,7,6]]]){
   const path=new Path2D();ids.forEach((id,j)=>j?path.lineTo(verts[id][0],verts[id][1]):path.moveTo(verts[id][0],verts[id][1]));path.closePath();
   ctx.fillStyle=palette[shade];ctx.fill(path);
   // Matching edge paint closes antialiasing hairlines between neighbours.
   ctx.strokeStyle=palette[shade];ctx.lineWidth=.6;ctx.stroke(path);
   hits.push({path,note:m.note});
  }
 }
}
function draw(){
 const W=scene.width,H=scene.height,S=W/800;ctx.setTransform(S,0,0,S,0,0);ctx.clearRect(0,0,800,H/S);
 const n=code.moduleCount,u=Math.max(1,Math.floor(W*.88/(n+8)))/S;
 const left=Math.round((W-n*u*S)/2)/S;
 if(phase===0){
  ctx.fillStyle='#202320';for(const m of modules)if(m.dark)ctx.fillRect(left+m.col*u,left+m.row*u,u,u);
  hits=[];return;
 }
 if(phase===1){drawSolid();return}
 const bricks=[];hits=[];
 // Modest, same-sized bricks keep the painter's sort honest from every angle.
 const pieces=modules;
 const span=Math.max(1,2*(n-1));
 for(const m of pieces){
  // A wave sweeps across the code so the pieces take flight in sequence.
  const delay=.4*(m.row+m.col)/span+.12*(({leg:0,foot:0,rail:.2,cabinet:.4,panel:.55,key:.75,pedal:.6,soundboard:.5,cap:1})[m.name]||0);
  const k=clamp((phase-delay)/.48),t=k*k*(3-2*k);
  const drop=m.note!==null&&pressed.has(m.note)?.16:0;
  const lit=m.note!==null&&pressed.has(m.note);
  const palette=lit?(m.dark?['#9a7620','#b58a2a','#6b5116']:['#ffe9a3','#d8b95a','#f3da8c']):m.dark?['#292b2a','#343735','#181b19']:['#fffdf4','#c8c6bc','#e6e3d8'];
  // Select camera-facing sides for the orbit.
  const front=Math.cos(yaw)>=0?[0,1,5,4]:[2,6,7,3];
  const side=Math.sin(yaw)>=0?[1,3,7,5]:[0,4,6,2];
  // Oversized bricks are sliced into near-cubic cells: comparable volumes keep
  // the painter's sort stable, since a convex cell's visible faces never overlap.
  const nx=Math.ceil(m.w/1.2),ny=Math.ceil(m.d/1.2),nz=Math.ceil(m.h/1.2);
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)for(let q=0;q<nz;q++){
   const verts=[];
   for(let v=0;v<8;v++){
    const a=(i+(v&1))/nx,b=(j+((v>>1)&1))/ny,c=(q+((v>>2)&1))/nz;
    const dest=project(m.x+a*m.w,m.y+b*m.d,m.z+c*m.h-drop);
    const sx=left+(m.col+a)*u,sy=left+(m.row+1-b)*u;
    verts.push([sx+(dest[0]-sx)*t,sy+(dest[1]-sy)*t,dest[2]]);
   }
   const faces=[[2,front],[1,side],[0,[4,5,7,6]]].map(([index,ids])=>({v:ids.map(i=>verts[i]),color:palette[index],note:m.note}));
   bricks.push({faces,depth:verts.reduce((s,p)=>s+p[2],0)/8});
  }
 }
 bricks.sort((a,b)=>a.depth-b.depth);
 const faces=bricks.flatMap(b=>b.faces);
 for(const f of faces){const path=new Path2D();f.v.forEach(([x,y],i)=>i?path.lineTo(x,y):path.moveTo(x,y));path.closePath();ctx.fillStyle=f.color;ctx.fill(path);
 // Matching edge paint closes antialiasing hairlines without outlining bricks.
 ctx.strokeStyle=f.color;ctx.lineWidth=.6;ctx.stroke(path);
 if(phase===1)hits.push({path,note:f.note});}
}
function resize(){const r=scene.getBoundingClientRect();scene.width=scene.height=Math.max(1,Math.round(r.width*Math.min(devicePixelRatio||1,2)));if(code)draw()}
function toggle(){goal=1-goal;if(!goal){stopTune();if(rec)stopRec()}cancelAnimationFrame(frame);const start=phase,now=performance.now(),ms=matchMedia('(prefers-reduced-motion: reduce)').matches?0:950*Math.abs(goal-start);
 sync();
 function step(time){const k=ms?clamp((time-now)/ms):1;phase=k===1?goal:start+(goal-start)*k;draw();if(k<1)frame=requestAnimationFrame(step);else{describe();if(goal&&autoplay){autoplay=false;setTimeout(playTune,250)}}}step(now)}
// ms is how long the key stays lit; keys also sound for longer than they glow.
function play(note,ms=190){
 clearTimeout(pressed.get(note));pressed.set(note,setTimeout(()=>{pressed.delete(note);draw()},ms));draw();
 const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;audio??=new Audio();audio.resume().catch(()=>{});
 for(const [h,vol] of [[1,.22],[2,.08],[3,.035],[5,.014]]){const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;o.frequency.value=261.626*2**(note/12)*h;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+1.25/h);o.connect(g).connect(audio.destination);o.start(t);o.stop(t+1.3)}
}
// A key the person pressed: it sounds, and lands on the tape if we are recording.
function strike(note){
 if(playing)stopTune();play(note);if(!rec)return;
 const now=performance.now();rec.t0??=now;
 let i=Math.round((now-rec.t0)/STEP);while(steps[i]!=null)i++;
 if(i>=MAX){stopRec();return}
 for(let k=steps.length;k<i;k++)steps[k]=null;steps[i]=note;describe();
}
function playTune(){
 if(!notes()||rec)return;
 if(!goal){autoplay=true;toggle();return}stopTune();playing=true;const ms=STEP;
 steps.forEach((n,i)=>{if(n!=null)timers.push(setTimeout(()=>play(n,Math.max(190,ms*.85)),120+i*ms))});
 timers.push(setTimeout(stopTune,steps.length*ms+700));describe();
}
function stopTune(){timers.forEach(clearTimeout);timers=[];if(playing){playing=false;describe()}}
function startRec(){
 if(!goal)toggle();
 stopTune();if(received){$('msg').value='';received=false}
 steps=[];rec={t0:null};describe();
}
function stopRec(){
 rec=null;while(steps.length&&steps[steps.length-1]==null)steps.pop();
 refresh();describe();
}
function clearTune(){stopTune();rec=null;steps=[];received=false;refresh();describe()}
function tap(e){
 if(phase===1){const r=scene.getBoundingClientRect(),x=(e.clientX-r.left)*scene.width/r.width,y=(e.clientY-r.top)*scene.height/r.height;
 const face=hits.findLast(f=>ctx.isPointInPath(f.path,x,y));if(face&&face.note!==null){strike(face.note);return}}
 toggle();
}
scene.onpointerdown=e=>{
 if(pointer||e.button!==0)return;
 scene.classList.add('pointer-focus');scene.focus({preventScroll:true});scene.setPointerCapture(e.pointerId);
 pointer={id:e.pointerId,x:e.clientX,y:e.clientY,yaw,pitch,drag:false,orbit:phase===1};
};
scene.onpointermove=e=>{
 if(!pointer||pointer.id!==e.pointerId)return;
 const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
 if(Math.hypot(dx,dy)>6)pointer.drag=true;
 if(pointer.drag&&pointer.orbit){yaw=pointer.yaw+dx*.008;pitch=Math.max(.12,Math.min(1.15,pointer.pitch+dy*.006));scene.style.cursor='grabbing';draw()}
};
scene.onpointerup=e=>{
 if(!pointer||pointer.id!==e.pointerId)return;
 const clicked=!pointer.drag;pointer=null;scene.releasePointerCapture(e.pointerId);
 scene.style.cursor=goal?'grab':'pointer';if(clicked)tap(e);
};
scene.onpointercancel=scene.onlostpointercapture=()=>{pointer=null;scene.style.cursor=goal?'grab':'pointer'};
scene.onkeydown=e=>{
 scene.classList.remove('pointer-focus');
 if(phase===1&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
  e.preventDefault();yaw+=(e.key==='ArrowRight'?.12:e.key==='ArrowLeft'?-.12:0);
  pitch=Math.max(.12,Math.min(1.15,pitch+(e.key==='ArrowDown'?.08:e.key==='ArrowUp'?-.08:0)));draw();return;
 }
 if(e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;
 if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}
 else if(phase===1&&e.key.length===1){const k=e.key.toLowerCase();
  if(k==='r')rec?stopRec():startRec();else if(k==='p')playing?stopTune():playTune();
  else{const n=keys.indexOf(k);if(n>=0)strike(n)}}
};
document.addEventListener('keydown',()=>scene.classList.remove('pointer-focus'));
// ---- Tiny Tunes: the tune lives in the link, so the QR carries it. ----
// Once published, set HOME to your page's address (e.g. 'https://you.github.io/tiny-tunes/').
// Left empty, a published page uses its own address, and a local preview uses a placeholder.
const HOME='';
const site=()=>HOME||(location.protocol.startsWith('http')?location.origin+location.pathname:'https://example.com/');
function buildLink(){
 const url=new URL(site());url.hash='';
 const p=new URLSearchParams(),t=pack();
 if(t)p.set('t',t);
 const m=$('msg').value.trim();if(m)p.set('m',m);
 const h=p.toString();return url.href+(h?'#'+h:'');
}
function refresh(){
 try{generate(buildLink(),true);$('error').textContent='';$('error').hidden=true}
 catch{$('error').textContent='That is too much for one QR code. Try a shorter message.';$('error').hidden=false}
 sync();
}
function later(){clearTimeout(typing);typing=setTimeout(refresh,250);sync()}
$('msg').oninput=later;
document.querySelector('form').onsubmit=e=>e.preventDefault();
$('rec').onclick=()=>rec?stopRec():startRec();
$('playbtn').onclick=()=>playing?stopTune():playTune();
$('clear').onclick=clearTune;
function download(href,name){const a=document.createElement('a');a.href=href;a.download=name;a.click()}
function flash(button,text){const label=button.lastElementChild,old=label.textContent;label.textContent=text;setTimeout(()=>label.textContent=old,1600)}
$('save').onclick=()=>{
 const n=code.moduleCount,cell=16,W=(n+8)*cell,img=document.createElement('canvas');img.width=W;img.height=W+76;
 const c=img.getContext('2d');c.fillStyle='white';c.fillRect(0,0,img.width,img.height);
 c.fillStyle='#202320';for(const m of modules)if(m.dark)c.fillRect((m.col+4)*cell,(m.row+4)*cell,cell,cell);
 c.textAlign='center';c.font='600 30px system-ui,sans-serif';c.fillText('Tiny Tunes',W/2,W+4);
 c.fillStyle='#6b7266';c.font='22px system-ui,sans-serif';c.fillText('scan, then tap to unfold the piano',W/2,W+40);
 download(img.toDataURL(),'tiny-tunes-qr.png');
};
$('share').onclick=async()=>{
 const m=$('msg').value.trim(),text=m?`${m} (a tiny tune for you)`:'A tiny tune for you';
 if(navigator.share){try{await navigator.share({title:'Tiny Tunes',text,url:link});return}catch(e){if(e.name==='AbortError')return}}
 try{await navigator.clipboard.writeText(link);flash($('share'),'Link copied')}catch{prompt('Copy this link',link)}
};
// Start from a received tune if the link carries one; otherwise offer a little demo.
function openFromHash(first){
 const given=new URLSearchParams(location.hash.slice(1));
 if(given.has('t')||given.has('m')){
  stopTune();rec=null;
  steps=unpack(given.get('t')||'');
  $('msg').value=(given.get('m')||'').slice(0,80);received=true;
  // Already unfolded (a new link opened in this tab)? Play it right away.
  if(goal)setTimeout(playTune,250);else autoplay=true;
 }else if(first)steps=unpack(TWINKLE);else return;
 try{generate(buildLink(),!first)}catch{generate('https://example.com/',!first)}
}
openFromHash(true);resize();
new ResizeObserver(resize).observe(scene);
addEventListener('hashchange',()=>openFromHash(false));
