# แผนเพิ่ม Auto Loudness Normalize สำหรับ `/player`

> อัปเดตทิศทาง 1 ตุลาคม 2026: ใช้แผน [Song Loudness Profiles บน Supabase](./song-loudness-profiles.md) เป็นแผนหลักสำหรับงานถัดไป ตามความต้องการเก็บข้อมูลก่อนและชดเชยด้วย gain เดียวทั้งเพลง เอกสารด้านล่างเป็นประวัติระบบ streaming รุ่นแรก; ข้อเสนอ local-only profile และ slow gain riding ไม่ใช่แนวทางหลักของรุ่นใหม่ การเพิ่มบันทึกนี้ยังไม่เปลี่ยนพฤติกรรมระบบจริง

สถานะ: พัฒนา Phase 1–3 แล้ว รอ Reload Extension และทดสอบเสียงจริง  
ขอบเขต: Chrome/Edge Extension ที่ Capture เสียงของแท็บ `/player`  
วิธีประมวลผล: Streaming loudness estimation + slow gain riding + output limiter  
Cloud cost: ไม่มี  
Supabase migration: ไม่มี  
การอัปโหลดเสียง: ไม่มี — เสียงอยู่ใน browser audio graph เท่านั้น

ความคืบหน้า ณ 1 ตุลาคม 2026:

- เพิ่ม K-weighted LUFS-like meter, silence gate และ slow gain controller แล้ว
- เพิ่ม Loudness Normalizer AudioWorklet และ safety limiter แล้ว
- เชื่อม Volume/Mute เพื่อไม่ให้ Auto Level ปรับสวนผู้ใช้แล้ว
- เพิ่ม toggle, telemetry และ local preference ที่หน้า `/player` แล้ว
- เพิ่ม backward-compatible capability detection สำหรับ Extension รุ่นเก่าแล้ว
- เพิ่ม unit tests สำหรับ loud/quiet/silence/Volume compensation/reset แล้ว
- ผ่าน unit tests, Extension verification, ESLint, production build และ browser smoke test
- ยังต้อง Reload unpacked Extension และฟังเทียบเพลงจริงเพื่อทำ Phase 4 calibration

---

## 1. เป้าหมาย

ทำให้ความดังที่รับรู้ได้ของเพลงต่าง ๆ ใกล้เคียงกัน โดย:

- ลดเพลงที่มาสเตอร์มาดังเกินไป
- เพิ่มเพลงที่เบาเกินไปอย่างมีเพดาน
- ไม่ทำให้ช่วงเงียบหรืออินโทรถูกเร่งขึ้นรุนแรง
- ไม่เกิดเสียงกระชากเมื่อเริ่มเพลง เปลี่ยนเพลง หรือสลับ Vocal Cut
- คงให้ Volume และ Mute เดิมของผู้ใช้เป็น Master volume
- ทำงานได้ทั้งตอนเปิดและปิด Vocal Cut
- ประมวลผลภายในเครื่อง ไม่บันทึกหรือส่ง PCM audio ออกไป

ระบบนี้เป็น loudness levelling สำหรับการเล่นสด ไม่ใช่การ remaster เพลง และไม่รับประกันค่า LUFS ที่ใช้รับรองงาน Broadcast

---

## 2. ข้อเท็จจริงของระบบปัจจุบัน

- YouTube เล่นอยู่ภายใน cross-origin iframe เว็บไซต์จึงอ่าน raw audio โดยตรงไม่ได้
- IFrame API ควบคุมได้เฉพาะ Volume/Mute แต่ไม่มี API สำหรับเปิด Stable volume
- Extension มีเส้นทาง `tabCapture → AudioWorklet → AudioContext.destination` อยู่แล้ว
- AudioWorklet ปัจจุบันวิเคราะห์ Stereo และทำ Vocal Cut แต่ยังไม่มี loudness meter, gain controller หรือ limiter
- ตอนเริ่ม capture มีการขอปิด `autoGainControl` ของ MediaStream เพื่อไม่ให้ browser ปรับเสียงซ้อนเอง
- Volume เดิมของ Player ถูกปรับภายใน YouTube iframe ก่อนเสียงเข้าสู่ Extension

