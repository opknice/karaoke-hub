const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isYouTubeFrame,setMediaPlaybackRate}=require('../lib/media-tempo.cjs');
const configured='https://karaoke-hub-nu.vercel.app/player';
test('native tempo targets only trusted YouTube embed documents',()=>{
  assert.equal(isYouTubeFrame('https://www.youtube.com/embed/abcdefghijk?enablejsapi=1'),true);
  assert.equal(isYouTubeFrame('https://www.youtube-nocookie.com/embed/abcdefghijk'),true);
  assert.equal(isYouTubeFrame('https://www.youtube.com/embed/?enablejsapi=1&widgetid=1'),true);
  for(const url of ['http://www.youtube.com/embed/abcdefghijk','https://www.youtube.com.evil.test/embed/abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk','https://user:pass@www.youtube.com/embed/abcdefghijk','https://example.com/embed/abcdefghijk'])assert.equal(isYouTubeFrame(url),false,url);
});
test('native tempo rejects unauthorized parent pages before reading their frames',async()=>{
  const contents={isDestroyed:()=>false,getURL:()=> 'https://evil.test/player',get mainFrame(){throw new Error('must not access unauthorized frames');}};
  await assert.rejects(setMediaPlaybackRate(contents,configured,1.26),/Player/);
});
test('missing YouTube media cannot redirect control into an unrelated iframe',async()=>{
  const contents={isDestroyed:()=>false,getURL:()=>configured,mainFrame:{frames:[{url:'https://example.com/embed/abcdefghijk',executeJavaScript(){throw new Error('untrusted script executed');}}]}};
  await assert.rejects(setMediaPlaybackRate(contents,configured,1.26),/ยังไม่มีเพลง/);
  await assert.rejects(setMediaPlaybackRate(contents,configured,Infinity),/25%/);
});
