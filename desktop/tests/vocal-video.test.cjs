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