ดังนั้น Auto Loudness ต้องอยู่ใน Extension และต้องรู้ค่า Volume/Mute ปัจจุบันจากหน้า Player เพื่อไม่ให้ระบบเร่งเสียงกลับเมื่อผู้ใช้ตั้งใจลด Volume

---

## 3. คำตัดสินทางสถาปัตยกรรม

### 3.1 Audio graph

ใช้ graph ต่อไปนี้:

```text
YouTube iframe
  → tabCapture
  → Center Attenuation AudioWorklet
  → Loudness Normalizer AudioWorklet
  → Safety Limiter (DynamicsCompressorNode)
  → AudioContext.destination
```

เหตุผลที่ Normalize หลัง Vocal Cut:

- Vocal Cut อาจลดพลังงานรวมของเพลง
- ผู้ใช้ควรได้ความดังปลายทางใกล้เคียงกันทั้งโหมด Original และ Vocal Cut
- เมื่อสลับ Vocal Cut ระบบจะ reset measurement และ ramp gain ใหม่อย่างนุ่มนวล

### 3.2 แยก Normalizer ออกจาก Vocal Cut

สร้าง `loudness-normalizer-processor.js` แยกจาก `center-attenuation-processor.js` เพื่อ:

- ทดสอบและ bypass แต่ละระบบได้อิสระ
- ลดความเสี่ยงต่อ DSP Vocal Cut ที่ทำงานอยู่แล้ว
- ทำให้ Normalizer ใช้ได้แม้ Vocal Cut ปิด
- แยก telemetry และ error diagnosis ได้ชัดเจน

### 3.3 Volume เดิมยังเป็น Master volume

ไม่ย้าย Volume slider ไปควบคุม GainNode และไม่บังคับ YouTube ให้เล่นที่ 100 เพราะถ้า Extension หยุดกะทันหันอาจเกิดเสียงดังพุ่ง

หน้า Player จะส่งค่า `volume` และ `muted` ไป Extension ทุกครั้งที่เปลี่ยนค่า Normalizer จะคำนวณระดับต้นฉบับโดยหัก attenuation ของ Player ออกจากค่าที่วัดได้:

```text
sourceLoudnessDb ≈ measuredLoudnessDb - 20 × log10(playerVolume / 100)
normalizationGainDb = targetLoudnessDb - sourceLoudnessDb
```

ผลคือ:

- ผู้ใช้ลด Volume แล้วเสียงปลายทางลดตามจริง
- Normalizer ไม่ตีความการลด Volume ว่าเพลงเบาและเร่งกลับ
- เมื่อ Mute หรือ Volume ต่ำกว่าเกณฑ์ ระบบหยุดปรับ gain ชั่วคราว

---

## 4. Algorithm รุ่นแรก

### 4.1 การวัด

- ใช้ Stereo energy หลัง Vocal Cut
- เพิ่ม K-weighting แบบ lightweight เพื่อให้ใกล้เคียง perceived loudness มากกว่า RMS ตรง ๆ
- คำนวณ momentary window ประมาณ 400 ms
- สะสม short-term estimate ประมาณ 3 วินาที
- ส่ง telemetry กลับ main thread ไม่เกิน 2 ครั้งต่อวินาที
- ใช้ absolute gate ประมาณ `-50 dBFS/LUFS-like` เพื่อไม่เร่งช่วงเงียบ

ชื่อใน UI และ log ใช้ `LUFS-like` จนกว่าจะผ่าน reference-vector verification ตาม ITU-R BS.1770 ห้ามแสดงว่าเป็น LUFS ที่ได้รับการรับรอง

### 4.2 ค่าเริ่มต้นสำหรับทดลอง

- Target: `-16 LUFS-like`
- Maximum boost: `+8 dB`
- Maximum attenuation: `-12 dB`
- Warm-up หลังเปลี่ยนเพลง: `2.5–3 วินาที`
- ลด gain เมื่อเพลงดัง: ประมาณ `0.5–1 วินาที`
- เพิ่ม gain เมื่อเพลงเบา: ประมาณ `4–6 วินาที`
- Gain update จำกัด step ต่อช่วงเวลา เพื่อป้องกัน pumping
- Silence hold: คง gain เดิม ไม่ไล่เพิ่มหา target

