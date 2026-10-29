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
