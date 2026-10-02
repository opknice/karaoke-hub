# แผนพัฒนาระบบ AI ตัดเสียงร้องสำหรับ KARAOKE.HUB

สถานะเอกสาร: แผนงานฉบับปรับปรุง — **Local-only Stem Mixer**

สถาปัตยกรรมหลักของเอกสารฉบับนี้กำหนดชัดเจนว่า:

> **TV / Player Machine = Local AI Worker + Local Stem Cache + Audio Player**
>
> **Supabase = Control Plane / Room State เท่านั้น และไม่เก็บไฟล์เสียงหรือ AI stems**

เป้าหมายคือให้ฟีเจอร์ AI Karaoke ไม่มีค่า AI/GPU cloud เพิ่ม, ไม่ใช้ Supabase Storage สำหรับเสียง และยังคงให้สมาชิกในห้องควบคุม Queue, Pause/Play, End และ Vocal ON/OFF ผ่านระบบห้องเดิมได้

## 1. เป้าหมาย

เพิ่มโหมด `AI Karaoke` สำหรับเพลงที่ระบุว่าเป็น Karaoke แต่ยังมีเสียงนักร้องติดอยู่ โดยระบบต้อง:

- แยกไฟล์เสียงที่ผู้ใช้มีสิทธิ์ใช้งานออกเป็นอย่างน้อย 2 stems: `instrumental` และ `vocals`
- ให้ **TV/Player Machine เป็นเครื่องที่ประมวลผล AI, เก็บ stems และเล่นเสียงจริง**
- เมื่อ stems พร้อมแล้ว ให้ผู้ใช้กด `*` เพื่อเปิด/ปิดเสียงนักร้องได้ทันที โดย **ไม่รัน AI ใหม่ตอนกดปุ่ม**
- ใช้ Web Audio mixer ใน Player เพื่อควบคุมระดับเสียงของ vocal stem
- ใช้ fade สั้นประมาณ 30–100 ms ตอนเปิด/ปิด vocal เพื่อลด click/pop
- ใช้ CPU/GPU ของ Player Machine เป็นหลัก เพื่อไม่เสียค่า GPU/CPU บนคลาวด์
- เก็บ AI models, temporary audio และ output stems ไว้บน Player Machine เท่านั้น
- ใช้ Local Stem Cache เพื่อลดการประมวลผลซ้ำ
- **ไม่อัปโหลด instrumental, vocals, source audio หรือ temporary WAV ไป Supabase Storage**
- ให้ Supabase เก็บเฉพาะสถานะห้อง/คำสั่งควบคุมที่มีขนาดเล็ก
- เล่นเสียงให้ตรงกับวิดีโอ/เนื้อเพลงเดิม
- มี Original เป็น fallback เสมอ หากยังไม่มี stems, cache ใช้ไม่ได้ หรือการประมวลผลล้มเหลว
- ทำงานร่วมกับระบบห้อง, Queue, Pause/Play และ End ที่มีอยู่แล้ว

แนวคิดหลัก:

```text
AI separation = ทำบน TV/Player Machine ครั้งเดียว
                    |
                    v
          Instrumental + Vocals
                    |
                    v
             Local Stem Cache
                    |
                    v
             Web Audio Mixer
                    |
          * = Vocal ON / OFF
```

ดังนั้นคำว่า "realtime" ในระบบนี้หมายถึง **การเปิด/ปิด vocal stem แบบ realtime หลัง separation เสร็จแล้ว** ไม่ใช่ true live AI separation ทุกเฟรมขณะเพลงกำลังเล่น

## 2. ขอบเขตและข้อจำกัด

### อยู่ในขอบเขต

- แยกเสียงร้องจากไฟล์ที่ผู้ใช้เลือกและมีสิทธิ์ใช้งาน
- สร้าง 2 outputs ต่อ local asset: `instrumental` และ `vocals`
- เก็บ AI output และ manifest ใน Local Stem Cache ของ Player Machine
- เล่นวิดีโอเดิมแบบปิดเสียง พร้อมเล่น stems ผ่าน audio engine ของ Player Machine
- ใช้ `instrumental` เป็นเสียงหลัก และเปิด/ปิด `vocals` ด้วย mixer
- รองรับปุ่ม `*` / `NumpadMultiply` สำหรับ Vocal ON/OFF
- รองรับปุ่ม Vocal บนมือถือ/แท็บเล็ตผ่าน room control
- รองรับ Local Worker บน Windows เป็นรุ่นแรก
- รองรับ local cache บน Player Machine และ optional browser cache เฉพาะเครื่อง Player
- รองรับการ sync stems กับ YouTube video และ room playback state
- ใช้ Supabase Realtime/Database เฉพาะ control/state ตามความจำเป็น

### ไม่อยู่ในขอบเขตรุ่นแรก

- ไม่ทำการดาวน์โหลดเสียงจาก YouTube ของผู้อื่นโดยอัตโนมัติ
- ไม่รับประกันการลบเสียงร้องได้สมบูรณ์ทุกเพลง
- ไม่ทำ true live AI source separation แบบ latency ต่ำขณะรับ audio stream
- ไม่ประมวลผลโมเดล AI ใน Vercel Function
- **ไม่ใช้ Supabase Storage สำหรับ audio/stems**
- **ไม่มี Supabase Shared Audio Cache**
- ไม่ส่ง source audio หรือ AI stems ผ่าน Vercel Function
- ไม่เก็บ drums/bass/guitar/piano แยก เว้นแต่มี feature ใหม่ที่ต้องใช้จริง
- ไม่บังคับให้มือถือหรือสมาชิกทุกเครื่องดาวน์โหลด stems
- ไม่รับประกันว่า TV/Player Machine เครื่องใหม่จะมี AI cache ของเพลงเดิม ถ้ายังไม่เคยประมวลผลบนเครื่องนั้น

YouTube ระบุช่องทางดาวน์โหลดไฟล์สำหรับวิดีโอที่ผู้ใช้เป็นเจ้าของ และไฟล์ offline ของ Premium ไม่ใช่ไฟล์เสียงทั่วไปสำหรับนำไปประมวลผล ดังนั้น input ของระบบควรเป็นไฟล์ local/ไฟล์ที่ผู้ใช้มีสิทธิ์ หรือแหล่งที่ได้รับอนุญาตเท่านั้น:

