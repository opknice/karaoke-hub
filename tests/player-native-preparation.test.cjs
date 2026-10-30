const {test}=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{create,act}=require('react-test-renderer');
const {loadPlayer}=require('./helpers/load-youtube-player.cjs');global.IS_REACT_ACT_ENVIRONMENT=true;
const noop=()=>{};
function setup({prepare=async()=>({native:true,buffered:true})}={}){
 const loads=[],times=[],instances=[],ready=[];let events,ends=0;
 const api={PlayerState:{PLAYING:1,PAUSED:2,BUFFERING:3,ENDED:0},Player:class{
  constructor(_node,config){events=config.events;instances.push(this);this.plays=0;this.state=1;}
  setVolume(){}mute(){}unMute(){}setPlaybackRate(){}getPlaybackRate(){return 1;}getAvailablePlaybackRates(){return[1];}
  loadVideoById(p){loads.push(p);}cueVideoById(p){loads.push(p);}getVideoUrl(){return'https://www.youtube.com/watch?v='+karaoke.nowPlaying.video.youtube_video_id;}getDuration(){return 100;}getCurrentTime(){return 20;}getPlayerState(){return this.state;}
  seekTo(){}playVideo(){this.plays++;}pauseVideo(){}destroy(){}
 }};
 const karaoke={nowPlaying:{id:'q-1',video:{youtube_video_id:'abcdefghijk',duration:100,title:'MV',version_type:'mv'},singers:[]},isPlaying:true,volume:80,isMuted:false,queue:[],setIsPlaying:noop,setRoomPlayback:async()=>{},setCurrentTime:t=>times.push(t),setDuration:noop,setVolume:noop,setIsMuted:noop,skipSong:async()=>{},onSongEnd:async()=>{ends++;},handlePlaybackError:async()=>{}};
 const Player=loadPlayer({'@/context/KaraokeContext':{useKaraoke:()=>karaoke,usePlaybackClock:()=>({currentTime:10,duration:100})},'@/lib/youtube-iframe-api':{loadYouTubeIframeApi:async()=>api},'@/lib/queue-algorithm':{formatDuration:String},'@/lib/native-player-preparation':{prepareNativePlayerTrack:prepare,notifyNativePlayerReady:t=>ready.push(t)}},{window:{location:{origin:'http://localhost'},postMessage(){}},location:{origin:'http://localhost'},document:{createElement:()=>({})},YT:api});
 const props={tempoExtensionReady:true,onTempoRateChange:noop};let tree;
 const render=async(extra={})=>{await act(async()=>{const element=React.createElement(Player,{...props,...extra});if(tree)tree.update(element);else tree=create(element,{createNodeMock:()=>({replaceChildren:noop})});});};
 return{render,unmount:async()=>{if(tree)await act(async()=>tree.unmount());},karaoke,loads,times,instances,ready,get ends(){return ends;},get events(){return events;},get tree(){return tree;}};
}
test('initial source loading waits for native capture preparation and never calls play early',async()=>{
 let release;const s=setup({prepare:()=>new Promise(r=>{release=r;})});try{await s.render();await act(async()=>s.events.onReady({target:s.instances[0]}));assert.equal(s.loads.length,0);assert.equal(s.instances[0].plays,0);
  await act(async()=>release({native:true,buffered:true}));assert.equal(s.loads.length,1);assert.equal(s.loads[0].videoId,'abcdefghijk');
 }finally{await s.unmount();}
});
test('changing queue/unmount while preflight waits aborts it and old replies never load old media',async()=>{
 const pending=[];const s=setup({prepare:(track,{signal})=>new Promise(resolve=>pending.push({track,signal,resolve}))});
 try{await s.render();await act(async()=>s.events.onReady({target:s.instances[0]}));s.karaoke.nowPlaying={...s.karaoke.nowPlaying,id:'q-2',video:{...s.karaoke.nowPlaying.video,youtube_video_id:'lmnopqrstuv'}};await s.render();assert.equal(pending[0].signal.aborted,true);
  await act(async()=>pending[0].resolve({native:true,buffered:true}));assert.equal(s.loads.length,0);
  await act(async()=>pending[1].resolve({native:true,buffered:true}));assert.equal(s.loads.length,1);assert.equal(s.loads[0].videoId,'lmnopqrstuv');
 }finally{await s.unmount();}
});
test('explicit cancelled preflight does not load media and a later manual preparation can retry the selected MV',async()=>{
 let attempt=0;const s=setup({prepare:async()=>++attempt===1?{native:true,buffered:false,cancelled:true}:{native:true,buffered:true}});
 try{await s.render();await act(async()=>s.events.onReady({target:s.instances[0]}));assert.equal(s.loads.length,0);await s.render({nativeContinuous:true,nativePlaybackSessionEpoch:2});assert.equal(s.loads.length,1,'Manual Start can retry without selecting the song again');}
 finally{await s.unmount();}
});
test('paused continuous tail resumes remaining time without restarting the ended source',async context=>{
 context.mock.timers.enable({apis:['setTimeout','Date']});const s=setup();const props={nativeContinuous:true,nativeVocalDelayMs:8000,nativePlaybackSessionEpoch:1,nativeSourceEnded:true,nativeVideoReady:true};
 try{await s.render(props);const player=s.instances[0];await act(async()=>s.events.onReady({target:player}));await act(async()=>s.events.onStateChange({target:player,data:1}));player.state=0;await act(async()=>s.events.onStateChange({target:player,data:0}));
  await act(async()=>context.mock.timers.tick(3000));s.karaoke.isPlaying=false;await s.render(props);await act(async()=>context.mock.timers.tick(20000));assert.equal(s.ends,0);
  const plays=player.plays;player.state=2;s.karaoke.isPlaying=true;await s.render(props);assert.equal(player.plays,plays,'Resume the buffered tail without playVideo restarting the source, even when pauseVideo reports PAUSED after ENDED');await act(async()=>context.mock.timers.tick(4999));assert.equal(s.ends,0);await act(async()=>context.mock.timers.tick(1));assert.equal(s.ends,1);
 }finally{await s.unmount();}
});
test('native progress follows displayed timestamps rather than an eight-second media-time subtraction',async context=>{
 context.mock.timers.enable({apis:['setInterval']});const s=setup();try{await s.render({nativeContinuous:true,nativePlaybackTime:12.25,nativeVideoReady:true});await act(async()=>s.events.onReady({target:s.instances[0]}));await act(async()=>context.mock.timers.tick(500));assert.equal(s.times.at(-1),12.25);
  await s.render({nativeContinuous:true,nativePlaybackTime:13.5,nativeVideoReady:true});await act(async()=>context.mock.timers.tick(500));assert.equal(s.times.at(-1),13.5);
 }finally{await s.unmount();}
});