ค่าทั้งหมดต้องรวมอยู่ใน preset/config object เดียวเพื่อปรับจากผลทดสอบได้โดยไม่กระจาย magic numbers

### 4.3 Limiter

ใช้ `DynamicsCompressorNode` เป็น safety limiter หลัง Normalizer:

- Threshold ใกล้ `-1 dBFS`
- Knee ต่ำ
- Ratio สูง
- Attack เร็วระดับไม่กี่ ms
- Release ประมาณ `150–300 ms`

Limiter มีหน้าที่กัน peak/clipping เท่านั้น ไม่ใช้ทำ loudness levelling หลัก เพราะ Compressor ที่ทำงานเร็วตลอดเพลงจะทำให้เพลงหายใจหรือปั๊ม และอาจซ้อนกับ Stable volume ของ YouTube

### 4.4 Track lifecycle

เมื่อได้รับ `TRACK_CHANGED`:

1. ส่ง `RESET_LOUDNESS` พร้อม `youtubeVideoId` ไป offscreen audio host
2. Ramp normalization gain กลับ `0 dB` อย่างนุ่มนวล
3. ล้าง rolling windows และ silence state
4. Warm-up เพลงใหม่ก่อนเริ่มปรับ
5. ห้ามใช้ measurement ของเพลงก่อนหน้าต่อกับเพลงใหม่

เมื่อสลับ Vocal Cut preset หรือเปิด/ปิด Vocal Cut ให้ reset short-term window แต่ไม่จำเป็นต้องล้าง track identity

---

## 5. UX และ State

### 5.1 การเปิดใช้งาน

แนะนำให้เป็น Opt-in ในครั้งแรก แล้วจำค่าระดับ Extension:

- ปุ่ม `AUTO LEVEL: OFF/ON`
- เมื่อผู้ใช้เปิดแล้ว บันทึก `loudnessNormalizeEnabled` ใน `chrome.storage.local`
- ครั้งต่อไปที่เริ่ม capture ให้ใช้ค่าที่จำไว้
- Vocal Cut และ Auto Level เปิด/ปิดแยกกัน

ไม่เปิดอัตโนมัติทันทีหลังอัปเดต Extension เพื่อหลีกเลี่ยงการเปลี่ยนเสียงโดยผู้ใช้ไม่รู้ตัว

### 5.2 สถานะที่ส่งกลับหน้า Player

เพิ่ม optional fields แบบ backward-compatible ใน bridge state:

- `normalizeEnabled`
- `normalizeStatus`: `off | warming | active | silence_hold | limited | error`
- `measuredLoudnessDb`
- `normalizationGainDb`
- `limiterReductionDb`
- `playerVolume`

คง Bridge protocol version เดิมได้ถ้าฟิลด์ใหม่เป็น optional และทั้งสองฝั่ง ignore unknown fields; เพิ่ม manifest version เป็น `0.3.0`

### 5.3 หน้าจอ

ปรับ panel สถานะเสียงให้แสดงได้แม้ผู้ใช้ไม่เคยเปิด Vocal Cut:

- ปุ่มเปิด/ปิด Auto Level
- สถานะ `กำลังวัด`, `ทำงาน`, `พักช่วงเงียบ`, `ถึงเพดานเพิ่มเสียง`
- ค่า diagnostic แบบย่อ เช่น `-17.2 LUFS-like · +2.1 dB`
- แจ้งเมื่อเพลงเบามากจนชนเพดาน `+8 dB`
- ไม่แสดง meter ที่เปลี่ยนเร็วเกินไปจนรบกวนการร้อง

ควร refactor `PlayerVocalCutStatus` เป็น audio status panel ที่รองรับทั้ง Vocal Cut และ Auto Level แทนการเพิ่ม overlay ใหม่ซ้อนกัน

---

## 6. การจำค่ารายเพลง

แบ่งเป็นระยะที่สองหลัง real-time algorithm ผ่านการฟังจริงแล้ว

