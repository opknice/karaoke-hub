const {isPlayerUrl}=require('./policy.cjs');

function isYouTubeFrame(raw) {
  try {
    const url=new URL(raw);
    return !url.username&&!url.password&&['https://www.youtube.com','https://www.youtube-nocookie.com'].includes(url.origin)&&/^\/embed\/(?:[\w-]{11})?$/.test(url.pathname);
  } catch {return false;}
}
async function setMediaPlaybackRate(contents,configuredUrl,rate) {
  if(!Number.isFinite(rate)||rate<0.25||rate>2) throw new Error('ความเร็วต้องอยู่ระหว่าง 25% ถึง 200%');
  if(contents.isDestroyed()||!isPlayerUrl(contents.getURL(),configuredUrl)) throw new Error('Player ไม่พร้อมปรับความเร็ว');
  const main=contents.mainFrame;
  const local=new URL(configuredUrl).protocol==='http:';
  // Only the app's trusted YouTube embed (or explicit loopback media fixture).
  // No filesystem/Node access is granted to the frame.
  const frames=[...(local?[main]:[]),...main.frames.filter(frame=>isYouTubeFrame(frame.url))];
  for(const frame of frames) {
    const actual=await frame.executeJavaScript(`(async()=>{
      const media=document.querySelector('video, audio');
      if(!media||media.readyState<1)return null;
      media.preservesPitch=true;
      media.playbackRate=${JSON.stringify(rate)};
      await new Promise(resolve=>setTimeout(resolve,200));
      return media.playbackRate;
    })()`);
    if(actual!==null) {
      if(contents.isDestroyed()||!isPlayerUrl(contents.getURL(),configuredUrl)) throw new Error('Player เปลี่ยนหน้าแล้ว');
      return actual;
    }
  }
  throw new Error('ยังไม่มีเพลงพร้อมปรับความเร็ว');
}
module.exports={isYouTubeFrame,setMediaPlaybackRate};
