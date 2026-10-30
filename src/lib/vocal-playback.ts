interface NativeVocalState {
  vocalModelId?: string;
  vocalRemoverEnabled?: boolean;
  currentQueueItemId?: string | null;
  currentVersionType?: string;
  vocalRemoverDelayMs?: number;
}
export function getVocalPlaybackDelay(state: NativeVocalState, queueItemId: string | null): number {
  const delay=state.vocalRemoverDelayMs;
  const approved=state.vocalModelId===undefined?typeof delay==='number'&&delay<=5000
    :state.vocalModelId==='fast'?delay===4500:state.vocalModelId==='hq5'&&delay===8000;
  return state.vocalRemoverEnabled===true&&state.currentVersionType==='mv'&&Boolean(queueItemId)&&state.currentQueueItemId===queueItemId
    &&approved&&typeof delay==='number'&&Number.isFinite(delay)&&delay>0?delay:0;
}
export class DelayedPlaybackEnd {
  private timer: ReturnType<typeof setTimeout> | null=null;
  private itemId: string | null=null;
  schedule(itemId: string,delayMs: number,finish: ()=>void): void {
    if(this.itemId===itemId&&this.timer)return;
    this.cancel();
    if(!Number.isFinite(delayMs)||delayMs<=0||(delayMs>5000&&delayMs!==8000)){finish();return;}
    this.itemId=itemId;
    this.timer=setTimeout(()=>{this.timer=null;this.itemId=null;finish();},delayMs);
  }
  cancel(): void {if(this.timer)clearTimeout(this.timer);this.timer=null;this.itemId=null;}
}