สร้าง key แยกจาก feedback ของ Vocal Cut:

```text
loudnessProfile:<youtubeVideoId>
```

ข้อมูลที่บันทึก:

- schema version
- measured loudness ของโหมด Original
- suggested normalization gain
- จำนวนวินาทีที่ใช้วัด
- confidence
- updated timestamp

เงื่อนไข:

- บันทึกเมื่อมี active audio อย่างน้อย 20–30 วินาที
- ไม่บันทึกช่วง silence หรือค่าที่ชน limiter ต่อเนื่อง
- profile ของ Original ห้ามนำไปใช้ตรง ๆ กับ Vocal Cut preset
- ใช้ profile เป็น initial gain แบบ conservative แล้วให้ real-time measurement แก้ต่อ
- มี TTL/schema invalidation เมื่อเปลี่ยน algorithm

ระยะแรกยังไม่ต้องใช้ Supabase เพราะ profile นี้ขึ้นกับ DSP และอุปกรณ์ local; เก็บใน `chrome.storage.local` ลดความเสี่ยงและไม่เพิ่มข้อมูลสาธารณะ

---

## 7. รายการไฟล์ที่คาดว่าจะเปลี่ยน

### Extension

- `browser-extension/loudness-normalizer.mjs` — pure measurement/controller functions
- `browser-extension/loudness-normalizer-processor.js` — AudioWorklet สำหรับวัดและใช้ gain
- `browser-extension/offscreen.js` — ต่อ graph, limiter, reset และ telemetry
- `browser-extension/service-worker.js` — state, preference และ bridge commands
- `browser-extension/messages.mjs` — normalize/validate คำสั่งและ state ใหม่
- `browser-extension/manifest.json` — version และ resource ที่จำเป็น
- `browser-extension/README.md` — วิธีใช้และข้อจำกัด

### Web app

- `src/lib/vocal-cut-bridge.ts` — เพิ่ม optional audio-normalization state types
- `src/hooks/useVocalCutExtension.ts` — toggle Normalize, ส่ง Volume/Mute และรับ telemetry
- `src/components/PlayerVocalCutStatus.tsx` — refactor เป็น audio status panel
- `src/components/YouTubePlayer.tsx` หรือ `src/app/player/page.tsx` — ส่งค่า Volume/Mute ไป bridge โดยไม่เปลี่ยนความหมายของ Volume เดิม

### Tests

- `tests/vocal-cut-extension.test.mjs` — unit tests ของ meter/controller และ bridge
- เพิ่ม test fixture/synthetic signals โดยไม่ใช้ไฟล์เพลงลิขสิทธิ์
- `scripts/verify-extension.mjs` — ตรวจว่ามี worklet file และ manifest/README สอดคล้องกัน

---

## 8. ลำดับการพัฒนา

### Phase 1 — Pure DSP และ unit tests

1. สร้าง loudness estimator และ gain controller เป็น pure module
2. ทดสอบสัญญาณ sine/noise ระดับต่างกัน
3. ทดสอบ silence gate, boost/attenuation clamp และ smoothing
4. ทดสอบว่า output ไม่เป็น `NaN`, `Infinity` หรือเกินขอบเขต
5. ทดสอบการ reset ตอนเปลี่ยนเพลง

### Phase 2 — Extension audio graph

1. เพิ่ม Normalizer AudioWorklet
2. เพิ่ม limiter หลัง worklet
3. เพิ่ม bypass/ramp ที่ไม่มี click
4. เพิ่ม `RESET_LOUDNESS`, `SET_NORMALIZE_ENABLED`, `SET_PLAYER_VOLUME`
5. ส่ง telemetry แบบจำกัดความถี่
6. ตรวจ CPU, latency และ memory ระหว่างเล่นต่อเนื่อง

### Phase 3 — Bridge และ UI

1. ขยาย state schema แบบ backward-compatible
2. ส่ง Volume/Mute จาก Karaoke context ไป Extension
3. เพิ่ม toggle และสถานะ Auto Level
4. บันทึก global preference ใน `chrome.storage.local`
5. แสดง warning เมื่อ extension ไม่ทำงานหรือชน gain limit

