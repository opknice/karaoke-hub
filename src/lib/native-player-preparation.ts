import type {VideoVersion} from './types';
interface Track{youtubeVideoId:string;queueItemId:string;versionType:VideoVersion;}
interface NativeWindow extends Window{karaokeDesktop?:{continuousVocal?:boolean};}
interface PreparationResult{native:boolean;buffered:boolean;cancelled?:boolean;}
const PAGE='karaoke-hub-page',EXTENSION='karaoke-hub-vocal-cut-extension';
function nativeWindow():NativeWindow|null{return typeof window!=='undefined'&&(window as NativeWindow).karaokeDesktop?.continuousVocal===true?window:null;}
function post(target:Window,type:string,payload:unknown,requestId:string){target.postMessage({source:PAGE,version:1,type,payload,requestId},target.location.origin);}
export async function prepareNativePlayerTrack(track:Track,{signal}:{signal?:AbortSignal}={}):Promise<PreparationResult>{
  const target=nativeWindow();if(!target)return{native:false,buffered:false};
  if(signal?.aborted)return{native:true,buffered:false,cancelled:true};
  const requestId=target.crypto.randomUUID();
  return new Promise(resolve=>{
    let finished=false;
    const done=(result:PreparationResult)=>{if(finished)return;finished=true;clearTimeout(timer);target.removeEventListener('message',onMessage);signal?.removeEventListener('abort',abort);resolve(result);};
    const cancel=(cancelled:boolean)=>{post(target,'CANCEL_PLAYER_PREPARATION',{preparationId:requestId},`${requestId}-cancel`);done({native:true,buffered:false,...(cancelled?{cancelled:true}:{})});};
    const abort=()=>cancel(true);
    const onMessage=(event:MessageEvent)=>{
      const packet=event.data;
      if(event.source!==target||event.origin!==target.location.origin||packet?.source!==EXTENSION||packet.version!==1||packet.type!=='EXTENSION_RESPONSE'||packet.requestId!==requestId)return;
      const state=packet.payload?.state;
      done({native:true,buffered:packet.payload?.ok===true&&state?.supportsContinuousVocal===true&&state.vocalBufferActive===true&&state.currentVideoId===track.youtubeVideoId&&state.currentQueueItemId===track.queueItemId,...(packet.payload?.cancelled===true?{cancelled:true}:{})});
    };
    target.addEventListener('message',onMessage);signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>cancel(false),12000);
    post(target,'PREPARE_PLAYER_TRACK',track,requestId);
  });
}
export function notifyNativePlayerReady(track:Track):void{
  const target=nativeWindow();if(target)post(target,'VOCAL_PLAYBACK_STATE',{youtubeVideoId:track.youtubeVideoId,queueItemId:track.queueItemId,playing:true,mediaReady:true},target.crypto.randomUUID());
}
