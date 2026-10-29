"""DXGI adapter enumeration; indices match the DirectML execution provider."""
import ctypes as c
import uuid

def choose_adapter(adapters):
    hardware=[adapter for adapter in adapters if not adapter['software']]
    if not hardware: raise ValueError('No hardware GPU is available for live vocal removal')
    return max(hardware,key=lambda adapter:adapter['memory'])

def enumerate_adapters():
    class LUID(c.Structure):
        _fields_=[('low',c.c_uint32),('high',c.c_int32)]
    class Description(c.Structure):
        _fields_=[('name',c.c_wchar*128),('vendor',c.c_uint32),('device',c.c_uint32),
                  ('subsystem',c.c_uint32),('revision',c.c_uint32),('dedicated',c.c_size_t),
                  ('system',c.c_size_t),('shared',c.c_size_t),('luid',LUID),('flags',c.c_uint32)]
    def method(pointer,index,result,*arguments):
        table=c.cast(pointer,c.POINTER(c.POINTER(c.c_void_p))).contents
        return c.WINFUNCTYPE(result,c.c_void_p,*arguments)(table[index])
    iid=(c.c_ubyte*16).from_buffer_copy(uuid.UUID('770aae78-f26f-4dba-a829-253c83d1b387').bytes_le)
    library=c.WinDLL('dxgi.dll')
    create=library.CreateDXGIFactory1
    create.argtypes=[c.c_void_p,c.POINTER(c.c_void_p)];create.restype=c.c_long
    factory=c.c_void_p()
    if create(c.byref(iid),c.byref(factory))!=0:raise ValueError('Cannot enumerate DirectX graphics adapters')
    result=[]
    try:
        enumerate_one=method(factory,12,c.c_long,c.c_uint32,c.POINTER(c.c_void_p))
        for index in range(32):
            adapter=c.c_void_p()
            status=enumerate_one(factory,index,c.byref(adapter))
            if status&0xffffffff==0x887A0002:break
            if status!=0:raise ValueError('DirectX graphics adapter enumeration failed')
            try:
                description=Description()
                if method(adapter,10,c.c_long,c.POINTER(Description))(adapter,c.byref(description))!=0:
                    raise ValueError('Cannot read graphics adapter details')
                result.append({'index':index,'name':description.name,'memory':description.dedicated,'software':bool(description.flags&2)})
            finally:method(adapter,2,c.c_ulong)(adapter)
    finally:method(factory,2,c.c_ulong)(factory)
    return result
