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
for(const action of ['restart','seek','playing'])test(`same-item ${action} during delayed tail cancels the previous completion`,async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 let events,ended=0,tree;const instances=[];
 const noop=()=>{};
 const api={PlayerState:{PLAYING:1,PAUSED:2,BUFFERING:3,ENDED:0},Player:class{
  constructor(_node,config){events=config.events;instances.push(this);}
  setVolume(){}mute(){}unMute(){}setPlaybackRate(){}getPlaybackRate(){return 1;}getAvailablePlaybackRates(){return[1];}
  loadVideoById(){}cueVideoById(){}getDuration(){return 100;}getCurrentTime(){return 10;}getPlayerState(){return 1;}
  seekTo(){}playVideo(){}pauseVideo(){}destroy(){}
 }};
 const karaoke={nowPlaying:{id:'mv-one',video:{youtube_video_id:'CKDwsFbq1_c',duration:100,title:'MV'},singers:[]},isPlaying:true,volume:80,isMuted:false,queue:[],setIsPlaying:noop,setRoomPlayback:async()=>{},setCurrentTime:noop,setDuration:noop,setVolume:noop,setIsMuted:noop,skipSong:async()=>{},onSongEnd:async()=>{ended++;},handlePlaybackError:async()=>{}};
 const component=loadPlayer({'@/context/KaraokeContext':{useKaraoke:()=>karaoke,usePlaybackClock:()=>({currentTime:10,duration:100})},'@/lib/youtube-iframe-api':{loadYouTubeIframeApi:async()=>api},'@/lib/queue-algorithm':{formatDuration:String}}, {window:{location:{origin:'http://localhost'},postMessage:noop},location:{origin:'http://localhost'},document:{createElement:()=>({})},YT:api});
 const ref=React.createRef();
 try{
  await act(async()=>{tree=create(React.createElement(component,{ref,tempoExtensionReady:true,onTempoRateChange:noop,nativeVocalDelayMs:4500}),{createNodeMock:()=>({replaceChildren:noop})});});
  const player=instances[0];
  await act(async()=>events.onReady({target:player}));
  await act(async()=>events.onStateChange({target:player,data:1}));
  await act(async()=>events.onStateChange({target:player,data:0}));
  await act(async()=>context.mock.timers.tick(1000));assert.equal(ended,0);
  await act(async()=>{
   if(action==='restart')ref.current.restartCurrentSong();
   if(action==='seek')tree.root.findAllByType('input').find(input=>input.props.type==='range'&&input.props.max===100).props.onChange({target:{value:'20'}});
   if(action==='playing')events.onStateChange({target:player,data:1});
  });
  await act(async()=>context.mock.timers.tick(5000));
  assert.equal(ended,0,'Old ENDED timer must not advance a restarted or sought MV');
  await act(async()=>events.onStateChange({target:player,data:0}));
  await act(async()=>context.mock.timers.tick(4500));assert.equal(ended,1,'A subsequent actual end still advances once');
 }finally{if(tree)await act(async()=>tree.unmount());}
});
