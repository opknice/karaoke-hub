"""Bounded, finalized Instrumental HQ5 overlap-add; no audio/file/network I/O."""
import numpy as np
from separator import STFT, RATE, WINDOW

class HQSeparator:
    def __init__(self,predict,compensation=1.01,denoise=True):
        if denoise is not True:raise ValueError('HQ5 requires sign denoise')
        if not np.isfinite(compensation) or compensation<=0:raise ValueError('Invalid compensation')
        self.predict=predict;self.compensation=float(compensation)
        self.transform=STFT(n_fft=5120,bins=2560)
        self.capacity=RATE*12;self.stride=WINDOW//4
        self.blend=np.hanning(WINDOW).astype(np.float32)
        self.reset()

    def reset(self):
        self.mix=np.zeros((2,self.capacity),np.float32)
        self.estimated=np.zeros_like(self.mix);self.weight=np.zeros(self.capacity,np.float32)
        self.total_frames=0;self.emitted=0;self.next_start=-2*self.stride

    def push(self,pcm):
        if pcm.shape!=(2,RATE) or pcm.dtype!=np.float32 or not np.isfinite(pcm).all():
            raise ValueError('Expected one second of finite stereo float32 PCM')
        incoming=np.arange(self.total_frames,self.total_frames+RATE)%self.capacity
        self.mix[:,incoming]=pcm;self.total_frames+=RATE
        while self.next_start+WINDOW<=self.total_frames:
            start=self.next_start;end=start+WINDOW
            # Reflected beginning context is available before its first output deadline.
            positions=np.abs(np.arange(start,end))
            if positions.max()>=self.total_frames:break
            chunk=self.mix[:,positions%self.capacity]
            spectrum=self.transform.forward(chunk);spectrum[:,:,:3]=0
            estimate=(self.predict(spectrum)-self.predict(-spectrum))*.5
            if estimate.shape!=spectrum.shape or not np.isfinite(estimate).all():
                raise ValueError('Model returned invalid Instrumental estimate')
            instrumental=self.transform.inverse(estimate)*self.compensation
            left=max(0,start);offset=left-start;slots=np.arange(left,end)%self.capacity
            self.estimated[:,slots]+=instrumental[:,offset:]*self.blend[offset:]
            self.weight[slots]+=self.blend[offset:];self.next_start+=self.stride
        final=max(0,self.next_start)
        if final<=self.emitted:return None
        start=self.emitted;slots=np.arange(start,final)%self.capacity
        weights=self.weight[slots]
        if np.any(weights<=1e-8):raise ValueError('HQ overlap has an unfilled span')
        # The host subtracts estimated vocals; HQ5 itself predicts Instrumental.
        vocals=np.ascontiguousarray(self.mix[:,slots]-self.estimated[:,slots]/weights[None],dtype=np.float32)
        if not np.isfinite(vocals).all():raise ValueError('Non-finite finalized HQ audio')
        self.estimated[:,slots]=0;self.weight[slots]=0;self.emitted=final
        return {'start_frame':start,'vocals':vocals}
