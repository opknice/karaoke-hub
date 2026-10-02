# แผนพัฒนาระบบ AI ตัดเสียงร้องสำหรับ KARAOKE.HUB

สถานะเอกสาร: แผนงาน ยังไม่เริ่มแก้โค้ดจริง

## 1. เป้าหมาย

เพิ่มโหมด `AI Karaoke` สำหรับเพลงที่ระบุว่าเป็น Karaoke แต่ยังมีเสียงนักร้องติดอยู่ โดยระบบต้อง:

- สร้างไฟล์ instrumental จากไฟล์เสียงที่ผู้ใช้มีสิทธิ์ใช้งาน
- ใช้เครื่องของผู้ใช้เป็นหลักในการประมวลผล เพื่อไม่เสียค่า GPU/CPU บนคลาวด์
- ใช้ Local Cache ก่อน เพื่อลดการดาวน์โหลดและการประมวลผลซ้ำ
- ใช้ Supabase เป็น Shared Cache เมื่อหลายอุปกรณ์ต้องใช้ไฟล์เดียวกัน
- เล่นเสียงได้ตรงกับวิดีโอ/เนื้อเพลงเดิม
- มี Original เป็น fallback เสมอ หากยังไม่มีไฟล์ AI หรือการประมวลผลล้มเหลว
- ทำงานร่วมกับระบบห้อง, Queue, Pause/Play และ End ที่มีอยู่แล้ว

## 2. ขอบเขตและข้อจำกัด

### อยู่ในขอบเขต

- แยกเสียงร้องออกจากไฟล์เพลงที่ผู้ใช้เลือกหรืออัปโหลด
- เก็บสถานะงานและไฟล์ผลลัพธ์แบบมีการตรวจสอบสิทธิ์
- เล่นวิดีโอเดิมแบบปิดเสียง พร้อมเล่น instrumental แยกผ่าน `<audio>`
- รองรับ Local Worker บน Windows เป็นรุ่นแรก
- รองรับการ cache ระดับ browser และระดับเครื่อง Worker

### ไม่อยู่ในขอบเขตรุ่นแรก

- ไม่ทำการดาวน์โหลดเสียงจาก YouTube ของผู้อื่นโดยอัตโนมัติ
- ไม่รับประกันการลบเสียงร้องได้สมบูรณ์ทุกเพลง
- ไม่ประมวลผลโมเดล AI ใน Vercel Function
- ไม่เก็บไฟล์ WAV/stems หลายชุดบน Supabase เป็นค่าเริ่มต้น
- ไม่บังคับให้สมาชิกทุกคนติดตั้งโปรแกรม หากมีเครื่อง TV หนึ่งเครื่องเป็นผู้เล่นเสียงหลัก

YouTube ระบุช่องทางดาวน์โหลดไฟล์สำหรับวิดีโอที่ผู้ใช้เป็นเจ้าของ และไฟล์ offline ของ Premium ไม่ใช่ไฟล์เสียงทั่วไปสำหรับนำไปประมวลผล ดังนั้น input ของระบบควรเป็นไฟล์ local/ไฟล์ที่ผู้ใช้มีสิทธิ์ หรือแหล่งที่ได้รับอนุญาตเท่านั้น:

