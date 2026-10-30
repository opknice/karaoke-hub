const {test}=require('node:test');const assert=require('node:assert/strict');
const {VocalVideo}=require('../lib/vocal-video.cjs');
const url='https://karaoke-hub-nu.vercel.app/player',track={videoId:'abcdefghijk',queueItemId:'queue-1'};
test('cancelled video setup cannot install a delayed overlay after Stop',async()=>{
 let release;const mutations=[];
 const frame={url:'https://www.youtube.com/embed/',executeJavaScript:script=>{
  if(script==='Boolean(document.querySelector("video"))')return new Promise(resolve=>{release=resolve;});
  mutations.push(script);return Promise.resolve({});
 }};
 const contents={isDestroyed:()=>false,getURL:()=>url,mainFrame:{frames:[frame],executeJavaScript:async()=>track}};
 const video=new VocalVideo(contents,url);
 const starting=video.start({epoch:1,token:'12345678',parentOrigin:new URL(url).origin,startWallMs:Date.now()+200,delayMs:4500},track);
 await new Promise(resolve=>setImmediate(resolve));await video.stop();release(true);
 await assert.rejects(starting,/ยกเลิก/);assert.equal(mutations.length,0);
});
test('video controls cannot use another parent page or a replaced queue item',async()=>{
 const contents={isDestroyed:()=>false,getURL:()=>url,mainFrame:{frames:[],executeJavaScript:async()=>({...track,queueItemId:'another-item'})}};
 const video=new VocalVideo(contents,url);
 await assert.rejects(video.start({},track),/เพลงเปลี่ยน/);
 contents.getURL=()=> 'https://evil.test/player';
 await assert.rejects(video.start({},track),/Player/);
});

test('Stop during asynchronous HQ codec setup revokes the pending overlay',async context=>{
 const {installVideoDelay}=require('../lib/vocal-video.cjs');const original={window:globalThis.window,document:globalThis.document,VideoFrame:globalThis.VideoFrame,OffscreenCanvas:globalThis.OffscreenCanvas};
 context.after(()=>{for(const [key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 let release,requested=0,attached=false;const delayed=new Promise(resolve=>{release=resolve;});const queue={closed:false,close(){this.closed=true;},clear(){},snapshot(){return{};}};
 const source={readyState:2,paused:false,ended:false,duration:120,currentTime:1,videoWidth:1280,videoHeight:720,parentElement:{appendChild(){attached=true;}},addEventListener(){},removeEventListener(){},requestVideoFrameCallback(){requested++;return 1;},cancelVideoFrameCallback(){}};
 const canvas={dataset:{},style:{},getContext:()=>({drawImage(){}}),remove(){attached=false;}};
 globalThis.window={top:{postMessage(){}}};globalThis.document={querySelector:()=>source,createElement:()=>canvas};globalThis.VideoFrame=function(){};globalThis.OffscreenCanvas=class{getContext(){return{drawImage(){}};}};
 const starting=Promise.resolve().then(()=>installVideoDelay({epoch:1,token:'12345678',parentOrigin:'https://karaoke-hub-nu.vercel.app',startWallMs:Date.now()+100,delayMs:8000,videoBufferMode:'encoded'},()=>delayed));
 const outcome=starting.then(value=>({value}),error=>({error}));await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(typeof globalThis.window.__karaokeVocalVideo?.stop,'function','Pending setup must expose its cancellation API');await globalThis.window.__karaokeVocalVideo.stop();release(queue);const result=await outcome;assert.equal(result.error,undefined);assert.equal(result.value.active,false);assert.equal(attached,false);assert.equal(queue.closed,true);assert.equal(requested,0);}finally{release(queue);await outcome;}
});
test('continuous video pause retains packets and freezes logical time without seeking',async context=>{
 const {installVideoDelay}=require('../lib/vocal-video.cjs');const keys=['window','document','VideoFrame','OffscreenCanvas','performance'];const original=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 context.after(()=>{for(const [k,v]of Object.entries(original)){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}});
 let now=0,seeks=0,clears=0,pauses=0,resumes=0,codecClock;const events=new Map();
 const source={readyState:2,paused:false,ended:false,duration:120,videoWidth:1280,videoHeight:720,parentElement:{appendChild(){}},get currentTime(){return 10;},set currentTime(_v){seeks++;},addEventListener(k,f){events.set(k,f);},removeEventListener(k){events.delete(k);},requestVideoFrameCallback(){return 1;},cancelVideoFrameCallback(){}};
 const queue={clear(){clears++;},close(){},pause(){pauses++;},resume(){resumes++;},snapshot(){return{bufferedFrames:7};}};
 globalThis.window={top:{postMessage(){}}};globalThis.document={querySelector:()=>source,createElement:()=>({dataset:{},style:{},getContext:()=>({drawImage(){}}),remove(){}})};globalThis.VideoFrame=function(){};globalThis.OffscreenCanvas=class{getContext(){return{drawImage(){}};}};Object.defineProperty(globalThis,'performance',{configurable:true,value:{timeOrigin:10000,now:()=>now}});
 await installVideoDelay({epoch:1,token:'12345678',parentOrigin:'https://karaoke-hub-nu.vercel.app',startWallMs:10000,delayMs:8000,videoBufferMode:'encoded',continuous:true},async config=>{codecClock=config.clock;return queue;});
 const api=globalThis.window.__karaokeVocalVideo;
 try{now=1000;source.paused=true;events.get('pause')();assert.equal(codecClock(),11000);now=6000;assert.equal(codecClock(),11000,'Clock must not advance while paused');assert.equal(api.snapshot().bufferedFrames,7);assert.equal(clears,0);assert.equal(pauses,1);
  await api.pause();assert.equal(seeks,0);source.paused=false;events.get('play')();now=6033;assert.equal(codecClock(),11033);assert.equal(resumes,1);assert.equal(seeks,0);assert.equal(clears,0);
 }finally{await api.stop({restorePosition:false});}
});
