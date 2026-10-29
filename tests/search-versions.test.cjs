const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function loader(){const modules=new Map();return function load(file){const absolute=path.resolve(__dirname,'..',file);if(modules.has(absolute))return modules.get(absolute).exports;const module={exports:{}};modules.set(absolute,module);const code=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const req=name=>name==='server-only'?{}:name.startsWith('.')?load(path.resolve(path.dirname(absolute),`${name}.ts`)):require(name);vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:absolute})(req,module,module.exports);return module.exports;};}
const mv={id:'yt-MVtest00001',youtube_video_id:'MVtest00001',title:'ขอบฟ้า Official Music Video',channel_name:'Artist Official',channel_id:'artist',thumbnail_url:'',duration:180,embeddable:true,karaoke_score:0,version_type:'mv'};
const kr={...mv,id:'yt-KRtest00001',youtube_video_id:'KRtest00001',title:'ขอบฟ้า karaoke',karaoke_score:95,version_type:'karaoke'};
test('MV server search excludes karaoke, isolates persistent cache and keeps shared search budget',async()=>{
  const saved={fetch:global.fetch,url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,youtube:process.env.YOUTUBE_API_KEY};
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://version-test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';process.env.YOUTUBE_API_KEY='test';
  const stored=new Map();const reservations=[];const queries=[];
  global.fetch=async(input,init={})=>{const url=new URL(input);const body=JSON.parse(init.body??'{}');if(url.hostname==='version-test.supabase.co'){
    if(url.pathname.endsWith('karaoke_search_get'))return Response.json(stored.has(body.p_query)?[{payload:stored.get(body.p_query),updated_at:new Date().toISOString()}]:[]);
    if(url.pathname.endsWith('karaoke_search_reserve')){reservations.push(body.p_query);return Response.json({ok:true,token:'test-token'});}
    if(url.pathname.endsWith('karaoke_search_store'))stored.set(body.p_query,body.p_payload);
    return new Response(null,{status:204});
  }
  const values=[mv,kr];if(url.pathname.endsWith('/search')){queries.push(url.searchParams.get('q'));return Response.json({items:values.map(v=>({id:{videoId:v.youtube_video_id},snippet:{title:v.title,channelId:v.channel_id,channelTitle:v.channel_name}}))});}
  return Response.json({items:values.filter(v=>(url.searchParams.get('id')??'').split(',').includes(v.youtube_video_id)).map(v=>({id:v.youtube_video_id,snippet:{title:v.title,channelId:v.channel_id,channelTitle:v.channel_name},status:{embeddable:true},contentDetails:{duration:'PT3M'},statistics:{viewCount:'12345'}}))});};
  try{
    const api=loader()('src/lib/youtube.ts');
    const results=await api.searchMusicVideos('ขอบฟ้า','test-client');
    assert.deepEqual(results.map(v=>v.youtube_video_id),['MVtest00001']);
    assert.equal(results[0].version_type,'mv');
    assert.equal(queries[0],'ขอบฟ้า','MV keeps the song query without requiring unrelated English title words');
    assert.deepEqual(reservations,['mv:v2:ขอบฟ้า']);
    assert.equal(stored.has('mv:v2:ขอบฟ้า'),true);
    await loader()('src/lib/youtube.ts').searchMusicVideos('ขอบฟ้า','other-client');
    assert.equal(queries.length,1,'MV persistent cache is reused');
    const karaoke=await api.searchKaraokeVideos('ขอบฟ้า','karaoke-client');
    assert.ok(karaoke.some(v=>v.youtube_video_id==='KRtest00001'));
    assert.equal(stored.has('karaoke:ขอบฟ้า'),true,'Karaoke uses a separate cache entry');
    await api.searchKaraokeVideos('mv:ขอบฟ้า','literal-prefix-client');
    assert.equal(stored.has('karaoke:mv:ขอบฟ้า'),true,'Literal Karaoke queries cannot reuse an MV cache key');
    await api.searchMusicVideos('ก'.repeat(250),'long-query-client');
    assert.ok(reservations.at(-1).length<=250,'MV keys fit the existing database limit');
    delete process.env.YOUTUBE_API_KEY;
    await assert.rejects(loader()('src/lib/youtube.ts').searchMusicVideos('different query','test'),/API Key/);
  }finally{global.fetch=saved.fetch;for(const [name,value]of [['NEXT_PUBLIC_SUPABASE_URL',saved.url],['SUPABASE_SERVICE_ROLE_KEY',saved.key],['YOUTUBE_API_KEY',saved.youtube]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
test('server search keys preserve case-sensitive video IDs and isolate both namespaces',()=>{
  const store=loader()('src/lib/youtube-search-store.ts');
  assert.notEqual(store.musicVideoSearchKey('id:AbCdEf12345'),store.musicVideoSearchKey('id:abcdef12345'));
  assert.notEqual(store.karaokeSearchKey('mv:foo'),store.musicVideoSearchKey('foo'));
  assert.ok(store.karaokeSearchKey('ก'.repeat(250)).length<=250);
});
test('MV title classification excludes backing tracks with all existing karaoke markers',()=>{
  const {isKaraokeTitle}=loader()('src/lib/video-version.ts');
  for(const title of ['Song (No Vocals)','Song [No Vocal]','Song Minus One','Song off vocal','เพลง คาราโอเกะ','Song Instrumental'])assert.equal(isKaraokeTitle(title),true,title);
  assert.equal(isKaraokeTitle('Artist - Song [Official MV]'),false);
});
test('browser caches and local previews cannot mix Karaoke and MV versions',async()=>{
  const saved={fetch:global.fetch,window:global.window,storage:global.localStorage};
  global.window={dispatchEvent(){}};const values=new Map();global.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const requests=[];global.fetch=async(_url,init)=>{const body=JSON.parse(init.body);requests.push(body);return Response.json({success:true,data:[body.version==='mv'?mv:kr]});};
  try{
    const client=loader()('src/lib/youtube-search-client.ts');
    await client.searchYouTubeKaraoke('ขอบฟ้า',undefined,'youtube');
    const music=await client.searchYouTubeKaraoke('ขอบฟ้า',undefined,'youtube','mv');
    assert.deepEqual(music.map(v=>v.youtube_video_id),['MVtest00001']);
    assert.equal(requests.length,2);
    assert.equal(client.getLocalSearchPreview('ขอบฟ้า','mv').every(v=>v.version_type==='mv'),true);
    assert.equal(client.getLocalSearchPreview('ขอบฟ้า','karaoke').some(v=>v.youtube_video_id==='MVtest00001'),false);
  }finally{global.fetch=saved.fetch;global.window=saved.window;global.localStorage=saved.storage;}
});