- [YouTube Help: Download videos that you've uploaded](https://support.google.com/youtube/answer/56100?hl=en)

## 3. สถาปัตยกรรมที่แนะนำ

ใช้สถาปัตยกรรม **Local-first + Optional Shared Cache**:

```text
ผู้ใช้เลือกไฟล์ที่มีสิทธิ์ใช้งาน
          |
          v
Browser Cache / Local Worker Cache ตรวจสอบก่อน
          |
          +-- พบไฟล์ --> เล่น AI Karaoke ได้ทันที
          |
          +-- ไม่พบไฟล์
                    |
                    v
             Local Audio Worker
                    |
                    v
             AI Vocal Separation
                    |
          +---------+---------+
          |                   |
          v                   v
  เก็บ Local Cache       อัปโหลด Shared Cache
                              |
                              v
                       Supabase Storage
                              |
                              v
                     อุปกรณ์อื่นในห้องใช้ร่วมกัน
```

### ทำไมไม่ประมวลผลบน Vercel

Vercel เหมาะกับ API และหน้าเว็บ แต่ไม่เหมาะกับงานแยกเสียงที่ใช้ CPU/GPU และใช้เวลานาน โมเดลมีขนาดใหญ่และการประมวลผลอาจเกินเวลาของ Function Hobby ได้ ([Vercel Functions Limits](https://vercel.com/docs/functions/limitations))

Vercel จะทำหน้าที่เพียง:

- สร้าง job และตรวจสิทธิ์
- ออก signed upload/read URL
- อ่านสถานะงาน
- ส่ง metadata ให้ client

การประมวลผลจริงอยู่ที่ Local Worker ของผู้ใช้

## 4. รูปแบบการเล่นเสียง

ปัจจุบันระบบใช้ YouTube Player เป็นตัวเล่นหลัก ดังนั้นโหมด AI ต้องแยกภาพกับเสียง:

### Original mode

```text
YouTube iframe: เปิดเสียง + แสดงวิดีโอ/เนื้อเพลง
HTML audio: ไม่ใช้
```

### AI Karaoke mode

```text
YouTube iframe: mute + แสดงวิดีโอ/เนื้อเพลง
HTMLAudioElement: เล่นไฟล์ instrumental ที่ผ่าน AI
```

การควบคุมต้องใช้สถานะห้องชุดเดียวกัน:

- Pause/Play
- End เพลง
- เริ่มเพลงใหม่
- เปลี่ยนเพลง
- ตำแหน่ง playback โดยประมาณ
- โหมดเสียง `original` หรือ `ai_karaoke`

### แหล่งความจริงของ playback

Supabase เป็นแหล่งความจริงของสถานะห้อง ส่วน YouTube iframe และ HTML audio เป็นตัวแสดงผลในแต่ละอุปกรณ์

เพื่อให้ผู้เข้าทีหลังเริ่มตรงตำแหน่ง ควรเพิ่มข้อมูลใน `rooms` หรือ playback state:

- `playback_mode`: `original | ai_karaoke`
- `playback_asset_id`: ไฟล์ instrumental ที่ใช้
- `playback_position_ms`: ตำแหน่งล่าสุด
- `playback_updated_at`: เวลาที่เปลี่ยนสถานะล่าสุด
- `playback_is_playing`: มีอยู่แล้วจาก migration ปัจจุบัน

เมื่อเล่นอยู่ ตำแหน่งคำนวณได้จาก `playback_position_ms + (now - playback_updated_at)` เมื่อหยุดให้บันทึกตำแหน่งล่าสุดลง RPC

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

### Preset ที่ควรมี

| Preset | เป้าหมาย | พฤติกรรม |
|---|---|---|
| `balanced` | เพลงทั่วไป | รักษาดนตรีและตัด vocal ระดับกลาง |
| `clean_karaoke` | ต้องการดนตรีสะอาด | ตัด vocal แรงขึ้น อาจเสียเสียงประสานบางส่วน |
| `preserve_backing` | เก็บ backing vocal | ลดการตัดเสียงร้องที่เบาหรือเสียงประสาน |
| `original` | fallback | ไม่ผ่าน AI |

ไม่มีโมเดลใดรับประกันว่าเสียงร้อง, reverb, backing vocal และเสียงดนตรีจะถูกแยกได้สมบูรณ์ทุกเพลง จึงต้องมี Original fallback และควรให้ผู้ใช้เลือก preset ได้

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
- ตรวจ output ว่า duration ใกล้ input
- encode เป็น AAC/Opus/MP3
- เขียนผลลง cache พร้อม manifest
- รายงาน progress และ error code

### รุ่นใช้งานจริงบน Windows

หลังคุณภาพผ่าน ให้ห่อ worker เป็น Tauri หรือ Electron พร้อม Python sidecar โดยให้ผู้ใช้:

1. เปิดโปรแกรม Worker
2. กด Pair กับห้องด้วยรหัสครั้งเดียวหรือ QR
3. เลือกไฟล์เพลง
4. เลือก preset
5. รอผลและเห็นสถานะในเว็บ

ไม่ควรเปิด HTTP listener บน `0.0.0.0` โดยค่าเริ่มต้น ควรใช้ `127.0.0.1` และ pairing token ที่หมดอายุ

### GPU/CPU

- NVIDIA GPU: ใช้ CUDA หากพร้อม จะเหมาะกับการประมวลผลหลายเพลง
- เครื่องไม่มี GPU: ใช้ CPU fallback แต่แจ้งเวลาประมาณการให้ผู้ใช้
- ห้ามถือว่าเครื่องทุกเครื่องมี GPU หรือมีพื้นที่ disk เพียงพอ
- ควรตรวจสอบ free disk ก่อนดาวน์โหลด model และก่อนสร้าง output

## 7. รูปแบบไฟล์และพื้นที่

เก็บเฉพาะไฟล์ instrumental ที่ใช้งานจริง ไม่เก็บ WAV และ stems หลายชุดเป็นค่าเริ่มต้น:

| รูปแบบ | ขนาดเพลง 4 นาทีโดยประมาณ |
|---|---:|
| Opus/AAC 128 kbps | 3–4 MB |
| MP3 192 kbps | 5–7 MB |
| MP3 320 kbps | 9–10 MB |
| WAV 44.1 kHz stereo | 40–45 MB |

ค่าเริ่มต้นที่แนะนำคือ AAC/Opus 128–160 kbps ประมาณ 4–6 MB ต่อเพลง ถ้าต้องรองรับ browser ได้กว้างมากให้ใช้ MP3 160–192 kbps

Supabase Free Storage มีโควตาพื้นที่ประมาณ 1 GB และจำกัดไฟล์เดี่ยวไม่เกิน 50 MB จึงควรใช้ compressed output และมีระบบ cleanup:

- [Supabase Storage pricing](https://supabase.com/docs/guides/storage/pricing)
- [Supabase Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)

## 8. Local Cache

### Browser cache

ใช้ IndexedDB หรือ Cache API สำหรับไฟล์ Blob ห้ามใช้ `localStorage` เก็บไฟล์เสียงโดยตรง

Cache key:

```text
source_fingerprint + model_name + model_version + preset + output_codec
```

เก็บ metadata ต่อไฟล์:

- cache key
- source video/file id
- duration
- codec/bitrate
- model version
- created_at
- last_accessed_at
- byte_size

นโยบาย:

- ลบไฟล์เก่าตาม LRU เมื่อพื้นที่เกิน threshold
- ถ้า browser quota เต็ม ให้ลบ cache แล้ว fallback ไป Shared Cache/Original
- ห้ามถือว่า browser cache จะอยู่ถาวร

### Worker cache

Worker เก็บไฟล์ไว้ในโฟลเดอร์ที่ผู้ใช้เลือกได้ เช่น `KaraokeHub\audio-cache` และใช้ manifest เดียวกับ browser

- เก็บ intermediate WAV เฉพาะระหว่างประมวลผล
- ลบ intermediate เมื่อ job สำเร็จ
- เก็บ output compressed และ checksum
- มีคำสั่งล้าง cache ที่ผู้ใช้กดยืนยันเองได้

## 9. Supabase Shared Cache

### Storage bucket

สร้าง private bucket เช่น `karaoke-audio` และเก็บไฟล์ตาม path:

```text
{source_fingerprint}/{model_version}/{preset}/{codec}.audio
```

ใช้ signed read URL ที่อายุสั้น ไม่เปิด bucket เป็น public โดยไม่จำเป็น

Supabase Storage รองรับ resumable upload เหมาะกับไฟล์ใหญ่หรือ connection ที่ไม่เสถียร:

- [Supabase Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)

### ตาราง `audio_assets`

ตารางนี้เป็น metadata ของผลลัพธ์ที่ใช้ซ้ำได้ทั่วระบบ:

```text
id uuid primary key
source_type text              -- uploaded | licensed_file
source_fingerprint text       -- checksum หรือ stable source key
youtube_video_id text null
storage_path text
codec text
bitrate_kbps integer
duration_ms integer
sample_rate integer
channels integer
model_name text
model_version text
preset text
byte_size bigint
sha256 text
status text                   -- processing | ready | failed | expired
created_by uuid
created_at timestamptz
last_accessed_at timestamptz
expires_at timestamptz null
```

Unique key ที่ควรใช้:

```text
(source_fingerprint, model_name, model_version, preset, codec)
```

### ตาราง `audio_processing_jobs`

แยก job ออกจาก asset เพราะ asset เดียวอาจถูกเรียกใช้หลายห้อง:

```text
id uuid primary key
asset_id uuid null
room_id uuid null
requested_by_member_id uuid
status text                   -- queued | processing | ready | failed | cancelled
progress smallint             -- 0..100
worker_id text null
attempt integer default 0
error_code text null
error_message text null
created_at timestamptz
started_at timestamptz null
completed_at timestamptz null
heartbeat_at timestamptz null
```

ต้องมี unique/deduplication rule เพื่อไม่ให้สมาชิกหลายคนสร้าง job เดียวกันพร้อมกัน

## 10. API และ RPC ที่ต้องเพิ่ม

Vercel API ใช้ตรวจสิทธิ์และออก URL เท่านั้น ไม่รับไฟล์ขนาดใหญ่เข้า Function โดยตรง

### RPC/endpoint ที่เสนอ

- `find_audio_asset(source_fingerprint, model_version, preset)`
- `request_audio_processing(...)`
- `claim_audio_processing_job(worker_id)`
- `heartbeat_audio_processing_job(job_id)`
- `complete_audio_processing_job(job_id, metadata, storage_path)`
- `fail_audio_processing_job(job_id, error_code, message)`
- `create_audio_upload_url(asset_id)`
- `create_audio_read_url(asset_id)`

### ลำดับการขอเพลง AI

1. Client ค้นหา `audio_assets` จาก fingerprint
2. ถ้า `ready` ให้รับ signed read URL
3. ถ้า `processing` ให้ subscribe สถานะผ่าน Realtime
4. ถ้าไม่พบ ให้สร้าง job แบบ idempotent
5. Worker claim job ที่ได้รับอนุญาต
6. Worker ประมวลผล local
7. Worker upload output ด้วย signed URL
8. Worker complete job พร้อม checksum/ขนาด/duration
9. Client ดาวน์โหลดและเก็บ Local Cache

## 11. RLS และความปลอดภัย

- ใช้ private Storage bucket
- Browser ห้ามมี service role key
- Signed URL มีอายุสั้นและผูกกับ asset ที่ผู้ใช้มีสิทธิ์
- ผู้ใช้ในห้องอ่านสถานะ job/asset ที่ห้องนั้นร้องขอได้
- Worker ใช้ pairing token แบบใช้ครั้งเดียวหรือหมดอายุ
- ตรวจชนิดไฟล์และขนาดก่อนสร้าง job
- จำกัดจำนวน job ต่อสมาชิก/ห้องต่อช่วงเวลา
- ป้องกัน path traversal โดยสร้าง storage path จาก UUID/fingerprint ที่ระบบสร้างเอง
- ไม่รับ arbitrary URL แล้วให้ server ไปดาวน์โหลด
- Log เฉพาะ metadata ไม่ log token หรือ signed URL
- จำกัดจำนวน retry และใช้ backoff

ถ้า source เป็นเพลงที่มีลิขสิทธิ์ ต้องให้ผู้ใช้นำไฟล์ที่มีสิทธิ์มาเองหรือแสดงข้อความยืนยันสิทธิ์ก่อนประมวลผล ระบบไม่ควรทำตัวเป็นบริการดาวน์โหลด YouTube

## 12. การซิงก์กับ Queue และห้อง

เมื่อเพลงปัจจุบันมี `playback_mode = ai_karaoke`:

- Queue ยังอ้างอิงเพลงเดิมและ YouTube video id เดิม
- Player mute YouTube iframe
- Player โหลด audio asset ที่ `ready`
- `End` เปลี่ยน queue ผ่าน RPC เดิม
- เพลงถัดไปโหลด asset ใหม่ถ้ามี ถ้าไม่มีให้ fallback Original
- Pause/Play เปลี่ยนทั้ง HTML audio และ room playback state
- Realtime event ทำให้ TV และอุปกรณ์อื่นเปลี่ยนสถานะตามกัน

กรณีผู้ใช้เข้าห้องหลังเพลงเริ่มแล้ว:

1. อ่าน `playback_mode`, `playback_asset_id`, `playback_position_ms`
2. โหลด video และ audio พร้อมกัน
3. คำนวณตำแหน่งตาม `playback_updated_at`
4. เริ่มเล่นเมื่อ browser อนุญาต autoplay
5. หาก autoplay ถูกบล็อก ให้แสดงปุ่ม `Enable Playback` แต่ไม่เปลี่ยน room state

ถ้าออกแบบให้เครื่อง TV เป็นแหล่งเสียงเดียว อุปกรณ์สมาชิกไม่จำเป็นต้องโหลดไฟล์เสียงทุกเครื่อง จะลด bandwidth และลดปัญหา sync ได้มากที่สุด

## 13. แผนพัฒนาเป็นระยะ

### Phase 0: Quality Proof-of-Concept

- คัดเพลงไทยจริง 10–20 เพลงที่มีปัญหาเสียงร้องติด
- เตรียมไฟล์ input ที่ถูกต้องตามสิทธิ์
- ทดสอบ Mel/BS-RoFormer, MDX23C และ VR preset
- วัดเวลา, RAM/VRAM, ขนาดไฟล์ และฟัง artifact
- เลือก preset เริ่มต้น 1 แบบและ fallback 1 แบบ

ผลลัพธ์ที่ต้องได้: รายงานคุณภาพและ preset ที่ใช้เป็น baseline

### Phase 1: Local Worker MVP

- สร้าง Python CLI
- รองรับไฟล์ MP3/WAV/M4A/FLAC
- เพิ่ม FFmpeg normalization และ output encoding
- เพิ่ม checksum/manifest/cache
- เพิ่ม automated tests สำหรับ input validation, duration และ output

ผลลัพธ์ที่ต้องได้: ประมวลผลเพลง local สำเร็จโดยไม่เกี่ยวกับ production database

### Phase 2: Local-first ในเว็บ

- เพิ่มปุ่ม `สร้าง AI Karaoke`
- เพิ่มสถานะ `ยังไม่มี / กำลังประมวลผล / พร้อมเล่น / ล้มเหลว`
- เชื่อม browser cache
- ให้ผู้ใช้ดาวน์โหลดไฟล์เข้า Worker หรือเลือก local file
- เล่น Original เป็น fallback โดยไม่กระทบ Queue เดิม

ผลลัพธ์ที่ต้องได้: ผู้ใช้หนึ่งเครื่องใช้ AI Karaoke ได้โดยไม่ต้องมี Shared Cache

### Phase 3: Shared Cache บน Supabase

- สร้าง migration ตาราง `audio_assets` และ `audio_processing_jobs`
- สร้าง private Storage bucket และ policies
- สร้าง RPC/API สำหรับ job lifecycle
- เพิ่ม signed upload/read URLs
- เพิ่ม Realtime สำหรับสถานะ job
- เพิ่ม deduplication และ cleanup policy

ผลลัพธ์ที่ต้องได้: ประมวลผลครั้งเดียวและใช้งานได้หลายอุปกรณ์

### Phase 4: Shared Playback

- เพิ่ม `playback_mode`, `playback_asset_id`, `playback_position_ms`
- ปรับ RPC Pause/Play ให้บันทึกตำแหน่ง
- เพิ่ม audio controller แยกจาก YouTube controller
- ทดสอบ TV + มือถือ + คอมพิวเตอร์พร้อมกัน
- ตรวจ autoplay และ seek drift

ผลลัพธ์ที่ต้องได้: สมาชิกในห้องเห็นภาพและได้ยิน audio mode เดียวกัน

### Phase 5: Desktop Packaging

- ห่อ Worker เป็น Tauri/Electron สำหรับ Windows
- ทำ pairing flow ผ่าน QR/รหัส
- เพิ่ม auto-update เฉพาะตัว Worker หากจำเป็น
- แสดง GPU/CPU, disk, model download และ job progress
- ทำ installer และ uninstaller

ผลลัพธ์ที่ต้องได้: ผู้ใช้ทั่วไปติดตั้งและใช้งานได้โดยไม่ต้องเปิด terminal

## 14. แผนทดสอบ

### Functional tests

- สร้าง job ซ้ำพร้อมกันแล้วได้ asset เดียว
- Worker claim job ได้เพียงหนึ่งเครื่อง
- Worker crash แล้ว job กลับมา queued ได้หลัง heartbeat timeout
- Upload ขาดตอนแล้ว resume ได้
- ไฟล์เสีย/codec ไม่รองรับถูกปฏิเสธ
- Asset `failed` ไม่ทำให้ queue ค้าง
- ลบ asset แล้ว signed URL ใช้งานต่อไม่ได้

### Playback tests

- Original mode ยังทำงานเหมือนเดิม
- AI mode mute YouTube และเล่น audio ได้
- Pause/Play จากสมาชิกคนหนึ่งสะท้อนที่ TV
- End จากสมาชิกคนหนึ่งเปลี่ยนเพลงถัดไปทุกอุปกรณ์
- เข้าห้องกลางเพลงแล้วตำแหน่งไม่คลาดมากเกินเกณฑ์
- เพลงถัดไปไม่มี AI asset แล้ว fallback Original
- Browser autoplay ถูกบล็อกแล้วแสดงทางแก้ที่ชัดเจน

### Quality tests

- duration output ใกล้ input ตาม threshold
- ไม่มี clipping หรือไฟล์เงียบทั้งเพลง
- sample rate/channels ถูกต้อง
- peak และ loudness อยู่ในช่วงที่เล่นในงาน Karaoke ได้
- ฟังเทียบ Original/AI กับเพลงตัวอย่างทั้งชุด
- ทดสอบเสียงร้องนำ, เสียงประสาน, reverb, rap, เพลง live และเพลงไทยหลายแนว

### Operational tests

- Local cache เต็มแล้วระบบยัง fallback ได้
- Supabase Storage เต็มแล้วระบบยังเล่น Original ได้
- ใช้งาน offline หลังเคย cache ได้
- Vercel Function ไม่รับไฟล์เสียงขนาดใหญ่โดยตรง
- ไม่ปรากฏ service key หรือ signed URL ใน log

## 15. เกณฑ์ยอมรับก่อนเปิดใช้จริง

- เพลงเดิมยังเล่นได้เหมือนเดิมเมื่อไม่เปิด AI mode
- เพลงที่ผ่าน AI มีเสียงร้องลดลงอย่างเห็นได้ชัดในชุดทดสอบ
- ไม่มีการเปลี่ยนเพลงหรือ queue ผิดจากการประมวลผล
- Pause/Play/End ยังเป็นสถานะร่วมของห้อง
- หาก Worker หรือ Supabase ใช้งานไม่ได้ ระบบ fallback เป็น Original ได้
- ไม่มีการดาวน์โหลด YouTube ที่ไม่ได้รับอนุญาต
- ใช้พื้นที่ Shared Cache ตาม quota และมี cleanup
- ทดสอบ TV + มือถืออย่างน้อยสองอุปกรณ์ผ่าน

## 16. ตัวเลือกที่ต้องตัดสินใจก่อนเริ่ม Phase 1

1. Input รุ่นแรกจะเป็นไฟล์ local ที่ผู้ใช้เลือกเองเท่านั้นหรือไม่
2. เครื่อง TV เป็นผู้เล่นเสียงหลักเพียงเครื่องเดียวหรือทุกอุปกรณ์ต้องเล่นเสียง
3. ค่าเริ่มต้นต้องการ `balanced` หรือ `clean_karaoke`
4. ใช้ MP3 เพื่อ compatibility สูงสุด หรือ AAC/Opus เพื่อประหยัดพื้นที่
5. จะเก็บ Shared Cache ทุกเพลง หรือเฉพาะเพลงที่มีการใช้งานซ้ำ

## ข้อเสนอสุดท้าย

เริ่มจาก **Phase 0 และ Phase 1** ก่อน โดยยังไม่แตะ production database และยังไม่ผูกกับ YouTube downloader เมื่อคุณภาพเสียงผ่านแล้วค่อยเพิ่ม Local-first UI จากนั้นจึงเพิ่ม Supabase Shared Cache และ Shared Playback ตามลำดับ

แนวทางนี้ทำให้ระบบเดิมยังใช้งานได้เหมือนเดิม, ไม่บังคับให้ทุกคนติดตั้งโปรแกรม, ใช้ Vercel ต่อได้ และใช้ Supabase เฉพาะเมื่อจำเป็นต้องแชร์ไฟล์ระหว่างอุปกรณ์
