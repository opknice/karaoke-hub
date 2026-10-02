# แผนพัฒนา Vocal Cut สำหรับ `/player` ด้วย Chrome/Edge Extension

สถานะ: แผนงานสำหรับต้นแบบ (Prototype Plan)  
ขอบเขตแพลตฟอร์ม: Windows 10/11, Chrome/Edge รุ่น Chromium 116 ขึ้นไป  
วิธีประมวลผล: Frequency-selective Center Attenuation / Mid-Side DSP  
Cloud cost: ไม่มี  
AI/GPU: ไม่ใช้  
Supabase migration: ไม่มีในระยะแรก  
การ Push/Deploy: ไม่รวมอยู่ในแผนนี้จนกว่าจะได้รับคำสั่งแยกต่างหาก

ความคืบหน้า ณ 1 ตุลาคม 2026:

- สร้าง Manifest V3 Extension และตัวตรวจ manifest แล้ว
- สร้าง tab-capture service worker และ offscreen audio host แล้ว
- สร้าง AudioWorklet Mid/Side DSP, Balanced preset และ Mono protection แล้ว
- เชื่อมหน้า `/player`, ปุ่ม `*`, Badge และ local feedback แล้ว
- เพิ่ม unit tests สำหรับ DSP, bridge และ keyboard shortcut แล้ว
- ผ่าน TypeScript, ESLint, production build และ visual verification ของหน้า `/player`
- รอโหลด Extension แบบ unpacked บน Chrome/Edge จริงเพื่อทดสอบเสียง end-to-end

---

## 1. เป้าหมาย

เพิ่มความสามารถให้เครื่องที่เปิดหน้า `/player` สามารถกดปุ่ม `*` เพื่อสลับระหว่าง:

- `Original` — เสียงต้นฉบับจากแท็บ `/player`
- `Vocal Cut` — เสียงที่ลดองค์ประกอบตรงกลางของ Stereo ซึ่งมักมีเสียงร้องนำ

ทุกอย่างประมวลผลบนเครื่องของผู้ใช้ผ่าน Chrome/Edge Extension โดย:

- ไม่ส่ง audio ขึ้น Server
- ไม่บันทึกไฟล์เพลง
- ไม่ใช้ AI model
- ไม่ใช้ GPU
- ไม่เพิ่มค่าใช้จ่าย Vercel หรือ Supabase
- สลับเสียงได้ทันทีด้วย crossfade เพื่อไม่ให้เกิดเสียงคลิก
- จำผลการใช้งานแยกตาม `youtube_video_id` ไว้ในเครื่อง

ระบบจะไม่เปิด Vocal Cut ให้อัตโนมัติ แม้เพลงนั้นเคยถูกรายงานว่ามีเสียงร้อง ผู้ใช้ต้องเป็นผู้กด `*` เองทุกครั้ง

---

## 2. ข้อจำกัดและเงื่อนไขที่ต้องยอมรับ

### 2.1 DSP ไม่ได้รู้ว่าอะไรคือเสียงคนร้อง

Center Attenuation วิเคราะห์ตำแหน่ง Stereo ไม่ได้จำแนกประเภทเสียง ดังนั้นเสียงที่อยู่ตรงกลาง เช่น:

- Bass
- Kick
- Snare
- Guitar solo
- เครื่องดนตรี Mono

อาจถูกลดไปพร้อมเสียงร้อง

### 2.2 ผลลัพธ์ขึ้นอยู่กับการ Mix ของแต่ละเพลง

เหมาะกับ:

- Lead vocal อยู่ตรงกลาง
- ช่องซ้ายและขวามีความแตกต่างกันเพียงพอ
- เสียงร้องไม่ได้ผ่าน Stereo widening มากเกินไป

ไม่เหมาะกับ:

- เพลง Mono
- ช่องซ้ายและขวาแทบเหมือนกันทั้งหมด
- Vocal ถูกกระจายซ้ายและขวา
- Vocal มี Stereo delay/reverb หนา
- เพลงที่ไม่มีเสียงร้องอยู่แล้ว

### 2.3 ไม่สามารถวิเคราะห์เพลงในคิวล่วงหน้า

YouTube IFrame ให้ข้อมูลการควบคุม Player แต่ไม่ส่ง raw audio ของเพลงในคิวให้เว็บไซต์ จึงวิเคราะห์ได้เฉพาะเพลงที่กำลังเล่นและแท็บถูก Capture แล้วเท่านั้น

