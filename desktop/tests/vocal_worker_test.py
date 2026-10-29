import importlib.util
from pathlib import Path
import unittest
import base64
import json
import subprocess
import sys
import tempfile
import numpy as np

MODULE = Path(__file__).resolve().parents[1] / 'vocal' / 'separator.py'

class RollingSeparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('vocal_separator',MODULE)
        cls.module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def tone(self,second):
        t=(np.arange(44100)+second*44100)/44100
        return np.stack([.1*np.sin(2*np.pi*440*t),.15*np.sin(2*np.pi*660*t)]).astype('float32')

    def test_center_segments_keep_source_time_and_stereo_channels(self):
        separator=self.module.RollingSeparator(lambda spectrum:spectrum,compensation=1)
        self.assertIsNone(separator.push(self.tone(0)))
        self.assertIsNone(separator.push(self.tone(1)))
        first=separator.push(self.tone(2))
        self.assertEqual(first['start_frame'],0)
        self.assertEqual(first['vocals'].shape,(2,49612))
        # Ignore the abrupt mixture onset; compare independently generated PCM.
        np.testing.assert_allclose(first['vocals'][:,4410:44100],self.tone(0)[:,4410:],atol=1e-4)
        second=separator.push(self.tone(3))
        self.assertEqual(second['start_frame'],38588)
        np.testing.assert_allclose(first['vocals'][:,38588:],second['vocals'][:,:11024],atol=1e-4)

    def test_zero_vocal_prediction_and_reset_do_not_leak_previous_track(self):
        separator=self.module.RollingSeparator(np.zeros_like,compensation=1)
        for index in range(3): result=separator.push(self.tone(index))
        self.assertTrue(np.all(result['vocals']==0))
        separator.reset()
        self.assertIsNone(separator.push(self.tone(0)))
        self.assertEqual(separator.total_frames,44100)

    def test_invalid_pcm_or_model_output_never_enters_the_stream(self):
        separator=self.module.RollingSeparator(lambda value:value,compensation=1)
        with self.assertRaises(ValueError): separator.push(np.zeros((1,44100),dtype=np.float32))
        with self.assertRaises(ValueError): separator.push(np.full((2,44100),np.nan,dtype=np.float32))
        bad=self.module.RollingSeparator(lambda value:np.full_like(value,np.nan),compensation=1)
        bad.push(self.tone(0));bad.push(self.tone(1))
        with self.assertRaises(ValueError): bad.push(self.tone(2))

    def test_sign_denoise_cancels_model_bias(self):
        separator=self.module.RollingSeparator(lambda value:value+.125,compensation=1,denoise=True)
        for index in range(3): result=separator.push(self.tone(index))
        np.testing.assert_allclose(result['vocals'][:,4410:44100],self.tone(0)[:,4410:],atol=1e-4)

    def test_hardware_selection_prefers_dedicated_gpu_and_rejects_software(self):
        spec=importlib.util.spec_from_file_location('vocal_hardware',MODULE.with_name('hardware.py'))
        hardware=importlib.util.module_from_spec(spec);spec.loader.exec_module(hardware)
        adapters=[{'index':0,'name':'Integrated','memory':128*2**20,'software':False},
                  {'index':1,'name':'Dedicated','memory':4*2**30,'software':False},
                  {'index':2,'name':'Software','memory':8*2**30,'software':True}]
        self.assertEqual(hardware.choose_adapter(adapters)['index'],1)
        with self.assertRaises(ValueError):hardware.choose_adapter([adapters[2]])

    def test_protocol_rejects_wrong_rate_sizes_and_nonfinite_pcm(self):
        spec=importlib.util.spec_from_file_location('vocal_protocol',MODULE.with_name('protocol.py'))
        protocol=importlib.util.module_from_spec(spec);spec.loader.exec_module(protocol)
        wave=self.tone(0)
        message={'type':'pcm','epoch':1,'sequence':0,'sampleRate':44100,'pcm':base64.b64encode(wave.T.copy().tobytes()).decode('ascii')}
        decoded=protocol.decode_pcm(message)
        np.testing.assert_array_equal(decoded,wave)
        for bad in [{**message,'sampleRate':48000},{**message,'epoch':True},{**message,'pcm':'AA=='},{**message,'pcm':'not base64'}]:
            with self.assertRaises(ValueError):protocol.decode_pcm(bad)
        message['pcm']=base64.b64encode(np.full((44100,2),np.nan,dtype=np.float32).tobytes()).decode('ascii')
        with self.assertRaises(ValueError):protocol.decode_pcm(message)

    def test_worker_rejects_unverified_weights_before_starting_runtime(self):
        with tempfile.TemporaryDirectory() as folder:
            model=Path(folder)/'invalid.onnx';model.write_bytes(b'not the verified model')
            result=subprocess.run([sys.executable,str(MODULE.with_name('worker.py')),'--model',str(model)],capture_output=True,text=True,timeout=10)
            self.assertNotEqual(result.returncode,0)
            error=json.loads(result.stdout.strip())
            self.assertEqual(error['type'],'fatal')
            self.assertIn('integrity',error['error'])

if __name__=='__main__': unittest.main()