- [YouTube Help: Download videos that you've uploaded](https://support.google.com/youtube/answer/56100?hl=en)

## 3. สถาปัตยกรรมที่แนะนำ

ใช้สถาปัตยกรรม **TV/Player-centric Local AI + Local Stem Cache**:

```text
                          SUPABASE
                  (Room / Control State)
                          |
             +------------+------------+
             |                         |
             v                         v
         Mobile/Web               TV / Player Machine
       Queue / Control                    |
       Vocal ON/OFF                       |
             |                            |
             +-------- Realtime ----------+
                                          |
                                          v
                                Local Cache Lookup
                                  /             \
                              HIT                 MISS
                               |                   |
                               |                   v
                               |          Local AI Worker
                               |                   |
                               |          Vocal Separation
                               |                   |
                               |          +--------+--------+
                               |          |                 |
                               |          v                 v
                               |   instrumental          vocals
                               |          |                 |
                               |          +--------+--------+
                               |                   |
                               +-------------------+
                                                   |
                                                   v
                                          Local Stem Cache
                                                   |
                                                   v
                                          Web Audio Mixer
                                                   |
                                      +------------+------------+
                                      |                         |
                                      v                         v
                                Music Gain 1.0            Vocal Gain 0/1
                                                                ^
                                                                |
                                                             ปุ่ม `*`
```

### หน้าที่ของแต่ละส่วน

**TV/Player Machine**

- เป็นเครื่องเสียงหลักของห้อง
- รัน Local AI Worker
- เก็บ AI model weights
- เก็บ source ที่ผู้ใช้เลือกตาม lifecycle ที่กำหนด
- เก็บ `instrumental` + `vocals` ใน Local Stem Cache
- เล่น stems และทำ Web Audio mixing
- sync ภาพ YouTube กับ master audio
- รับคำสั่งจาก Supabase Realtime

**มือถือ/อุปกรณ์สมาชิก**

- จัด Queue
- Pause/Play/End
- กด Vocal ON/OFF
- ไม่ต้องมี AI model
- ไม่ต้องดาวน์โหลด stems
- ไม่ต้องเล่น audio ของตัวเองใน architecture หลัก

**Supabase**

- เก็บ room state
- เก็บ queue/control state ตามระบบเดิม
- กระจาย Realtime events
- อาจเก็บสถานะ local processing แบบ metadata ขนาดเล็กถ้าจำเป็น
- **ไม่เก็บไฟล์ source audio**
- **ไม่เก็บ instrumental/vocals**
- **ไม่สร้าง signed audio upload/read URLs**

**Vercel**

- ใช้สำหรับ web app/API control ตามระบบเดิม
- ไม่รับไฟล์เสียงขนาดใหญ่
- ไม่รัน AI separation
- ไม่เป็น audio proxy

### หลักการ playback

ใน `AI Karaoke` mode:

```text
YouTube iframe = ภาพ/เนื้อเพลง + mute ตลอด
Instrumental   = master audio จาก Local Stem Cache
Vocals         = follower stem จาก Local Stem Cache
Web Audio      = mixer/output บน Player Machine
```

เหตุผลที่ใช้ stems แยกแทนการสลับ `YouTube Original <-> AI Instrumental` คือ:

- ไม่ต้องเปลี่ยน audio source ตอนกด `*`
- ลดปัญหา volume กระโดด
- ลดความต่างของ codec/network delay ระหว่าง YouTube กับไฟล์ AI
- สามารถ fade vocal ได้อย่างนุ่มนวล
- สามารถเพิ่ม Guide Vocal ภายหลังได้ง่าย

### ทำไมไม่ประมวลผลบน Vercel หรือ Supabase

งาน source separation ใช้ CPU/GPU, RAM และเวลาประมวลผลมากกว่างาน API ปกติ จึงให้ Player Machine รับภาระนี้ทั้งหมด

Vercel/Supabase ทำหน้าที่เฉพาะ control plane เช่น:

- room/queue state
- playback state
- vocal state
- pairing/authorization metadata
- processing status แบบข้อความสั้น หากต้องการแสดงบนอุปกรณ์อื่น

ไม่มีขั้นตอนใดที่ต้องอัปโหลด stems ขึ้น cloud

## 4. รูปแบบการเล่นเสียงและ Stem Mixer

ปัจจุบันระบบใช้ YouTube Player เป็นตัวเล่นหลัก ในโหมด AI ให้แยกภาพออกจากเสียง

### Original mode

```text
YouTube iframe: เปิดเสียง + แสดงวิดีโอ/เนื้อเพลง
Stem Mixer: ไม่ใช้
```

ใช้เป็น fallback เมื่อ:

- ยังไม่มี local stems
- Local Worker กำลังประมวลผล
- Local cache ใช้ไม่ได้
- stems เสียหรือโหลดไม่สำเร็จ
- browser/player engine ไม่พร้อม
- ผู้ใช้เลือกกลับ Original เอง

### AI Karaoke mode

```text
YouTube iframe: mute + แสดงวิดีโอ/เนื้อเพลง

Local instrumental ----> Music Gain = 1.0 ----+
                                                 +----> Audio Output
Local vocals ----------> Vocal Gain = 0..1 ----+
                                 ^
                                 |
                            ปุ่ม `*`
```

ค่าเริ่มต้นใน Karaoke mode:

```text
Music Gain = 1.0
Vocal Gain = 0.0
```

เมื่อกด `*`:

```text
ถ้า Vocal OFF -> fade 0.0 -> 1.0
ถ้า Vocal ON  -> fade 1.0 -> 0.0
```

ใช้ fade ระยะสั้นประมาณ 30–100 ms เพื่อหลีกเลี่ยง click/pop และยังให้ความรู้สึกว่าตอบสนองทันที

### Keyboard control

รองรับทั้ง:

- `event.key === "*"`
- `event.code === "NumpadMultiply"`

ก่อนจับ shortcut ต้องตรวจว่า focus ไม่อยู่ใน `input`, `textarea`, `select` หรือ element ที่กำลังพิมพ์ข้อความ เพื่อไม่ให้ปุ่ม `*` รบกวนการใช้งานปกติ

ควรมีปุ่มบน UI ด้วยเสมอ เช่น:

```text
[VOCAL OFF]   หรือ   [VOCAL ON]
```

### สถานะเสียงที่ควรมี

รุ่นแรกใช้:

- `original`
- `ai_karaoke`

ภายใน `ai_karaoke` มี state เพิ่ม:

- `vocal_enabled: boolean`
- `vocal_gain: 0..1` — optional สำหรับ Guide Vocal ในอนาคต

ไม่จำเป็นต้องเพิ่ม playback mode แยกสำหรับ vocal ON/OFF เพราะเป็น mixer state ของ AI mode เดียวกัน

### Local asset identity

Supabase ไม่ต้องมี `playback_asset_id` ที่ชี้ไปไฟล์ cloud

ให้ Player Machine ใช้ logical cache key เช่น:

```text
source_fingerprint + model_name + model_version + preset + output_codec
```

ใน room state สามารถเก็บเฉพาะข้อมูลอ้างอิงเชิงตรรกะที่จำเป็น เช่น:

- `playback_mode`
- `playback_source_key` หรือ stable source identifier ที่ระบบเดิมมีอยู่แล้ว
- `playback_position_ms`
- `playback_updated_at`
- `playback_is_playing`
- `vocal_enabled`
- `vocal_gain` ถ้าจำเป็น

เมื่อ TV ได้ room state ให้ TV เป็นผู้ตัดสินใจเองว่า local cache มี asset ที่ตรงกับ source/model/preset หรือไม่

### Guide Vocal ในอนาคต

```text
Karaoke      Music 100% / Vocal   0%
Guide Vocal  Music 100% / Vocal  20%
Practice     Music 100% / Vocal  40%
Full Vocal   Music 100% / Vocal 100%
Vocal Only   Music   0% / Vocal 100%
```

รุ่นแรกยังใช้แค่ Vocal ON/OFF เพื่อให้ UX และ state management ง่ายก่อน

### แหล่งความจริงของ playback

Supabase เป็นแหล่งความจริงของ **room control state** แต่ **Player Machine เป็นแหล่งความจริงของ local audio availability**

กล่าวคือ:

```text
Supabase รู้ว่า: ควรเล่นเพลงอะไร / ตำแหน่งไหน / vocal on หรือ off
Player รู้ว่า: มี local stems จริงหรือไม่ / path อยู่ที่ไหน / พร้อมเล่นหรือไม่
```

ถ้า room ขอ `ai_karaoke` แต่ Player ไม่มี stems:

1. ตรวจ Local Stem Cache
2. ถ้าไม่พบ ให้เริ่ม local processing เมื่อมี authorized source พร้อม
3. ระหว่างรอ ใช้ Original fallback
4. เมื่อ stems พร้อม จึงเปลี่ยนเข้า AI mode ตาม UX ที่กำหนด

### Master clock และการ sync stems

ใน AI mode ให้ `instrumental` เป็น master audio clock

ลำดับการเริ่มเล่น:

1. Player โหลด instrumental และ vocal metadata จาก local disk/cache
2. seek ทั้งคู่ไปตำแหน่งเดียวกัน
3. รอให้ทั้งสองพร้อมเล่น
4. เริ่ม stems โดยอ้างอิงเวลาเดียวกันให้ใกล้ที่สุด
5. mute YouTube และ seek video ให้ตรงกับ master audio
6. ระหว่างเล่น ให้ตรวจ drift เป็นระยะ

กฎ drift correction รุ่นแรก:

- ถ้า vocal ต่างจาก instrumental น้อยกว่า threshold เล็ก ๆ ให้ปล่อยไว้
- ถ้าต่างเกิน threshold ให้ seek vocal กลับมาตาม instrumental
- ถ้า YouTube video drift จาก master audio เกิน threshold ที่กำหนด ให้ seek video กลับมาตาม audio
- หลีกเลี่ยงการ seek ถี่เกินไป เพราะจะทำให้กระตุก

ควร encode instrumental และ vocal ด้วย codec/sample rate/container configuration เดียวกันเพื่อลดความต่างของ decoder delay

## 5. โมเดลและคุณภาพเสียง

### ลำดับที่ควรทดสอบ

1. Mel-Band RoFormer หรือ BS-RoFormer สำหรับคุณภาพเสียงหลัก
2. MDX23C/InstVoc HQ สำหรับเพลงที่โมเดลแรกทิ้งเสียงร้องไว้
3. VR/MDX karaoke model เป็น fallback สำหรับเพลงที่มีเสียงประสานหรือ reverb มาก
4. Ensemble เฉพาะเพลงที่แยกยาก ไม่ใช้กับทุกเพลงเพราะใช้เวลาและพื้นที่เพิ่ม

BS-RoFormer เป็นงานวิจัยด้าน Music Source Separation ที่รายงานผลดีมากใน benchmark ส่วน Mel-RoFormer มีรายงานผลดีด้านการแยก vocal โดยเฉพาะ:

- [BS-RoFormer research paper](https://arxiv.org/abs/2309.02612)
- [Ultimate Vocal Remover GUI](https://github.com/Anjok07/ultimatevocalremovergui)

UVR เหมาะเป็น engine รุ่นแรกเพราะรวม architecture และ model presets หลายแบบไว้แล้ว แต่ต้องตรวจ license ของ model weights ที่นำมาใช้แยกจาก license ของตัวโปรแกรม

### Output ที่โมเดลต้องให้

รุ่นแรกต้องได้อย่างน้อย:

```text
instrumental
vocals
```

ถ้าโมเดลให้ผลแบบ `vocals + no_vocals` อยู่แล้วให้ใช้โดยตรง

ถ้าโมเดลให้ 4 stems เช่น:

```text
vocals
bass
drums
other
```

ให้สร้าง:

```text
instrumental = bass + drums + other
vocals       = vocals
```

ก่อน encode เป็นไฟล์สำหรับ playback

### Preset ที่ควรมี

| Preset | เป้าหมาย | พฤติกรรม |
|---|---|---|
| `balanced` | เพลงทั่วไป | รักษาดนตรีและแยก vocal ระดับกลาง |
| `clean_karaoke` | ต้องการดนตรีสะอาด | ตัด vocal แรงขึ้น อาจเสียเสียงประสานบางส่วน |
| `preserve_backing` | เก็บ backing vocal ในดนตรีมากขึ้น | ลดการตัดเสียงร้องที่เบาหรือเสียงประสาน |
| `original` | fallback | ไม่ผ่าน AI |

ไม่มีโมเดลใดรับประกันว่าเสียงร้อง, reverb, backing vocal และเสียงดนตรีจะถูกแยกได้สมบูรณ์ทุกเพลง จึงต้องมี Original fallback และควรให้ผู้ใช้เลือก preset ได้

### เกณฑ์สำคัญเพิ่มจากระบบ 2-stem

ต้องตรวจทั้งสองไฟล์ว่า:

- duration ใกล้กันมาก
- sample rate และ channels เท่ากัน
- ไม่มี leading/trailing offset ที่ต่างกันอย่างมีนัยสำคัญ
- เมื่อผสม `instrumental + vocals` แล้ว timing ต้องตรงกับ source
- ไม่มี clipping รุนแรงเมื่อเปิด vocal 100%

## 6. Local Audio Worker

### รุ่นต้นแบบ

เริ่มจาก Python CLI/worker ก่อน เพื่อวัดคุณภาพและเวลาประมวลผลโดยยังไม่ต้องทำ installer:

```text
audio-worker/
  worker.py
  separator.py
  ffmpeg.py
  cache.py
  models/
  tests/
```

ความสามารถขั้นต่ำ:

- รับไฟล์ local ผ่าน command line หรือ drag-and-drop wrapper
- ตรวจ MIME, extension, duration และขนาดไฟล์
- แปลง input เป็น stereo 44.1 kHz ก่อนแยก
- เรียก UVR/โมเดลที่เลือก
- สร้าง `instrumental` และ `vocals`
- ตรวจ output ทั้งสองไฟล์ว่าระยะเวลาใกล้ input และใกล้กัน
- encode stems เป็น AAC/Opus/MP3 ด้วยค่าที่สอดคล้องกัน
- เขียนผลลง cache พร้อม manifest
- คำนวณ checksum ของแต่ละ stem
- รายงาน progress และ error code

### รูปแบบ manifest ที่เสนอ

```json
{
  "source_fingerprint": "...",
  "model_name": "...",
  "model_version": "...",
  "preset": "clean_karaoke",
  "duration_ms": 240000,
  "sample_rate": 44100,
  "channels": 2,
  "stems": {
    "instrumental": {
      "path": "instrumental.opus",
      "sha256": "...",
      "byte_size": 0
    },
    "vocals": {
      "path": "vocals.opus",
      "sha256": "...",
      "byte_size": 0
    }
  }
}
```

### รุ่นใช้งานจริงบน Windows

หลังคุณภาพผ่าน ให้ห่อ worker เป็น Tauri หรือ Electron พร้อม Python sidecar โดยให้ผู้ใช้:

1. เปิดโปรแกรม Worker
2. กด Pair กับห้องด้วยรหัสครั้งเดียวหรือ QR
3. เลือกไฟล์เพลง
4. เลือก preset
5. รอผลและเห็นสถานะในเว็บ
6. เมื่อ stems พร้อม เว็บสามารถใช้ปุ่ม `*` ได้ทันที

ไม่ควรเปิด HTTP listener บน `0.0.0.0` โดยค่าเริ่มต้น ควรใช้ `127.0.0.1` และ pairing token ที่หมดอายุ

### GPU/CPU

- NVIDIA GPU: ใช้ CUDA หากพร้อม จะเหมาะกับการประมวลผลหลายเพลง
- เครื่องไม่มี GPU: ใช้ CPU fallback และแสดงสถานะ progress ที่ชัดเจน
- ห้ามถือว่าเครื่องทุกเครื่องมี GPU หรือมีพื้นที่ disk เพียงพอ
- ควรตรวจสอบ free disk ก่อนดาวน์โหลด model และก่อนสร้าง output
- การกด `*` หลัง stems พร้อมแล้วไม่ต้องใช้ GPU

## 7. รูปแบบไฟล์และพื้นที่

นโยบายหลักคือ **เก็บไฟล์เสียงทั้งหมดไว้บน Player Machine เท่านั้น**

ต่อหนึ่ง AI asset เก็บ:

```text
instrumental.<codec>
vocals.<codec>
manifest.json
```

ไม่เก็บ intermediate WAV หลังงานสำเร็จ และไม่เก็บ stems อื่นเป็นค่าเริ่มต้น

| ไฟล์ | bitrate แนะนำเบื้องต้น | ขนาดเพลง 4 นาทีโดยประมาณ |
|---|---:|---:|
| Instrumental Opus/AAC | 128–160 kbps | ~4–5 MB |
| Vocals Opus/AAC | 64–96 kbps | ~2–3 MB |
| รวม 2 stems | ~192–256 kbps | ~6–8 MB |

ตัวเลขเป็นเพียงประมาณการ ต้องวัดจาก codec/preset จริงใน Phase 0

ตัวอย่างพื้นที่ local:

```text
100 เพลง  ≈ 0.6–0.8 GB
500 เพลง  ≈ 3–4 GB
1,000 เพลง ≈ 6–8 GB
```

ควรกำหนด cache quota ที่ผู้ใช้เลือกได้ เช่น 5 GB / 10 GB / 20 GB และลบ asset เก่าด้วย LRU เมื่อเกิน limit

### สิ่งที่ไม่กิน Supabase Storage

รายการต่อไปนี้ต้องไม่ถูกอัปโหลดไป Supabase:

```text
source audio
instrumental stem
vocal stem
intermediate WAV
AI model weights
waveform/audio preview ที่สร้างจากเพลงเต็ม
```

ดังนั้น **Supabase Storage จากฟีเจอร์ AI Karaoke = 0 bytes ตาม architecture นี้**

หมายเหตุ: Supabase Database/Realtime ยังมีการใช้งานเล็กน้อยจาก room/control state ซึ่งเป็นคนละส่วนกับ Storage และมีขนาดเล็กกว่าไฟล์เสียงมาก

### หลักการเลือก codec

1. browser/player ที่เป็นเครื่องเสียงหลักต้อง decode ได้เสถียร
2. seek ต้องทำงานได้ดี
3. instrumental และ vocals ต้องใช้ sample rate/channels/container ที่เข้ากัน
4. ต้องตรวจ actual start offset หลัง encode
5. คุณภาพ instrumental สำคัญกว่าการบีบ vocal ให้เล็กที่สุด

ถ้าต้องรองรับ browser กว้างมาก สามารถใช้ MP3 ได้ แต่ควรทดสอบ decoder delay และการ seek ของสอง stems ด้วย

## 8. Local Stem Cache

Local Stem Cache เป็น cache หลักและเป็น **audio cache เพียงชนิดเดียวในระบบรุ่นนี้**

### โครงสร้างบน Player Machine

ตัวอย่าง:

```text
KaraokeHub/
  models/
  audio-cache/
    <asset-key>/
      instrumental.opus
      vocals.opus
      manifest.json
  temp/
```

`asset-key` คำนวณจาก:

```text
source_fingerprint + model_name + model_version + preset + output_codec
```

ห้ามใช้ชื่อไฟล์จาก input โดยตรงเป็น storage key เพื่อหลีกเลี่ยง collision/path issue

### Manifest

manifest ต้องเป็นแหล่งความจริงของ local asset:

- source fingerprint
- model name/version
- preset
- codec
- duration
- sample rate/channels
- instrumental path/checksum/byte size
- vocals path/checksum/byte size
- created_at
- last_accessed_at
- status/version ของ manifest

asset ถือว่า `ready` เมื่อ stems ที่จำเป็นครบและ validation ผ่าน

### Browser cache

ถ้า Stem Mixer รันใน browser บน Player Machine สามารถใช้ IndexedDB/Cache API เป็น **secondary local cache** ได้ แต่ไม่ใช่ source of truth หลัก

ใช้ในกรณี:

- ลดเวลาอ่าน/แปลงไฟล์ซ้ำ
- เก็บ decoded/derived metadata ที่ช่วย playback

ไม่ควรพึ่ง browser cache เป็นที่เก็บถาวร เพราะ browser สามารถ reclaim quota ได้

ถ้า browser cache หาย ให้โหลดจาก Worker/local disk ใหม่

### Worker cache policy

- เก็บ intermediate WAV เฉพาะระหว่างประมวลผล
- ลบ intermediate เมื่อ job สำเร็จหรือล้มเหลวแบบ recoverable ตาม cleanup policy
- เก็บ output compressed 2 stems และ checksum
- ลบทั้ง asset เป็นชุด ไม่ลบ stem เดียวโดยไม่แก้ manifest
- update `last_accessed_at` เมื่อมีการเล่น
- ลบ asset เก่าตาม LRU เมื่อเกิน quota
- มีคำสั่ง `Clear cache`
- มีหน้าจอแสดงพื้นที่ cache ปัจจุบัน
- ตรวจ free disk ก่อนดาวน์โหลด model/ประมวลผลเพลง

### กรณีมีแค่ instrumental

ถ้า instrumental พร้อมแต่ vocals หาย/เสีย:

- อนุญาตให้เล่น Karaoke แบบ Vocal OFF ได้ถ้าต้องการ
- ปุ่ม `*` ต้องแสดงว่า Vocal stem ยังไม่พร้อม
- ห้ามทำให้ระบบ crash
- สามารถ queue local reprocessing เพื่อสร้าง stems ใหม่

## 9. Supabase = Control Plane เท่านั้น

ส่วนนี้แทนที่ `Supabase Shared Audio Cache` เดิมทั้งหมด

### ไม่สร้าง audio Storage bucket

สำหรับ AI Karaoke **ไม่ต้องสร้าง** bucket เช่น `karaoke-audio` และไม่ต้องมี:

- `instrumental_storage_path`
- `vocals_storage_path`
- signed upload URL
- signed read URL
- resumable stem upload
- cleanup ของ cloud audio assets
- audio egress จาก Supabase

### ข้อมูลที่ Supabase อาจเก็บ

เก็บเฉพาะข้อมูลขนาดเล็กที่ใช้ควบคุมห้อง เช่น:

```text
rooms / playback state
----------------------
playback_mode            original | ai_karaoke
playback_source_key      stable logical source key
playback_position_ms
playback_updated_at
playback_is_playing
vocal_enabled
vocal_gain               optional
player_machine_id        optional
state_version            สำหรับ conflict control
```

ถ้าต้องการให้มือถือเห็น progress ของ Local Worker สามารถเพิ่ม metadata สั้น ๆ เช่น:

```text
local_ai_status          idle | processing | ready | failed
local_ai_progress        0..100
local_ai_error_code      nullable
local_ai_updated_at
```

ข้อมูลนี้เป็นเพียงสถานะ ไม่ใช่ asset และไม่รับประกันว่าเครื่องอื่นจะมี stems เดียวกัน

### Local availability ไม่ควรเป็น global truth

ห้ามใช้ค่า `ready` ใน Supabase เพื่อสรุปว่า "เพลงนี้มี AI stems พร้อมทุกเครื่อง"

สถานะที่ถูกต้องคือ:

```text
AI ready = พร้อมบน Player Machine เครื่องที่กำลัง active อยู่
```

ถ้าเปลี่ยน Player Machine:

- เครื่องใหม่ตรวจ local cache ของตัวเอง
- ถ้ามี asset key ตรงกัน -> ใช้ได้ทันที
- ถ้าไม่มี -> ต้องประมวลผล local ใหม่ หรือเล่น Original

### ตาราง/ข้อมูลที่ตัดออกจากแผนเดิม

ไม่จำเป็นต้องมีเพื่อเก็บ audio:

```text
audio_assets ที่ผูก storage paths
audio_asset_stems
audio_processing_jobs สำหรับ cloud worker
```

หากระบบต้องการ processing status สำหรับ UX ให้เก็บเป็น ephemeral/local-player status ใน room/player table แทน ไม่ใช้เป็น cloud asset registry

## 10. API / RPC ที่ต้องใช้

ไม่ต้องมี API สำหรับ upload/read ไฟล์เสียง

### RPC/endpoint ที่เสนอ

ใช้เฉพาะ control plane:

- `set_playback_mode(room_id, mode, source_key)`
- `set_playback_state(room_id, position_ms, is_playing)`
- `toggle_vocal_state(room_id, expected_version)`
- `set_vocal_state(room_id, enabled, gain, expected_version)`
- `set_active_player(room_id, player_machine_id)` — optional
- `report_local_ai_status(room_id, player_machine_id, status, progress, error_code)` — optional

Player Machine ติดต่อ Local Worker ผ่าน localhost/local IPC ไม่ผ่าน Supabase สำหรับไฟล์เสียง

ตัวอย่าง:

```text
Browser on TV
   |
   | localhost / IPC
   v
Local Worker
   |
   v
Local Stem Cache
```

### ลำดับการขอ AI Karaoke

1. Queue เลือกเพลง
2. TV อ่าน source key/metadata ของเพลง
3. TV คำนวณ/resolve local asset key
4. TV ตรวจ Local Stem Cache
5. ถ้า `ready` -> เข้า AI Karaoke ได้ทันที
6. ถ้าไม่พบ -> ตรวจว่ามี authorized local source หรือไม่
7. ถ้ามี -> Local Worker เริ่ม separation
8. ระหว่างประมวลผล -> TV เล่น Original fallback
9. Worker เขียน instrumental + vocals + manifest ลง local cache
10. Player validate stems
11. Player เข้า AI Karaoke เมื่อพร้อม
12. หลังจากนั้น `*` ทำแค่เปลี่ยน Vocal Gain และ sync state ไป Supabase

ไม่มีขั้นตอน upload/download stems จาก cloud

## 11. RLS และความปลอดภัย

เนื่องจากไม่มี cloud audio storage พื้นที่โจมตีลดลง แต่ยังต้องป้องกัน control plane และ local bridge

### Supabase/RLS

- Browser ห้ามมี service role key
- ผู้ใช้ต้องเปลี่ยน state ได้เฉพาะห้องที่มีสิทธิ์
- `vocal_enabled`, pause/play/end และ queue mutation ต้องผ่าน policy/RPC ที่ตรวจสิทธิ์
- ใช้ state version/timestamp ป้องกัน write conflict ที่สำคัญ
- จำกัด rate ของคำสั่งที่อาจ spam ห้อง
- Log เฉพาะ metadata ที่จำเป็น

### Local Worker

- bind เฉพาะ `127.0.0.1` โดยค่าเริ่มต้น
- ถ้าต้อง pair จาก browser/app ให้ใช้ pairing token ที่หมดอายุ
- ห้ามเปิด arbitrary file path endpoint ให้ remote client
- validate MIME/extension/duration/size ก่อนประมวลผล
- validate output path ให้อยู่ใต้ cache directory ที่กำหนด
- ป้องกัน path traversal
- จำกัด concurrent jobs ตาม hardware
- cleanup temp file หลังงาน
- ไม่ expose model/cache directory โดยไม่จำเป็น

### แหล่งไฟล์

ถ้า source เป็นเพลงที่มีลิขสิทธิ์ ต้องให้ผู้ใช้นำไฟล์ที่มีสิทธิ์มาเองหรือใช้แหล่งที่ได้รับอนุญาต ระบบไม่ควรทำตัวเป็นบริการดาวน์โหลด YouTube ของบุคคลอื่น

## 12. การซิงก์กับ Queue และห้อง

เมื่อเพลงปัจจุบันมี `playback_mode = ai_karaoke`:

- Queue ยังอ้างอิงเพลงเดิมและ YouTube video id/source id เดิม
- TV/Player Machine เป็นเครื่องเล่นเสียงเพียงเครื่องหลัก
- Player mute YouTube iframe ตลอด AI mode
- Player โหลด instrumental จาก Local Stem Cache เป็น master audio
- Player โหลด vocals จาก Local Stem Cache เป็น follower audio
- `*` เปลี่ยน `vocal_enabled` / Vocal Gain โดยไม่เปลี่ยนเพลงและไม่รัน AI ใหม่
- `End` เปลี่ยน queue ผ่าน RPC เดิม
- เพลงถัดไปตรวจ local cache ใหม่ ถ้าไม่มีให้ fallback Original และเริ่ม local processing ตาม policy
- Pause/Play เปลี่ยน stems ที่ Player และ room playback state
- Realtime event ทำให้อุปกรณ์ควบคุมเห็นสถานะเดียวกัน

### Vocal toggle ในห้อง

เส้นทางคำสั่งจากมือถือ:

```text
สมาชิกกด `*` / Vocal button
          |
          v
 toggle_vocal_state(...)
          |
          v
   Supabase Realtime
          |
          v
 TV / Player Machine
          |
          v
 Local Stem Mixer
          |
          v
 Vocal Gain 0 <-> 1
```

อุปกรณ์สมาชิก **ไม่โหลด stems และไม่เล่นเสียง**

ข้อดี:

- ไม่มี audio bandwidth จาก Supabase
- ลด drift ระหว่างหลายอุปกรณ์
- ลดปัญหา autoplay
- ทุกคนได้ยิน output เดียวกันจากระบบเสียงหลัก
- มือถือทำหน้าที่เป็น remote control เท่านั้น

### กด `*` บน Player Machine โดยตรง

เพื่อ UX ที่เร็วที่สุด:

1. Player ทำ local fade ทันที
2. จากนั้นเขียน state ใหม่ไป Supabase
3. อุปกรณ์อื่นอัปเดต UI ตาม state

ถ้าคำสั่งมาจากมือถือ:

1. มือถือ update/toggle room state
2. TV รับ Realtime event
3. TV fade vocal

ทั้งสองกรณีไม่ seek เพลงและไม่รัน AI ใหม่

### ผู้ใช้เข้าห้องกลางเพลง

อุปกรณ์ควบคุม:

1. อ่าน room state
2. แสดงเพลง/เวลา/vocal state
3. ไม่โหลด audio stems

TV/Player Machine:

1. อ่าน `playback_mode`, source key และตำแหน่ง
2. ตรวจ Local Stem Cache
3. ถ้า AI stems พร้อม ให้โหลดสอง stems
4. ถ้าไม่พร้อม ให้ Original fallback
5. seek video/audio ตาม room position
6. ใช้ `vocal_enabled`/`vocal_gain` ปัจจุบัน
7. ตรวจ drift หลังเริ่มเล่น

### กรณีเปลี่ยน TV/Player Machine

เครื่องใหม่ไม่มีสิทธิ์สมมติว่า stems พร้อมเพียงเพราะเครื่องเก่าเคยพร้อม

ขั้นตอน:

```text
Room state
   |
   v
New Player checks its local cache
   |
   +-- HIT  -> AI Karaoke
   |
   +-- MISS -> Original + local processing
```

นี่คือ trade-off หลักของการไม่ใช้ Shared Audio Cache และเป็นพฤติกรรมที่ต้องยอมรับเพื่อให้ระบบไม่ใช้ cloud audio storage

## 13. แผนพัฒนาเป็นระยะ

### Phase 0: Quality + Stem Sync Proof-of-Concept

- คัดเพลงไทยจริง 10–20 เพลงที่มีปัญหาเสียงร้องติด
- เตรียมไฟล์ input ที่ถูกต้องตามสิทธิ์
- ทดสอบ Mel/BS-RoFormer, MDX23C และ VR preset
- วัดเวลา, RAM/VRAM, ขนาดไฟล์ และฟัง artifact
- ตรวจ instrumental/vocals ว่าระยะเวลาและ offset ตรงกัน
- encode stems ด้วย codec candidate หลายแบบ
- ทดสอบผสม stems กลับเพื่อดู timing/clipping
- เลือก preset เริ่มต้น 1 แบบและ fallback 1 แบบ

ผลลัพธ์ที่ต้องได้: รายงานคุณภาพ, preset baseline, codec baseline และยืนยันว่า 2 stems sync กันได้ดีพอสำหรับ mixer

### Phase 1: Local Worker + Local Stem Cache MVP

- สร้าง Python CLI/worker
- รองรับไฟล์ MP3/WAV/M4A/FLAC
- เพิ่ม FFmpeg normalization และ output encoding
- สร้าง instrumental + vocals
- เพิ่ม checksum/manifest
- สร้าง Local Stem Cache
- เพิ่ม LRU/quota cleanup ขั้นพื้นฐาน
- เพิ่ม automated tests สำหรับ input validation, duration, stem alignment และ output

ผลลัพธ์ที่ต้องได้: ประมวลผลเพลงบน Player Machine และ reuse stems จาก local cache ได้โดยไม่แตะ production database หรือ cloud storage

### Phase 2: Local Stem Mixer บน TV/Player

- เพิ่มปุ่ม `สร้าง AI Karaoke`
- เพิ่มสถานะ `ยังไม่มี / กำลังประมวลผล / พร้อมเล่น / ล้มเหลว`
- เชื่อม Local Worker กับ Player ผ่าน localhost/IPC
- โหลด instrumental + vocals จาก local cache
- สร้าง Stem Mixer
- เพิ่ม Vocal ON/OFF button
- เพิ่ม keyboard shortcut `*`
- เพิ่ม fade 30–100 ms
- เพิ่ม pause/play/seek สำหรับสอง stems
- เพิ่ม drift detection/correction
- ใช้ Original เป็น fallback โดยไม่กระทบ Queue เดิม

ผลลัพธ์ที่ต้องได้: TV/Player เครื่องเดียวเล่น AI Karaoke และกด `*` เปิด/ปิด vocal ได้โดยไม่ต้องรัน AI ใหม่

### Phase 3: Supabase Room Control Integration

- เพิ่ม/ปรับ `playback_mode`
- เพิ่ม logical `playback_source_key` แทน cloud audio asset id
- เพิ่ม `vocal_enabled` และ optional `vocal_gain`
- เพิ่ม atomic RPC สำหรับ vocal toggle
- เพิ่ม active player identity ถ้าจำเป็น
- เพิ่ม Realtime สำหรับ room control state
- เพิ่ม optional local-processing progress metadata
- ยืนยันว่าไม่มี Storage bucket/audio upload path ใน feature นี้

ผลลัพธ์ที่ต้องได้: มือถือควบคุม TV/Player ผ่าน Supabase ได้ โดย audio/stems ยังอยู่ local 100%

### Phase 4: Shared Playback Control + Multi-device Tests

- ทดสอบ TV + มือถือ + คอมพิวเตอร์ควบคุมพร้อมกัน
- Pause/Play/End จากสมาชิกสะท้อนไป Player
- Vocal toggle จากสมาชิกสะท้อนไป Player
- ทดสอบ state conflict เมื่อกดพร้อมกัน
- ตรวจ reconnect / room rejoin
- ตรวจ autoplay, seek drift และ vocal toggle latency
- ทดสอบเปลี่ยน active Player Machine แล้ว local cache miss/fallback ถูกต้อง

ผลลัพธ์ที่ต้องได้: ทุกอุปกรณ์ควบคุมสถานะเดียวกัน แต่มีเสียงออกจาก Player Machine หลักเพียงเครื่องเดียว

### Phase 5: Desktop Packaging

- ห่อ Worker เป็น Tauri/Electron/desktop companion ตามเทคโนโลยีที่เลือก
- ทำ pairing flow ผ่าน QR/รหัส
- เพิ่ม auto-update เฉพาะตัว Worker หากจำเป็น
- แสดง GPU/CPU, disk, model download และ job progress
- แสดงขนาด Local Stem Cache
- เพิ่ม Clear Cache / cache size limit
- ทำ installer และ uninstaller

ผลลัพธ์ที่ต้องได้: ผู้ใช้ทั่วไปติดตั้งและใช้งานได้โดยไม่ต้องเปิด terminal

### Phase 6: Optional Enhancements

ทำหลัง MVP เสถียรแล้ว:

- Guide Vocal slider 0–100%
- preset shortcut `0% / 20% / 40% / 100%`
- crossfade curve ที่ปรับได้
- pre-process/prefetch เพลงถัดไปใน Queue เมื่อมี authorized source พร้อม
- waveform/loading indicator ที่สร้าง local
- offline playback จาก local cache
- stem quality fallback อัตโนมัติสำหรับเพลงที่แยกยาก
- export/import local cache แบบผู้ใช้สั่งเอง หากอนาคตต้องย้ายเครื่อง

ไม่ควรเพิ่ม true live AI separation จนกว่าจะมี use case ที่จำเป็นจริง เพราะจะเพิ่ม latency, hardware requirement และความซับซ้อนมาก

## 14. แผนทดสอบ

### Functional tests

- cache miss แล้ว Worker สร้าง asset ใหม่ได้
- cache hit แล้วไม่รัน AI ซ้ำ
- manifest/checksum ของสอง stems ถูกต้อง
- Worker crash แล้ว temp file ถูก cleanup/recover ตาม policy
- ไฟล์เสีย/codec ไม่รองรับถูกปฏิเสธ
- vocal stem เสียแต่ instrumental ยังดี ระบบไม่ crash
- Clear Cache ลบ asset และ manifest สอดคล้องกัน
- cache quota/LRU ทำงานตามกำหนด
- ไม่มี code path ที่ upload audio ไป Supabase

### Playback tests

- Original mode ยังทำงานเหมือนเดิม
- AI mode mute YouTube และเล่น local instrumental ได้
- Vocal stem เริ่มตรงกับ instrumental
- กด `*` แล้ว vocal OFF -> ON โดยเพลงไม่หยุด
- กด `*` แล้ว vocal ON -> OFF โดยเพลงไม่หยุด
- toggle ไม่ทำให้ playback position กระโดด
- fade ไม่มี click/pop ที่สังเกตได้
- กด `*` ถี่ ๆ แล้ว state ไม่ค้างหรือกลับด้านผิด
- keyboard repeat ไม่ยิง toggle หลายครั้งโดยไม่ตั้งใจ
- shortcut ไม่ทำงานขณะพิมพ์ใน input/textarea
- ปุ่ม Vocal บนมือถือทำงานเหมือน shortcut
- Pause/Play จากสมาชิกสะท้อนที่ TV
- End จากสมาชิกเปลี่ยนเพลงถัดไปที่ TV
- เข้าห้องกลางเพลงแล้วตำแหน่งไม่คลาดมากเกินเกณฑ์
- เพลงถัดไปไม่มี local asset แล้ว fallback Original
- vocal state หลัง reconnect ตรงกับ room state

### Sync tests

- instrumental กับ vocals duration ต่างกันไม่เกิน threshold
- start offset ของ stems อยู่ในเกณฑ์
- เล่นต่อเนื่องทั้งเพลงแล้ว drift ไม่เกินเกณฑ์
- seek ไปต้น/กลาง/ท้ายเพลงแล้ว stems ยังตรงกัน
- pause/resume หลายครั้งแล้ว stems ยังตรงกัน
- YouTube video drift จาก instrumental ไม่เกิน tolerance ที่กำหนด
- drift correction ไม่เกิด loop หรือ seek ถี่เกินไป

### Quality tests

- duration output ใกล้ input ตาม threshold
- ไม่มี clipping หรือไฟล์เงียบทั้งเพลง
- sample rate/channels ถูกต้อง
- peak และ loudness อยู่ในช่วงที่เล่นในงาน Karaoke ได้
- เมื่อ Vocal OFF เสียงร้องลดลงอย่างเห็นได้ชัด
- เมื่อ Vocal ON เสียงร้องกลับมาโดย timing ไม่ผิด
- ผสม instrumental + vocals แล้วฟังเป็นธรรมชาติพอสำหรับใช้งาน
- ฟังเทียบ Original/AI กับเพลงตัวอย่างทั้งชุด
- ทดสอบเสียงร้องนำ, เสียงประสาน, reverb, rap, เพลง live และเพลงไทยหลายแนว

### Performance tests

วัดอย่างน้อย:

- เวลา AI separation ต่อเพลงบน CPU/GPU เป้าหมาย
- เวลา cache lookup
- เวลาโหลด 2 stems จาก local disk
- latency จากกด `*` บน Player จน gain เริ่มเปลี่ยน
- latency จากกด Vocal บนมือถือจน Player gain เริ่มเปลี่ยน
- CPU/RAM ตอนเล่น 2 stems
- local disk usage ต่อเพลง
- เวลา seek พร้อมกันของ instrumental/vocals

เป้าหมายของปุ่ม `*` ควรวัดที่ mixer/playback latency ไม่ใช่เวลา AI inference เพราะ AI separation เกิดก่อนหน้านั้นแล้ว

### Operational tests

- Local cache เต็มแล้ว LRU/fallback ทำงานได้
- disk เหลือน้อยแล้วไม่เริ่ม job ที่เสี่ยงล้มเหลว
- Browser cache ถูกลบแล้ว Player reload จาก Worker cache ได้
- Supabase ล่มชั่วคราวแล้ว Player ไม่ทำไฟล์ local เสีย
- Vercel Function ไม่รับไฟล์เสียงขนาดใหญ่
- ไม่มี service key ใน client/log
- ไม่มี stem/audio blob ใน Supabase Storage
- ไม่มี network request สำหรับ upload stems ไป cloud
- เปลี่ยน Player Machine แล้ว cache miss ถูกจัดการด้วย Original fallback

## 15. เกณฑ์ยอมรับก่อนเปิดใช้จริง

- เพลงเดิมยังเล่นได้เหมือนเดิมเมื่อไม่เปิด AI mode
- เพลงที่ผ่าน AI มีเสียงร้องลดลงอย่างเห็นได้ชัดในชุดทดสอบ
- Local AI asset พร้อมใช้งานมี instrumental + vocals ที่ sync กัน
- กด `*` แล้วเปิด/ปิด vocal ได้โดยไม่หยุดเพลงหรือรัน AI ใหม่
- การเปลี่ยน vocal state ไม่มี click/pop รุนแรง
- toggle ไม่ทำให้ playback position เปลี่ยน
- Pause/Play/End ยังเป็นสถานะร่วมของห้อง
- ถ้า Local Worker/cache ใช้งานไม่ได้ ระบบ fallback เป็น Original ได้
- ถ้า Supabase control plane ขัดข้อง ไม่ทำให้ local cache เสียหาย
- ไม่มีการเปลี่ยนเพลงหรือ queue ผิดจากการประมวลผล
- ไม่มีการดาวน์โหลด YouTube ที่ไม่ได้รับอนุญาต
- **ไม่มี audio/stem file ถูกเก็บใน Supabase Storage**
- **ไม่มีค่า cloud AI/GPU ที่เกิดจาก source separation ตาม architecture หลัก**
- TV + มือถืออย่างน้อยสองอุปกรณ์ควบคุมห้องร่วมกันผ่าน
- ถ้า TV เป็น player หลัก สมาชิกสามารถกดควบคุม vocal แล้ว TV เปลี่ยนสถานะตามได้

## 16. ตัวเลือกที่ต้องตัดสินใจก่อนเริ่ม Phase 1

1. Input รุ่นแรกจะเป็นไฟล์ local ที่ผู้ใช้เลือกเองเท่านั้นหรือไม่
2. รูปแบบการนำ source ที่ได้รับอนุญาตเข้ามาที่ Player Machine จะเป็นอย่างไร
3. ค่าเริ่มต้นต้องการ `balanced` หรือ `clean_karaoke`
4. ใช้ Opus/AAC หรือ MP3 เป็น codec หลักของ stems
5. bitrate ของ instrumental และ vocals จะใช้เท่าไร
6. Local Stem Cache default limit จะเป็นกี่ GB
7. ปุ่ม `*` จะเป็น room-wide state แต่ Player เป็นผู้ทำเสียงจริงใช่หรือไม่
8. Vocal ON หลังเปิด AI mode ครั้งแรกควร default เป็น OFF หรือจำค่าล่าสุดของห้อง
9. drift threshold ระหว่าง instrumental/vocal และระหว่าง audio/video จะกำหนดเท่าไรหลัง Phase 0
10. ถ้า Player cache miss ระหว่างเพลงอยู่ จะรอ separation, เล่น Original จนจบ หรือสลับเข้า AI mode เมื่อพร้อม

## ข้อเสนอสุดท้าย

เริ่มจาก **Phase 0 และ Phase 1** โดยพิสูจน์ให้ได้ว่า Player Machine สามารถสร้าง **instrumental + vocals ที่ timing ตรงกัน** และเก็บ/reuse จาก Local Stem Cache ได้อย่างเสถียร

จากนั้น Phase 2 ให้ทำ Stem Mixer บนเครื่อง Player โดย milestone หลักคือ:

```text
เล่นเพลง AI Karaoke
      +
กด `*`
      +
เสียงร้องเปิด/ปิดทันที
      +
เพลงไม่หยุด / ไม่ seek / ไม่รัน AI ใหม่
      +
ไม่มี audio upload ไป cloud
```

เมื่อ local flow ผ่านแล้วจึงเชื่อม Supabase เฉพาะ room/control state ใน Phase 3

สถาปัตยกรรมสุดท้าย:

```text
                 SUPABASE
          Queue / Room / Control
          ไม่มี Audio Storage
                 |
        Realtime commands
                 |
                 v
          TV / Player Machine
                 |
       +---------+----------+
       |                    |
       v                    v
 Local AI Worker      Local Stem Cache
       |                    |
       +---------+----------+
                 |
          +------+------+
          |             |
          v             v
   Instrumental       Vocals
          |             |
          +------+------+
                 |
          Web Audio Mixer
                 |
        +--------+--------+
        |                 |
        v                 v
  Music Gain 1.0    Vocal Gain 0/1
                           ^
                           |
                        ปุ่ม `*`
```

แนวทางนี้ทำให้ AI ทำงานบนเครื่องผู้ใช้, audio cache อยู่ local, ปุ่ม `*` ตอบสนองเร็ว และ **Supabase Storage ไม่ถูกใช้สำหรับฟีเจอร์เสียงเลย** โดยแลกกับข้อจำกัดว่าเมื่อเปลี่ยน Player Machine เครื่องใหม่อาจต้องประมวลผลเพลงเดิมใหม่หากไม่มี local cache