แผนนี้จึงใช้แนวทาง:

1. ผู้ใช้ได้ยินว่ามีเสียงร้อง
2. ผู้ใช้กด `*`
3. Extension เปิด Vocal Cut ทันที
4. ผู้ใช้ให้ผลตอบรับว่า `ใช้ได้ดี`, `พอใช้` หรือ `ใช้ไม่ได้`
5. Extension จำผลตาม `youtube_video_id` เพื่อแจ้งเตือนในการเล่นครั้งถัดไป

### 2.4 YouTube policy เป็น Release Gate

YouTube Developer Policies ระบุว่า API Client ต้องไม่แยก ดัดแปลง หรือใช้ audio/video component ของ YouTube ในลักษณะที่นโยบายห้ามไว้

ดังนั้น:

- ต้นแบบต้องถือว่าเป็น Technical Prototype เท่านั้น
- ห้ามเปิดใช้บน Production หรือเผยแพร่ใน Extension Store จนกว่าจะตรวจสอบเงื่อนไขการใช้งานและได้รับความชัดเจนด้าน compliance
- ถ้าจะเปิดให้ผู้ใช้ทั่วไป ต้องพิจารณาขอ YouTube API Compliance Audit ก่อน
- ตัว Extension ต้องไม่บันทึก ดาวน์โหลด หรือส่งต่อ audio
- ตัว Extensionต้องไม่รบกวนโฆษณา การนับ view หรือ UI มาตรฐานของ YouTube Player

