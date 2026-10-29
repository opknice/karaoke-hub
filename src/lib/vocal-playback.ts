interface NativeVocalState {
  vocalRemoverEnabled?: boolean;
  currentQueueItemId?: string | null;
  currentVersionType?: string;
  vocalRemoverDelayMs?: number;
}
export function getVocalPlaybackDelay(state: NativeVocalState, queueItemId: string | null): number {
  const delay=state.vocalRemoverDelayMs;
  return state.vocalRemoverEnabled===true&&state.currentVersionType==='mv'&&Boolean(queueItemId)&&state.currentQueueItemId===queueItemId
    &&typeof delay==='number'&&Number.isFinite(delay)&&delay>0&&delay<=5000?delay:0;
}
export class DelayedPlaybackEnd {
  private timer: ReturnType<typeof setTimeout> | null=null;
  private itemId: string | null=null;
  schedule(itemId: string,delayMs: number,finish: ()=>void): void {
    if(this.itemId===itemId&&this.timer)return;
    this.cancel();
    if(!Number.isFinite(delayMs)||delayMs<=0||delayMs>5000){finish();return;}
    this.itemId=itemId;
    this.timer=setTimeout(()=>{this.timer=null;this.itemId=null;finish();},delayMs);
  }
  cancel(): void {if(this.timer)clearTimeout(this.timer);this.timer=null;this.itemId=null;}
}
