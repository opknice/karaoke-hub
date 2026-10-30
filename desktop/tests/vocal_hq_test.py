import importlib.util
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[1]/'vocal'
sys.path.insert(0,str(ROOT))

class HQStreamingTests(unittest.TestCase):
    def load_separator(self,predict,**settings):
        try:from hq_separator import HQSeparator
        except ModuleNotFoundError:self.fail('HQ streaming separator has not been implemented')
        return HQSeparator(predict,**settings)
    def tone(self,start,count=44100):
        t=(np.arange(count)+start)/44100
        envelope=.08+.025*np.sin(t*.7)
        return np.stack([envelope*np.sin(2*np.pi*440*t),1.3*envelope*np.sin(2*np.pi*660*t)]).astype(np.float32)
    def test_primary_instrumental_becomes_correct_residual_with_compensation_and_sign_denoise(self):
        calls=[]
        def predict(spectrum):calls.append(spectrum.shape);return spectrum*.25+.03
        separator=self.load_separator(predict)
        output=None
        for second in range(6):output=separator.push(self.tone(second*44100))
        self.assertEqual(output['start_frame'],0);self.assertEqual(output['vocals'].shape,(2,65280))
        reference=self.tone(0,65280)*.7475
        np.testing.assert_allclose(output['vocals'][:,4410:],reference[:,4410:],atol=2e-4)
        self.assertTrue(all(shape==(1,4,2560,256) for shape in calls));self.assertEqual(len(calls),6)
    def test_streaming_finalized_spans_match_full_window_overlap_reference(self):
        from separator import STFT
        import inspect
        self.assertIn('n_fft',inspect.signature(STFT).parameters,'STFT must support the verified HQ model FFT')
        transform=STFT(n_fft=5120,bins=2560)
        predict=lambda spectrum:spectrum*(.15+float(np.abs(spectrum).mean())*.1)
        separator=self.load_separator(predict);source=np.concatenate([self.tone(index*44100) for index in range(15)],axis=1)
        pieces=[];end=0
        for index in range(15):
            output=separator.push(source[:,index*44100:(index+1)*44100])
            if output:
                self.assertEqual(output['start_frame'],end);end+=output['vocals'].shape[1];pieces.append(output['vocals'])
        blend=np.hanning(261120).astype(np.float32);result=np.zeros_like(source);weights=np.zeros(source.shape[1],np.float32)
        for start in range(-130560,source.shape[1]-261120+1,65280):
            positions=np.arange(start,start+261120);chunk=source[:,np.abs(positions)]
            spectrum=transform.forward(chunk);spectrum[:,:,:3]=0;estimated=transform.inverse(predict(spectrum))*1.01
            left=max(0,start);offset=left-start;right=start+261120
            result[:,left:right]+=estimated[:,offset:]*blend[offset:];weights[left:right]+=blend[offset:]
        expected=source[:,:end]-result[:,:end]/weights[None,:end]
        np.testing.assert_allclose(np.concatenate(pieces,axis=1),expected,atol=2e-6)
    def test_storage_stays_bounded_after_ring_wrap_and_reset_clears_old_music(self):
        separator=self.load_separator(lambda spectrum:spectrum*.25)
        allocated=lambda:sum(value.nbytes for value in vars(separator).values() if isinstance(value,np.ndarray))
        before=allocated();end=0
        for second in range(90):
            output=separator.push(self.tone(second*44100))
            if output:
                self.assertEqual(output['start_frame'],end);self.assertLessEqual(output['vocals'].shape[1],65280)
                end+=output['vocals'].shape[1]
                if second>12:np.testing.assert_allclose(output['vocals'],self.tone(output['start_frame'],output['vocals'].shape[1])*.7475,atol=2e-4)
        self.assertGreater(end,44100*80);self.assertEqual(allocated(),before)
        separator.reset();self.assertEqual(separator.total_frames,0)
        for _ in range(6):output=separator.push(np.zeros((2,44100),np.float32))
        self.assertTrue(np.all(output['vocals']==0))
    def test_invalid_input_prediction_and_reduced_quality_mode_are_rejected(self):
        with self.assertRaises(ValueError):self.load_separator(lambda value:value,denoise=False)
        separator=self.load_separator(lambda value:np.full_like(value,np.nan))
        for invalid in [np.zeros((1,44100),np.float32),np.zeros((2,44100),np.float64),np.full((2,44100),np.inf,np.float32)]:
            with self.assertRaises(ValueError):separator.push(invalid)
        separator.push(self.tone(0));separator.push(self.tone(44100))
        with self.assertRaises(ValueError):separator.push(self.tone(88200))
if __name__=='__main__':unittest.main()