เอกสารอ้างอิง: [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

---

## 3. คำตัดสินทางสถาปัตยกรรม

เลือกใช้ Chrome/Edge Extension แบบ Manifest V3 แทน Windows EXE ในระยะแรก

เหตุผล:

- `chrome.tabCapture` รับเสียงเฉพาะแท็บ `/player` ได้
- เมื่อ Capture เริ่มทำงาน เสียงจากแท็บจะไม่ถูกส่งตรงไปยังผู้ใช้ ทำให้ Extension สามารถส่งเฉพาะเสียงที่ผ่าน DSP ออกลำโพงได้โดยไม่เกิดเสียงซ้อน
- ไม่ต้องติดตั้ง Virtual Audio Driver
- ไม่ดักเสียงจากโปรแกรมอื่นใน Windows
- ไม่ต้องใช้ WASAPI หรือ driver ที่มีความซับซ้อน
- AudioWorklet เหมาะสำหรับ DSP ที่ต้องทำต่อเนื่องบน audio rendering thread
- Chrome 116 ขึ้นไปรองรับการนำ stream ID จาก service worker ไปใช้ใน offscreen document

เอกสารอ้างอิง:

- [Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Manifest V3 tabCapture improvements](https://developer.chrome.com/docs/extensions/develop/migrate/known-issues)

---

## 4. ภาพรวมการทำงาน

```text
ผู้ใช้เปิด /player
        │
        │ กดไอคอน Extension เพื่อเริ่ม Capture
        ▼
Manifest V3 Service Worker
        │
        │ สร้าง stream ID และ offscreen document
        ▼
Offscreen Audio Document
        │
        ├── MediaStream จากแท็บ /player
        ├── Dry path: Original
        ├── Wet path: Center Attenuation AudioWorklet
        ├── Equal-power crossfade
        ├── Limiter / output protection
        └── AudioContext.destination → ลำโพง

/player Client Component
        │
        ├── ส่ง youtube_video_id ปัจจุบัน
        ├── รับสถานะ Extension
        ├── รับปุ่ม * / NumpadMultiply
        ├── แสดง VOCAL CUT: ON/OFF
        └── แสดงปุ่มรายงานผล
```

---

## 5. ส่วนประกอบของระบบ

### 5.1 Extension Service Worker

หน้าที่:

- รับการกดไอคอน Extension จากผู้ใช้
- ตรวจว่าแท็บปัจจุบันคือ `/player` ของ origin ที่อนุญาต
- ขอ stream ID ผ่าน `chrome.tabCapture`
- สร้าง offscreen document หากยังไม่มี
- ส่ง stream ID ไปยัง offscreen document
- เก็บ lifecycle state ของการ Capture
- เปลี่ยน Extension badge เช่น `ON`, `OFF`, `ERR`
- หยุด Capture เมื่อแท็บถูกปิดหรือผู้ใช้สั่งหยุด

Service worker ไม่ควรถือ `AudioContext` เพราะ lifecycle ของ Manifest V3 service worker ไม่ถาวร

### 5.2 Offscreen Audio Document

หน้าที่:

- เปิด MediaStream จาก stream ID
- สร้าง `AudioContext`
- โหลด AudioWorklet
- สร้าง Dry/Wet graph
- รับคำสั่งเปิด/ปิด Vocal Cut
- ทำ crossfade
- คำนวณสถานะ Stereo/Mono เบื้องต้น
- ส่ง health/status กลับ service worker
- ปล่อยทรัพยากรทั้งหมดเมื่อ Capture หยุด

เหตุผลสำหรับ offscreen document:

- Service worker ไม่มี DOM และไม่เหมาะกับ audio graph ต่อเนื่อง
- offscreen document รองรับ `getUserMedia`, audio playback และ AudioContext
- กำหนด reason เป็น `USER_MEDIA` และ `AUDIO_PLAYBACK` ตามความจำเป็นของ implementation

### 5.3 AudioWorklet

หน้าที่:

- รับ PCM Stereo แบบต่อเนื่อง
- แปลง Left/Right เป็น Mid/Side
- ลด Mid ตาม preset
- สร้าง Stereo output ใหม่
- ป้องกัน discontinuity ตอนเปลี่ยนค่าพารามิเตอร์
- ส่งค่า meter ที่จำเป็นกลับ main audio context ในอัตราต่ำ เพื่อไม่เพิ่มภาระ message

ไม่ควรทำใน React render loop หรือ service worker

### 5.4 Content Script

หน้าที่:

- ทำงานเฉพาะ URL `/player`
- เป็นสะพานสื่อสารระหว่างหน้าเว็บกับ Extension
- รับ `youtube_video_id` และ track-change event จากหน้าเว็บ
- ส่งสถานะ Extension กลับหน้าเว็บ
- รับคำสั่ง toggle/rating จากหน้าเว็บ
- ตรวจสอบ origin และ message schema ทุกครั้ง

Content script ไม่ต้องอ่านหรือแก้ DOM ของ YouTube iframe

### 5.5 Next.js `/player`

หน้า `/player` ปัจจุบันเป็น Client Component อยู่แล้ว จึงสามารถใช้ browser event และ bridge state ได้โดยไม่ต้องย้าย audio logic ไป Server Component

หน้าที่ที่เพิ่ม:

- Extension handshake
- ส่ง video ID ปัจจุบัน
- แสดงสถานะ Extension
- จัดการ hotkey `*`
- แสดง Badge `VOCAL CUT: ON/OFF`
- แสดงคำเตือนกรณี Extension ไม่ได้ติดตั้งหรือยังไม่ Capture
- แสดง rating หลังผู้ใช้เปิด Vocal Cut

ตัวหน้าเว็บจะไม่รับหรือประมวลผล PCM โดยตรง การประมวลผลทั้งหมดอยู่ใน Extension

---

## 6. โครงสร้างไฟล์เป้าหมาย

โครงสร้างโดยประมาณ:

```text
browser-extension/
├── manifest.json
├── src/
│   ├── service-worker.ts
│   ├── content-script.ts
│   ├── messages.ts
│   ├── storage.ts
│   ├── offscreen/
│   │   ├── index.html
│   │   └── audio-host.ts
│   └── worklets/
│       └── center-attenuation-processor.ts
├── tests/
│   ├── center-attenuation.test.ts
│   ├── storage.test.ts
│   └── messaging.test.ts
└── README.md

src/
├── components/
│   └── PlayerVocalCutStatus.tsx
├── hooks/
│   └── useVocalCutExtension.ts
├── lib/
│   ├── player-keyboard.ts
│   └── vocal-cut-messages.ts
└── app/player/page.tsx
```

ชื่อและตำแหน่งสุดท้ายให้ปรับตาม build tooling ที่เลือก แต่ Extension ต้องแยกขอบเขตจาก Next.js production bundle อย่างชัดเจน

---

## 7. Audio Pipeline

### 7.1 Dry/Wet Graph

```text
Tab MediaStream
      │
      ├── Dry Gain ───────────────────────────┐
      │                                       │
      └── AudioWorklet → Wet Gain ────────────┤
                                              ▼
                                      Output protection
                                              │
                                              ▼
                                         Speakers
```

สถานะ:

- Vocal Cut OFF: Dry = 1, Wet = 0
- Vocal Cut ON: Dry = 0, Wet = 1
- ระหว่างสลับ: equal-power crossfade 30–80 ms

ห้าม disconnect/connect graph ทุกครั้งที่กด `*` เพราะอาจทำให้เกิดเสียง click หรือ audio gap ให้เปลี่ยน gain ของ graph ที่เชื่อมอยู่แล้ว

### 7.2 Mid/Side DSP

```text
Mid  = (Left + Right) / 2
Side = (Left - Right) / 2

ProcessedMid = Mid × attenuation(frequency)

OutputLeft  = ProcessedMid + Side
OutputRight = ProcessedMid - Side
```

### 7.3 Balanced Preset

ค่าเริ่มต้นต้องเป็น Frequency-selective Center Attenuation ไม่ใช่ Hard `L-R`

แนวทางตั้งต้นสำหรับการทดลอง:

- ย่านต่ำ: รักษา Center ไว้มากเพื่อไม่ให้ Bass/Kick หาย
- ย่านเสียงร้อง: ลด Center มากที่สุด
- ย่านสูง: ลด Center ปานกลางเพื่อรักษาความใส
- รักษา Side ไว้
- ปรับ output gain และ limiter เพื่อป้องกัน clipping

ค่าความถี่และ attenuation จริงห้ามถือเป็นค่าตายตัว ต้องหาโดยการฟังและวัดจากชุดทดสอบหลายประเภท

### 7.4 Presets

ระยะแรกเตรียม preset ภายในไว้ 3 แบบ:

1. `Balanced`
   - ค่าเริ่มต้น
   - ลดเสียงร้องโดยรักษาดนตรีให้มากที่สุด

2. `Strong`
   - ลด Mid มากกว่า Balanced
   - ใช้เมื่อเสียงร้องยังชัด

3. `Hard Cancel`
   - ใกล้เคียง Side-only
   - เป็นทางเลือกสุดท้าย
   - ต้องมีคำเตือนเรื่องเสียงบางและ Mono

หน้า `/player` ระยะแรกใช้ `Balanced` เท่านั้น ปุ่ม `*` มีหน้าที่ ON/OFF เพื่อให้ UX ง่าย ส่วน preset selector เพิ่มภายหลังเมื่อ Balanced ผ่านการทดสอบแล้ว

### 7.5 Mono Protection

AudioWorklet ต้องประเมินอย่างน้อย:

- Channel correlation
- Mid energy
- Side energy
- Side-to-total ratio

ถ้า input เป็น Mono หรือ Side ต่ำเกินไป:

- ไม่เปิด Hard Cancel
- คืนเสียง Original
- แสดง `ใช้ Vocal Cut ไม่ได้กับเพลงนี้`
- ให้ผู้ใช้รายงาน `ใช้ไม่ได้`

Threshold ต้องมาจากชุดทดสอบ ไม่กำหนดจากการคาดเดา

---

## 8. พฤติกรรมปุ่ม `*`

รองรับ:

- `event.key === '*'`
- `event.code === 'NumpadMultiply'`
- Layout คีย์บอร์ดไทยและอังกฤษ

ไม่รับ hotkey เมื่อ:

- Focus อยู่ใน `input`
- Focus อยู่ใน `textarea`
- Focus อยู่ใน `select`
- Element มี `contenteditable`
- กำลังกด Ctrl, Alt หรือ Meta
- หน้าไม่ได้อยู่ใน `/player`
- ยังไม่มีเพลงกำลังเล่น

พฤติกรรม:

```text
Extension ไม่ติดตั้ง
→ แสดงคำแนะนำติดตั้ง

ติดตั้งแล้วแต่ยังไม่ Capture
→ แจ้งให้กดไอคอน Extension เพื่อเริ่มระบบเสียง

Capture พร้อม + Vocal Cut OFF
→ กด * → Crossfade ไป Balanced → แสดง ON

Capture พร้อม + Vocal Cut ON
→ กด * → Crossfade กลับ Original → แสดง OFF

เพลงเปลี่ยน
→ Reset เป็น Original เสมอ
```

ต้องเรียก `preventDefault()` และ `stopPropagation()` เฉพาะเมื่อ Extension พร้อมรับคำสั่งและ hotkey ถูกใช้จริง เพื่อไม่ทำลาย keyboard behavior อื่นของหน้า

---

## 9. สถานะและ Message Protocol

### 9.1 สถานะของ Extension ในหน้า `/player`

```text
not_installed
installed_idle
activation_required
starting
capturing_original
capturing_vocal_cut
unsupported_mono
recovering
error
```

### 9.2 Message ขั้นต่ำ

จากหน้าเว็บไป Extension:

```text
PLAYER_HELLO
TRACK_CHANGED
TOGGLE_VOCAL_CUT
SET_VOCAL_CUT
SUBMIT_VOCAL_CUT_RESULT
REQUEST_STATUS
```

จาก Extension ไปหน้าเว็บ:

```text
EXTENSION_READY
CAPTURE_STATUS
VOCAL_CUT_STATUS
AUDIO_CAPABILITY
STORED_VIDEO_PREFERENCE
ERROR
```

ทุก message ต้องมี:

- `version`
- `type`
- `requestId` เมื่อมี request/response
- payload ที่ validate แล้ว

ห้ามยอมรับ message ที่ไม่ตรง schema หรือมาจาก origin ที่ไม่อนุญาต

---

## 10. Local Storage Model

ใช้ `chrome.storage.local` เป็น source of truth เพราะข้อมูลเป็นของ Extension และไม่ควรผูกกับ cache ของเว็บไซต์

โครงสร้างตัวอย่าง:

```ts
type VocalCutResult = 'good' | 'fair' | 'bad';
type VocalPresence = 'unknown' | 'reported_present' | 'reported_absent';

interface VideoVocalCutPreference {
  schemaVersion: 1;
  youtubeVideoId: string;
  vocalPresence: VocalPresence;
  lastResult: VocalCutResult | null;
  lastPreset: 'balanced' | 'strong' | 'hard';
  usageCount: number;
  updatedAt: string;
}
```

กฎสำคัญ:

- ไม่เก็บ audio samples
- ไม่เก็บ YouTube access token
- ไม่เก็บ browsing history นอก `/player`
- จำกัด host permissions เฉพาะ localhost และ production domain ที่ใช้จริง
- ไม่ใช้ `<all_urls>`
- ไม่เปิด Vocal Cut อัตโนมัติจากข้อมูลที่จำไว้
- ข้อมูลที่จำไว้ใช้เพื่อแสดงคำแนะนำเท่านั้น

---

## 11. UX บน `/player`

### 11.1 Badge

แสดงมุมที่ไม่ทับ YouTube controls:

- `AUDIO EXTENSION: OFF`
- `AUDIO EXTENSION: READY`
- `VOCAL CUT: ON`
- `VOCAL CUT: UNSUPPORTED`
- `AUDIO ERROR`

เมื่อเปิด Vocal Cut ควรแสดงชัดเจนอย่างน้อย 2–3 วินาที และคงสถานะขนาดเล็กไว้ตลอด

### 11.2 Feedback

หลังเปิด Vocal Cut และฟังไประยะหนึ่ง แสดงตัวเลือกแบบไม่รบกวน:

- `ใช้ได้ดี`
- `พอใช้`
- `ใช้ไม่ได้`

ผลถูกเก็บในเครื่องเท่านั้น

### 11.3 Previous Result

เมื่อเพลงเดิมกลับมาเล่น:

```text
เพลงนี้เคยใช้ Vocal Cut
ผลครั้งก่อน: พอใช้
กด * เพื่อเปิด
```

ต้องไม่ auto-enable

### 11.4 Recovery UX

ถ้า Extension หรือ AudioWorklet ล้มเหลว:

1. พยายามกลับ Original path
2. ถ้าทำไม่ได้ ให้หยุด Capture เพื่อคืนเสียงให้แท็บ
3. แสดงข้อความสั้นที่ผู้ใช้แก้ได้ เช่น `คลิก Extension เพื่อเชื่อมต่อเสียงใหม่`

ห้ามปล่อยให้ภาพเล่นต่อแต่เสียงเงียบโดยไม่มีคำเตือน

---

## 12. ขั้นตอนพัฒนา

### Phase 0 — Policy และ Technical Gate

งาน:

- ยืนยันว่า Prototype ใช้เพื่อทดสอบภายในเท่านั้น
- ตรวจ YouTube policies และ Extension Store policies ก่อนเผยแพร่
- ระบุ localhost URL และ production domain ที่อนุญาต
- กำหนด Chrome/Edge minimum version
- ยืนยันว่าไม่มี audio recording หรือ download

ผ่านเมื่อ:

- Scope ถูกล็อกว่าเป็น real-time DSP เท่านั้น
- มีคำตัดสินชัดเจนว่าจะทดสอบภายในหรือขอ compliance review ก่อน Production

### Phase 1 — Tab Capture Spike

งาน:

- สร้าง Manifest V3 Extension ขั้นต่ำ
- เริ่ม Capture จาก extension action
- สร้าง offscreen document
- รับ MediaStream เฉพาะแท็บ `/player`
- ต่อเสียงแบบ passthrough ไปลำโพง
- Stop/restart Capture ได้
- ทดสอบ Chrome และ Edge

ผ่านเมื่อ:

- ไม่มีเสียงซ้อน
- Original audio ไม่เปลี่ยนคุณภาพอย่างสังเกตได้
- ปิด Extension แล้วเสียงแท็บกลับมาปกติ
- เปลี่ยนเพลงและ fullscreen แล้ว Capture ยังอยู่
- ปิดแท็บแล้วทรัพยากรถูกปล่อย

### Phase 2 — DSP Spike

งาน:

- เพิ่ม Mid/Side processor
- เพิ่ม Balanced preset
- เพิ่ม Dry/Wet graph
- เพิ่ม crossfade
- เพิ่ม output limiter
- เพิ่ม Mono protection
- เก็บค่าทางเทคนิค เช่น correlation/side energy เพื่อ debug เฉพาะในเครื่อง

ผ่านเมื่อ:

- สลับ Original/Vocal Cut ไม่มี click หรือ gap ที่ได้ยินชัด
- Center test signal ถูกลดตามเป้าหมาย
- Side test signal ยังอยู่
- Mono input ถูก bypass อย่างปลอดภัย
- ไม่มี clipping จากการ reconstruct stereo

### Phase 3 — `/player` Integration

งาน:

- เพิ่ม extension handshake
- เพิ่ม message schema และ validation
- ส่ง `youtube_video_id` เมื่อเพลงเปลี่ยน
- เพิ่ม shortcut `*` และ `NumpadMultiply`
- ป้องกัน shortcut ขณะพิมพ์ค้นหา
- เพิ่ม Badge และ error state
- Reset Vocal Cut เมื่อเปลี่ยนเพลง

ผ่านเมื่อ:

- ปุ่ม `*` ทำงานเฉพาะ `/player`
- Search input พิมพ์ `*` ได้โดยไม่ toggle
- เพลงเปลี่ยนแล้วกลับ Original
- เมื่อ Extension ไม่พร้อม ผู้ใช้ได้รับคำแนะนำที่ถูกต้อง

### Phase 4 — Preference และ Feedback

งาน:

- เพิ่ม `chrome.storage.local`
- บันทึกผลตาม video ID
- แสดงผลครั้งก่อน
- เพิ่ม `ใช้ได้ดี`, `พอใช้`, `ใช้ไม่ได้`
- เพิ่ม schema version และ migration สำหรับ storage
- เพิ่มปุ่มล้างข้อมูลทั้งหมด

ผ่านเมื่อ:

- Reload browser แล้วยังอ่านค่าเดิมได้
- ล้างข้อมูลแล้วกลับค่าเริ่มต้น
- ไม่มีข้อมูลเพลงอื่นนอกจากเพลงที่ผู้ใช้ใช้ Vocal Cut หรือให้ feedback
- ไม่มีการเปิด Vocal Cut อัตโนมัติ

### Phase 5 — Quality Tuning

งาน:

- สร้างชุดทดสอบที่ไม่ละเมิดลิขสิทธิ์หรือสร้างสัญญาณสังเคราะห์
- ทดสอบเพลง Stereo centered vocal
- ทดสอบ vocal พร้อม reverb
- ทดสอบ Mono
- ทดสอบ Karaoke ที่ไม่มี vocal
- ทดสอบเพลงที่ Bass/Kick อยู่กลาง
- ปรับ frequency bands, attenuation และ limiter
- ตัดสินใจว่าจะเพิ่ม Strong preset หรือไม่

ผ่านเมื่อ:

- Balanced ช่วยลดเสียงร้องในชุดทดสอบส่วนใหญ่ที่เข้าเงื่อนไข
- ความเสียหายต่อดนตรีอยู่ในระดับยอมรับได้ตาม listening test
- เพลง Mono ไม่กลายเป็นเสียงเงียบ
- เพลงไม่มี vocal สามารถกลับ Original ได้ทันที

### Phase 6 — Packaging และ Release Gate

งาน:

- สร้าง production build ของ Extension
- ตรวจ permissions และ Content Security Policy
- ทำคู่มือติดตั้ง Chrome/Edge
- ทำ onboarding: เปิด `/player` → คลิก Extension → Capture พร้อม
- ตรวจ privacy disclosure
- ตรวจ policy/compliance ก่อนเผยแพร่
- ตัดสินใจ distribution: unpacked/internal, enterprise install หรือ Extension Store

ผ่านเมื่อ:

- Build ไม่มี development permission ที่เกินจำเป็น
- ไม่มี remote code execution หรือ script จากภายนอก
- Permission มีเฉพาะที่จำเป็น
- ผ่าน manual test บน Chrome และ Edge
- ได้รับคำตัดสินด้าน policy ก่อน Production

---

## 13. Testing Strategy

### 13.1 Unit Tests

DSP fixtures แบบสังเคราะห์:

- Signal เหมือนกันทั้ง L/R → ตรวจ Center attenuation
- Signal อยู่เฉพาะ L → ตรวจ Side preservation
- Signal อยู่เฉพาะ R → ตรวจ Side preservation
- Mono full mix → ตรวจ auto bypass
- Impulse ระหว่าง toggle → ตรวจ discontinuity/click
- Full-scale signal → ตรวจ limiter/clipping

Keyboard tests:

- `*` toggle
- `NumpadMultiply` toggle
- Input/textarea/contenteditable ไม่ toggle
- Ctrl/Alt/Meta combinations ไม่ toggle
- Shortcut อื่นเดิมยังทำงาน

Storage tests:

- อ่าน/เขียน preference
- schema migration
- invalid record recovery
- clear all data

Message tests:

- valid origin
- invalid origin
- malformed payload
- duplicate request
- stale response หลังเปลี่ยนเพลง

### 13.2 Integration Tests

- Extension activate/deactivate
- Offscreen document lifecycle
- Refresh `/player`
- เปลี่ยนเพลง
- Pause/Play
- Fullscreen
- เปิด/ปิด Search Overlay
- ปิดแท็บระหว่าง Capture
- Audio device เปลี่ยนระหว่างเล่น
- AudioContext ถูก suspend/resume
- Extension reload ระหว่างเพลง

### 13.3 Listening Test Matrix

แต่ละเพลงให้ผู้ทดสอบเทียบ:

- Original
- Balanced
- Strong ถ้ามี
- Hard Cancel ถ้ามี

คะแนน:

- การลดเสียงร้อง
- ความเสียหายต่อ Bass/Kick
- ความชัดของเครื่องดนตรี
- Stereo image
- เสียงแปลก/phasey
- ระดับเสียงโดยรวม
- ความเหมาะสมสำหรับร้อง Karaoke

---

## 14. Performance Targets

เป้าหมายต้องวัดบนเครื่อง Windows อย่างน้อยระดับต่ำ กลาง และสูง

- กด `*` แล้วเริ่ม crossfade ทันทีใน audio graph ที่ทำงานอยู่
- ไม่มีการสร้าง AudioContext ใหม่ตอน toggle
- ไม่มี network call ตอน toggle
- ไม่มี React render loop ใน audio processing
- ไม่มี dropped audio block ต่อเนื่อง
- ไม่มี clipping
- CPU usage คงที่และเหมาะกับการเปิดหลายชั่วโมง
- memory ไม่เพิ่มต่อเนื่องหลังเปลี่ยนเพลง

ไม่ล็อกตัวเลข latency หรือ CPU จนกว่าจะผ่าน Phase 1–2 เพราะค่าจริงขึ้นกับ audio device, browser และ buffer ของแต่ละเครื่อง

---

## 15. Fail-safe Rules

- ค่าเริ่มต้นทุกเพลงคือ Original
- ถ้า message ขาดหาย ให้คง Original
- ถ้า AudioWorklet error ให้ crossfade กลับ Original
- ถ้า input ไม่ใช่ Stereo ให้ Original
- ถ้า Side ต่ำจน Vocal Cut เสี่ยงทำให้เสียงหาย ให้ Original
- ถ้า Extension disconnect ให้หน้า `/player` แสดงสถานะทันที
- ถ้า offscreen document หยุด ให้ service worker ทำ recovery ได้หนึ่งครั้ง ก่อนคืน Original/หยุด Capture
- ห้ามทำให้ queue, pause, play หรือ end song ล้มเหลวเพราะ Vocal Cut
- Vocal Cut ต้องเป็น optional enhancement และถอดออกได้โดยไม่กระทบ Player หลัก

---

## 16. สิ่งที่ไม่ทำในเวอร์ชันแรก

- AI vocal separation
- การประมวลผลเพลงในคิวล่วงหน้า
- การดาวน์โหลดหรือบันทึก audio
- Supabase shared rating
- เปิด Vocal Cut อัตโนมัติ
- Mobile support
- Firefox/Safari support
- Windows EXE
- Virtual Audio Driver
- Background YouTube player
- การแทรกหรือแก้ DOM ภายใน YouTube iframe

---

## 17. Go/No-Go Criteria

ดำเนินการต่อจาก Prototype ได้เมื่อ:

- Tab Capture มีเสียงปกติและไม่ซ้อน
- Toggle ไม่มีเสียง click/gap ที่รบกวน
- Balanced preset มีประโยชน์จริงกับเพลงตัวอย่าง
- Mono protection ทำงาน
- Extension failure ไม่ทำให้ Player หลักหยุดทำงาน
- Chrome และ Edge ให้ผลใกล้เคียงกัน
- มีคำตัดสินด้าน YouTube policy/compliance ที่ยอมรับได้สำหรับรูปแบบการเผยแพร่

หยุดหรือเปลี่ยนแนวทางเมื่อ:

- เสียงจาก YouTube/Browser ไม่สามารถ Capture ได้อย่างเสถียร
- ผลลัพธ์ทำลายดนตรีมากกว่าเสียงร้องที่ลดลง
- latency หรือ audio dropout รบกวนการร้อง
- จำเป็นต้องขอ permission กว้างเกินขอบเขต
- ไม่สามารถผ่านข้อกำหนด YouTube/Extension Store สำหรับ Production

---

## 18. Definition of Done สำหรับต้นแบบ

ต้นแบบถือว่าเสร็จเมื่อ:

1. ติดตั้ง Extension แบบ unpacked บน Chrome และ Edge ได้
2. ผู้ใช้กดไอคอน Extension หนึ่งครั้งเพื่อเริ่ม Capture
3. เสียง Original ออกลำโพงโดยไม่ซ้อน
4. กด `*` หรือ Numpad `*` แล้วสลับ Vocal Cut ได้
5. สลับกลับ Original ได้ทันที
6. ไม่มี click/gap ที่รบกวน
7. กำลังพิมพ์ใน Search แล้ว `*` ไม่สั่ง Vocal Cut
8. เพลงเปลี่ยนแล้ว Vocal Cut กลับ OFF
9. Mono input ถูก bypass
10. หน้า `/player` แสดงสถานะถูกต้อง
11. Feedback ถูกจำตาม video ID ใน `chrome.storage.local`
12. ไม่มี audio ถูกบันทึกหรือส่งออกจากเครื่อง
13. Queue และ shared playback เดิมยังทำงานเหมือนเดิม
14. Test suite และ manual test matrix ผ่าน

---

## 19. ลำดับการลงมือที่แนะนำ

ลำดับที่ลดความเสี่ยงที่สุด:

```text
Policy Gate
  → Tab Capture passthrough
  → AudioWorklet Mid/Side
  → Dry/Wet crossfade
  → Mono protection
  → /player handshake
  → ปุ่ม * และ Badge
  → Local preference/feedback
  → Quality tuning
  → Chrome/Edge QA
  → Release decision
```

ห้ามเริ่มจากการแก้หน้า `/player` ก่อนที่ Tab Capture passthrough จะผ่าน เพราะความเสี่ยงหลักอยู่ที่เส้นทางเสียงและ lifecycle ของ Extension ไม่ใช่ UI

---

## 20. สรุป

แนวทางนี้เหมาะสำหรับสร้างต้นแบบ Vocal Cut ที่:

- ตอบสนองทันที
- ใช้ทรัพยากรต่ำ
- ประมวลผลในเครื่อง
- ไม่ใช้ AI/GPU
- ไม่เพิ่มค่า Cloud
- ไม่ต้องติดตั้ง Virtual Audio Driver

หัวใจของระบบคือ Chrome/Edge Extension ที่รับเสียงเฉพาะแท็บ `/player`, ประมวลผลด้วย Frequency-selective Mid/Side DSP ใน AudioWorklet และสลับ Original/Processed ด้วย crossfade

ข้อจำกัดสำคัญที่สุดยังคงเป็นคุณภาพที่ขึ้นกับ Stereo mix และ YouTube policy ดังนั้นต้องผ่าน Technical Prototype และ Compliance Gate ก่อนพิจารณา Production
