"""Local, bounded JSON/PCM worker. Standard input/output only; never uploads audio."""
import argparse
import hashlib
import json
from pathlib import Path
import queue
import sys
import threading
import time

def model_profile(model_id):
    profiles=json.loads(Path(__file__).with_name('models.json').read_text(encoding='utf-8'))
    if type(model_id) is not str or model_id not in profiles:raise ValueError('Unknown vocal model profile')
    return profiles[model_id]
write_lock=threading.Lock()

def emit(value):
    with write_lock: print(json.dumps(value,ensure_ascii=False,separators=(',',':')),flush=True)

def load_model(path,model_id='fast'):
    profile=model_profile(model_id)
    model=Path(path)
    if not model.is_file() or model.stat().st_size!=profile['bytes'] or hashlib.sha256(model.read_bytes()).hexdigest()!=profile['sha256']:
        raise ValueError('Vocal model integrity check failed')
    import numpy as np
    import onnxruntime as ort
    from hardware import enumerate_adapters,choose_adapter
    if 'DmlExecutionProvider' not in ort.get_available_providers():raise ValueError('DirectML GPU runtime is unavailable')
    adapter=choose_adapter(enumerate_adapters())
    options=ort.SessionOptions();options.enable_mem_pattern=False
    options.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL
    options.add_free_dimension_override_by_name('batch_size',1)
    session=ort.InferenceSession(str(model),sess_options=options,providers=[('DmlExecutionProvider',{'device_id':str(adapter['index'])})])
    session.disable_fallback()
    if session.get_providers()[0]!='DmlExecutionProvider':raise ValueError('GPU execution was not selected')
    if len(session.get_inputs())!=1 or len(session.get_outputs())!=1:raise ValueError('Unsupported model interface')
    for entry in [session.get_inputs()[0],session.get_outputs()[0]]:
        if entry.type!='tensor(float)' or entry.shape!=[1,4,profile['bins'],profile['frames']]:raise ValueError('Vocal model tensor shape mismatch')
    name=session.get_inputs()[0].name
    predict=lambda spectrum:session.run(None,{name:spectrum})[0]
    silence=np.zeros((1,4,profile['bins'],profile['frames']),dtype=np.float32)
    predict(silence) # Compile/warm before reporting readiness.
    started=time.perf_counter();predict(silence);one=time.perf_counter()-started
    started=time.perf_counter();predict(silence);predict(-silence);two=time.perf_counter()-started
    if one*1000>profile['maxOnePassMs'] or (profile['requiresDenoise'] and two*1000>profile['maxTwoPassMs']):raise ValueError('GPU is too slow for the selected live model deadline')
    return predict,profile['requiresDenoise'] or two<.9,{'modelId':model_id,'name':adapter['name'],'provider':'DirectML','onePassMs':round(one*1000),'twoPassMs':round(two*1000),'modelSha256':profile['sha256']}

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    parser=argparse.ArgumentParser();parser.add_argument('--model',required=True);parser.add_argument('--model-id',default='fast')
    arguments=parser.parse_args()
    predict,denoise,details=load_model(arguments.model,arguments.model_id)
    from separator import RollingSeparator
    from protocol import decode_pcm,encode_vocals,valid_epoch
    separator=RollingSeparator(predict,denoise=denoise)
    jobs=queue.Queue(maxsize=2)
    state={'epoch':0,'alive':True}
    lock=threading.Lock()

    def clear_jobs():
        while True:
            try:jobs.get_nowait()
            except queue.Empty:break

    def read_packets():
        try:
            while True:
                line=sys.stdin.buffer.readline(1024*1024+1)
                if not line:break
                if len(line)>1024*1024 or not line.endswith(b'\n'):raise ValueError('Audio packet exceeds its size limit')
                message=json.loads(line)
                if not isinstance(message,dict) or not valid_epoch(message.get('epoch')):raise ValueError('Invalid worker epoch')
                epoch=message['epoch']
                if message.get('modelId','fast')!=arguments.model_id:raise ValueError('Audio model identity mismatch')
                with lock:
                    if epoch<state['epoch']:continue
                    if epoch!=state['epoch'] or message.get('type')=='reset':
                        state['epoch']=epoch;clear_jobs()
                if message.get('type')=='reset':continue
                pcm=decode_pcm(message)
                try:jobs.put_nowait((epoch,message['sequence'],pcm))
                except queue.Full:
                    with lock:clear_jobs()
                    emit({'type':'error','modelId':arguments.model_id,'epoch':epoch,'error':'AI cannot keep up with playback; its input queue is full'})
        except Exception as error:
            emit({'type':'fatal','error':str(error)})
        finally:
            with lock:state['alive']=False

    emit({'type':'ready','denoise':denoise,**details})
    threading.Thread(target=read_packets,daemon=True).start()
    current_epoch=0;sequence=0
    while True:
        try:epoch,index,pcm=jobs.get(timeout=.1)
        except queue.Empty:
            with lock:
                if not state['alive']:break
            continue
        with lock:
            if epoch!=state['epoch']:continue
        if epoch!=current_epoch:
            separator.reset();current_epoch=epoch;sequence=0
        try:
            if index!=sequence:raise ValueError('Audio sequence has a gap; restart live processing')
            sequence+=1
            started=time.perf_counter();result=separator.push(pcm);elapsed=time.perf_counter()-started
            with lock:
                if epoch!=state['epoch']:continue
            packet={'type':'result','modelId':arguments.model_id,'epoch':epoch,'sequence':index,'computeMs':round(elapsed*1000),'frames':0}
            if result:
                packet.update(startFrame=result['start_frame'],frames=result['vocals'].shape[1],pcm=encode_vocals(result))
            emit(packet)
        except Exception as error:emit({'type':'error','modelId':arguments.model_id,'epoch':epoch,'error':str(error)})
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:
        emit({'type':'fatal','error':str(error)});sys.exit(1)
