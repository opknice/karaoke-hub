const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{create,act}=require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
function loadPlayer(overrides,globals){
 const modules=new Map();
 function load(file){
  const filename=path.resolve(__dirname,'..',file);if(modules.has(filename))return modules.get(filename).exports;
  const module={exports:{}};modules.set(filename,module);
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const localRequire=name=>Object.hasOwn(overrides,name)?overrides[name]:name.startsWith('@/')?load(`src/${name.slice(2)}.ts`):name.startsWith('.')?load(path.resolve(path.dirname(filename),`${name}.ts`)):require(name);
  vm.runInNewContext(code,{module,exports:module.exports,require:localRequire,console,setTimeout,clearTimeout,setInterval,clearInterval,...globals},{filename});return module.exports;
 }
 return load('src/components/YouTubePlayer.tsx').YouTubePlayer;
}
for(const delay of [4500,8000])for(const action of ['restart','seek','playing','disable-without-replay','disable-and-replay'])test(`same-item ${action} during ${delay}ms tail has one valid completion`,async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 let events,ended=0,tree;const instances=[],messages=[];
 const noop=()=>{};
 const api={PlayerState:{PLAYING:1,PAUSED:2,BUFFERING:3,ENDED:0},Player:class{
  constructor(_node,config){events=config.events;instances.push(this);}
  setVolume(){}mute(){}unMute(){}setPlaybackRate(){}getPlaybackRate(){return 1;}getAvailablePlaybackRates(){return[1];}
  loadVideoById(){}cueVideoById(){}getDuration(){return 100;}getCurrentTime(){return 10;}getPlayerState(){return 1;}
  seekTo(){}playVideo(){}pauseVideo(){}destroy(){}
 }};
 const karaoke={nowPlaying:{id:'mv-one',video:{youtube_video_id:'CKDwsFbq1_c',duration:100,title:'MV'},singers:[]},isPlaying:true,volume:80,isMuted:false,queue:[],setIsPlaying:noop,setRoomPlayback:async()=>{},setCurrentTime:noop,setDuration:noop,setVolume:noop,setIsMuted:noop,skipSong:async()=>{},onSongEnd:async()=>{ended++;},handlePlaybackError:async()=>{}};
 const component=loadPlayer({'@/context/KaraokeContext':{useKaraoke:()=>karaoke,usePlaybackClock:()=>({currentTime:10,duration:100})},'@/lib/youtube-iframe-api':{loadYouTubeIframeApi:async()=>api},'@/lib/queue-algorithm':{formatDuration:String}}, {window:{location:{origin:'http://localhost'},postMessage:message=>messages.push(message)},location:{origin:'http://localhost'},document:{createElement:()=>({})},YT:api});
 const ref=React.createRef();
 try{
  await act(async()=>{tree=create(React.createElement(component,{ref,tempoExtensionReady:true,onTempoRateChange:noop,nativeVocalDelayMs:delay,nativeVocalTransport:true}),{createNodeMock:()=>({replaceChildren:noop})});});
  const player=instances[0];
  await act(async()=>events.onReady({target:player}));
  await act(async()=>events.onStateChange({target:player,data:1}));
  await act(async()=>events.onStateChange({target:player,data:0}));
  await act(async()=>context.mock.timers.tick(1000));assert.equal(ended,0);
  const beforeMessages=messages.length;
  await act(async()=>{
   if(action==='restart')ref.current.restartCurrentSong();
   if(action==='seek')tree.root.findAllByType('input').find(input=>input.props.type==='range'&&input.props.max===100).props.onChange({target:{value:'20'}});
   if(action.startsWith('disable'))tree.update(React.createElement(component,{ref,tempoExtensionReady:true,onTempoRateChange:noop,nativeVocalDelayMs:0,nativeVocalTransport:true}));
   if(action==='playing'||action==='disable-and-replay')events.onStateChange({target:player,data:1});
  });
  if(action.startsWith('disable'))assert.equal(messages.length,beforeMessages,'Changing only AI delay must not echo stale playing state and undo a native pause during a model switch');
  await act(async()=>context.mock.timers.tick(delay+1000));
  assert.equal(ended,action==='disable-without-replay'?1:0,'An actual replay cancels the old tail; a failed replay must not strand completion');
  if(action!=='disable-without-replay')await act(async()=>events.onStateChange({target:player,data:0}));
  await act(async()=>context.mock.timers.tick(delay));assert.equal(ended,1,'A subsequent actual end still advances once');
  if(action.startsWith('disable'))for(const playing of [false,true]){
   karaoke.isPlaying=playing;
   await act(async()=>tree.update(React.createElement(component,{ref,tempoExtensionReady:true,onTempoRateChange:noop,nativeVocalDelayMs:0,nativeVocalTransport:true})));
   assert.equal(messages.at(-1).payload.playing,playing,'Actual pause/play changes still reach native while AI is off');
  }
 }finally{if(tree)await act(async()=>tree.unmount());}
});
