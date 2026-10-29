"""Bounded classic UVR MDX streaming DSP. No file/network I/O in this module."""
import numpy as np
from scipy.fft import rfft, irfft

RATE=44100
STEP=RATE
FFT=7680
BINS=3072
WINDOW=1024*255
OVERLAP=5512

class STFT:
    def __init__(self):
        self.window=np.hanning(FFT+1)[:-1].astype(np.float32)

    def forward(self,wave):
        padded=np.pad(wave,((0,0),(FFT//2,FFT//2)),mode='reflect')
        frames=np.lib.stride_tricks.sliding_window_view(padded,FFT,axis=-1)[:,::1024]
        spectrum=rfft(frames*self.window,axis=-1).transpose(0,2,1)
        packed=np.stack((spectrum.real,spectrum.imag),axis=1).reshape(1,4,spectrum.shape[1],spectrum.shape[2])
        return np.ascontiguousarray(packed[:,:,:BINS],dtype=np.float32)

    def inverse(self,packed):
        count=packed.shape[-1]
        full=np.zeros((2,2,FFT//2+1,count),dtype=np.float32)
        full[:,:,:BINS]=packed.reshape(2,2,BINS,count)
        waves=irfft((full[:,0]+1j*full[:,1]).transpose(0,2,1),n=FFT,axis=-1)*self.window
        length=1024*(count-1)+FFT
        result=np.zeros((2,length),dtype=np.float32)
        weight=np.zeros(length,dtype=np.float32)
        for frame in range(count):
            start=frame*1024
            result[:,start:start+FFT]+=waves[:,frame]
            weight[start:start+FFT]+=self.window**2
        np.divide(result,weight[None],out=result,where=weight[None]>1e-10)
        return result[:,FFT//2:-FFT//2]

class RollingSeparator:
    def __init__(self,predict,compensation=1.043,denoise=True):
        self.predict=predict
        self.compensation=float(compensation)
        self.denoise=denoise
        self.transform=STFT()
        self.reset()

    def reset(self):
        self.history=np.zeros((2,WINDOW),dtype=np.float32)
        self.total_frames=0

    def push(self,pcm):
        if pcm.shape!=(2,STEP) or pcm.dtype!=np.float32 or not np.isfinite(pcm).all():
            raise ValueError('Expected one second of finite stereo float32 PCM at 44100 Hz')
        self.history[:,:-STEP]=self.history[:,STEP:]
        self.history[:,-STEP:]=pcm
        self.total_frames+=STEP
        if self.total_frames<3*RATE: return None
        spectrum=self.transform.forward(self.history)
        spectrum[:,:,:3]=0
        estimate=self.predict(spectrum)
        if self.denoise: estimate=(estimate-self.predict(-spectrum))*.5
        if estimate.shape!=spectrum.shape or not np.isfinite(estimate).all():
            raise ValueError('Model returned invalid or non-finite vocals')
        wave=self.transform.inverse(estimate)*self.compensation
        target=self.total_frames-3*RATE
        start=max(0,target-OVERLAP)
        end=target+STEP+OVERLAP
        history_start=self.total_frames-WINDOW
        offset=start-history_start
        vocals=np.ascontiguousarray(wave[:,offset:offset+end-start],dtype=np.float32)
        if vocals.shape!=(2,end-start): raise ValueError('Invalid central output range')
        return {'start_frame':start,'vocals':vocals}
