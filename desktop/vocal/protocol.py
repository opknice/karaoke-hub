import base64
import binascii
import numpy as np

def valid_epoch(value):
    return type(value) is int and 0<value<2**31

def decode_pcm(message):
    if not isinstance(message,dict) or message.get('type')!='pcm' or not valid_epoch(message.get('epoch')):
        raise ValueError('Invalid audio packet')
    sequence=message.get('sequence')
    if type(sequence) is not int or not 0<=sequence<2**31 or message.get('sampleRate')!=44100:
        raise ValueError('Invalid audio sequence or rate')
    encoded=message.get('pcm')
    if not isinstance(encoded,str) or len(encoded)!=470400:raise ValueError('Invalid audio packet length')
    try: raw=base64.b64decode(encoded,validate=True)
    except (ValueError,binascii.Error) as error:raise ValueError('Invalid audio encoding') from error
    if len(raw)!=44100*2*4:raise ValueError('Invalid stereo audio size')
    pcm=np.frombuffer(raw,dtype='<f4').reshape(44100,2).T
    if not np.isfinite(pcm).all():raise ValueError('Non-finite source audio')
    return np.ascontiguousarray(pcm,dtype=np.float32)

def encode_vocals(result):
    return base64.b64encode(result['vocals'].T.astype('<f4',copy=False).tobytes()).decode('ascii')