### Phase 4 — Listening calibration

ทดสอบอย่างน้อย 12 เพลง:

- เพลงดังมาก 3 เพลง
- เพลงเบามาก 3 เพลง
- เพลง Dynamic กว้าง 2 เพลง
- เพลงมีอินโทรเงียบ 2 เพลง
- เพลงเปิด Vocal Cut Balanced/Maximum 2 เพลง

วัดและฟัง:

- ความต่างระหว่างเพลงก่อนและหลัง Normalize
- เวลาที่ใช้เข้าสู่ target
- pumping ระหว่างท่อนเบา/ดัง
- clipping/limiter reduction
- การสลับเพลงและสลับ Vocal Cut
- การตอบสนองต่อ Volume และ Mute ของผู้ใช้

ปรับ target/clamp/smoothing จากผลฟังจริงก่อนเปิดใช้เป็นค่าแนะนำ

### Phase 5 — Per-video warm start (ภายหลัง)

เพิ่ม local loudness profile เมื่อ real-time algorithm เสถียรแล้ว เพื่อให้เพลงที่เคยวัดเริ่มด้วย gain ใกล้เคียงทันที

---

## 9. Acceptance criteria

- เพลงทดสอบที่ต่างกันชัดเจนมี perceived loudness หลัง warm-up ใกล้กันภายในประมาณ `±2 dB`
- ไม่มี audible click เมื่อเปิด/ปิด Normalize, เปลี่ยนเพลง หรือสลับ Vocal Cut
- ช่วง silence ไม่ถูกเร่งจนได้ยิน noise floor ชัดเจน
- เพลงดังไม่ clip และ limiter ไม่ทำงานหนักตลอดเวลา
- Volume/Mute ของ Player ยังควบคุมความดังปลายทางได้ตามที่ผู้ใช้ตั้งใจ
- Auto Level ทำงานได้เมื่อ Vocal Cut ปิด
- Vocal Cut tests เดิมยังผ่านทั้งหมด
- Extension หยุด capture แล้วเสียงกลับเส้นทางเดิมโดยไม่ดังพุ่ง
- ไม่มี PCM audio ถูกบันทึกหรือส่งผ่าน network
- `npm test`, `npm run lint`, `npm run build` และ `npm run extension:check` ผ่าน

---

## 10. ความเสี่ยงและวิธีลดความเสี่ยง

### Double processing กับ YouTube Stable volume

เว็บไซต์ตรวจไม่ได้ว่า Stable volume เปิดอยู่หรือไม่ จึงใช้ slow track-level gain แทน Compressor ที่ปรับเร็ว และให้ผู้ใช้ bypass Auto Level ได้ทันที

### เพลงมีอินโทรเงียบ

ใช้ silence gate, warm-up และจำกัด boost; ไม่ไล่หา target เมื่อไม่มี active audio

### Pumping

ใช้ short-term window ยาว, release ช้า, จำกัด gain step และใช้ limiter เฉพาะ peak

### เพลงเบาเกินกว่าจะชดเชย

จำกัด boost ที่ `+8 dB` และแสดงสถานะ `limited` แทนการเร่ง noise/clipping ต่อ

### CPU/Latency

เริ่มด้วย block processing และ biquad/K-weighting ที่ไม่ใช้ FFT เพิ่ม เพราะ Vocal Cut มี STFT อยู่แล้ว; telemetry ต้อง throttle

### Extension กับหน้าเว็บคนละรุ่น

เพิ่มเฉพาะ optional bridge fields, ตรวจ schema ทุก message และให้หน้าเว็บแสดง fallback เมื่อ Extension เก่าไม่รองรับคำสั่ง Normalize

---

## 11. สิ่งที่ไม่รวมในรอบแรก

- การดาวน์โหลดหรือวิเคราะห์ไฟล์ YouTube ฝั่ง Server
- การเขียน loudness metadata ลง Supabase
- การรับรองมาตรฐาน Broadcast LUFS อย่างเป็นทางการ
- Machine-learning loudness model
- การเผยแพร่ Extension ใน Store หรือ Production ก่อนผ่าน policy/compliance gate เดิมของ Vocal Cut
