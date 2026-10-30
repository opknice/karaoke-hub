interface NativeVocalState {
  vocalModelId?: string;
  vocalRemoverEnabled?: boolean;
  currentQueueItemId?: string | null;
  currentVersionType?: string;
  vocalRemoverDelayMs?: number;
  supportsContinuousVocal?: boolean;
  vocalBufferActive?: boolean;
  continuousSessionId?: string | null;
  vocalSessionEpoch?: number;
  vocalPlaybackDelayMs?: number;
  vocalDisplayTime?: number | null;
  vocalVideoReady?: boolean;
  vocalSourceEnded?: boolean;
  captureStatus?: string;
}
export function getContinuousVocalPlayback(state: NativeVocalState,queueItemId: string | null){
  if(state.supportsContinuousVocal!==true||state.vocalBufferActive!==true||state.captureStatus!=='capturing_original'
    ||state.currentVersionType!=='mv'||!queueItemId||state.currentQueueItemId!==queueItemId||state.vocalPlaybackDelayMs!==8000
    ||!['fast','hq5'].includes(state.vocalModelId??'')||typeof state.continuousSessionId!=='string'||state.continuousSessionId.length<8||state.continuousSessionId.length>128
    ||!Number.isSafeInteger(state.vocalSessionEpoch)||(state.vocalSessionEpoch??0)<1||(state.vocalSessionEpoch??0)>=2**31)return null;
  return{delayMs:8000,sessionId:state.continuousSessionId,sessionEpoch:state.vocalSessionEpoch!,
    displayTime:typeof state.vocalDisplayTime==='number'&&Number.isFinite(state.vocalDisplayTime)&&state.vocalDisplayTime>=0?state.vocalDisplayTime:null,
    videoReady:state.vocalVideoReady===true,sourceEnded:state.vocalSourceEnded===true};
}
export function getVocalPlaybackDelay(state: NativeVocalState, queueItemId: string | null): number {
  if(getContinuousVocalPlayback(state,queueItemId))return 8000;
  const delay=state.vocalRemoverDelayMs;
  const approved=state.vocalModelId===undefined?typeof delay==='number'&&delay<=5000
    :state.vocalModelId==='fast'?delay===4500:state.vocalModelId==='hq5'&&delay===8000;
  return state.vocalRemoverEnabled===true&&state.currentVersionType==='mv'&&Boolean(queueItemId)&&state.currentQueueItemId===queueItemId
    &&approved&&typeof delay==='number'&&Number.isFinite(delay)&&delay>0?delay:0;
}
export class DelayedPlaybackEnd {
  private timer: ReturnType<typeof setTimeout> | null=null;
  private itemId: string | null=null;
  private finish: (()=>void) | null=null;
  private remaining=0;
  private started=0;
  constructor(private now: ()=>number=()=>Date.now()){}
  get pending(): boolean{return this.itemId!==null;}
  schedule(itemId: string,delayMs: number,finish: ()=>void): void {
    if(this.itemId===itemId)return;
    this.cancel();
    if(!Number.isFinite(delayMs)||delayMs<=0||(delayMs>5000&&delayMs!==8000)){finish();return;}
    this.itemId=itemId;this.remaining=delayMs;this.finish=finish;this.resume();
  }
  pause(): void{if(!this.timer)return;clearTimeout(this.timer);this.timer=null;this.remaining=Math.max(0,this.remaining-(this.now()-this.started));}
  resume(): void{if(this.timer||!this.itemId)return;this.started=this.now();this.timer=setTimeout(()=>{const finish=this.finish;this.timer=null;this.itemId=null;this.finish=null;this.remaining=0;finish?.();},this.remaining);}
  cancel(): void {if(this.timer)clearTimeout(this.timer);this.timer=null;this.itemId=null;this.finish=null;this.remaining=0;}
}
