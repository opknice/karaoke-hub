# แผน Song Loudness Profiles บน Supabase

วันที่: 1 ตุลาคม 2026  
สถานะ: วางแผนแล้ว ยังไม่เริ่มพัฒนา/แก้ฐานข้อมูล  
แผนหลักสำหรับงานต่อจาก `auto-loudness-normalize.md`

## 1. เป้าหมายที่ตกลงกับผู้ใช้

- เริ่มจากเก็บข้อมูลความดังรายเพลงลง Supabase ขณะมีการเล่นเพลงจริง
- สะสมการวัดจากครั้งถัด ๆ ไป ให้ค่าประจำเพลงน่าเชื่อถือขึ้น
- เมื่อข้อมูลพร้อม คำนวณค่าชดเชยและใช้ gain เดียวตลอดเพลง เช่น เพลงเบากว่าเป้าหมาย 2 dB ให้เพิ่มทั้งเพลง 2 dB
- รักษาความต่างระหว่างท่อนเบากับท่อนดัง ไม่ใช้การไล่เพิ่ม–ลดเสียงตามท่อนเป็นวิธีหลัก
- แยกค่าประจำเพลงออกจากระดับเป้าหมายกลางของระบบ ระดับเป้าหมายไม่เปลี่ยนตามทุกการเล่น
- ไม่ดาวน์โหลดหรือส่งไฟล์เสียงไปเซิร์ฟเวอร์ เก็บเฉพาะตัวเลขการวัด

ความดังอ้างอิงหลักในแผนนี้คือ integrated perceived loudness ของเพลง ไม่ใช่ยอด peak อย่างเดียว เก็บ peak แยกสำหรับจำกัดการเพิ่มเสียง ไม่รับประกันว่าทุกจังหวะหรือท่อนดังที่สุดจะมีระดับเท่ากัน เพราะแต่ละเพลงมีไดนามิกต่างกัน

## 2. ผลตรวจระบบปัจจุบัน

- `browser-extension/offscreen.js`: เสียงผ่าน Vocal Cut → normalizer → DynamicsCompressor → ลำโพง
- `loudness-normalizer.mjs`: วัด K-weighted LUFS-like ทุกประมาณ 400 ms และปรับ gain ตามเสียงระหว่างเล่น วัดเฉพาะเมื่อ enabled
- ตัววัดเดิมใช้การประมาณชดเชย volume ด้วย `20 log10(volume / 100)` ซึ่งต้องตรวจสอบกับ YouTube จริงก่อนนำมาใช้รวมข้อมูลข้ามเครื่อง
- `useVocalCutExtension.ts` ส่ง video ID และ volume/mute แต่ยังไม่ส่งตำแหน่งเวลา สถานะ buffering/seek และ playback rate สำหรับจัดช่วงการวัด
- `YouTubePlayer.tsx` มีข้อมูลเวลาและสถานะเล่นที่นำมาต่อได้ แต่ duration บางเส้นทางเป็น fallback จึงใช้เป็นหลักฐานความครบถ้วนไม่ได้
- ยังไม่มี API หรือตาราง loudness profile ในไฟล์โครงการที่ตรวจ
- `api/rooms/route.ts` มีตัวอย่างตรวจ Bearer token ด้วย `auth.getUser()` ก่อนดำเนินการฝั่ง server; มี anonymous sign-in เดิมให้ใช้ร่วมได้
- ผลตรวจเป็นการอ่านไฟล์ใน workspace ไม่ใช่การยืนยัน schema ของฐานข้อมูล live

## 3. ลำดับข้อมูล

```text
YouTube / เสียงที่ capture ได้จริง
  → วัดก่อน gain ของ Auto Level และก่อน limiter
  → ผูกตัวเลขการวัดกับ video ID + เวลาเพลง + โหมดเสียง
  → รวมเป็น batch ใน Extension
  → หน้า /player ส่งไป API พร้อม identity เดิม
  → Supabase เก็บ observations และปรับปรุง profile
  → การเปิดเพลงครั้งถัดไปอ่าน profile ที่พร้อมใช้
  → คำนวณ gain จาก target ที่ตรึงไว้ → ใช้ค่านี้ทั้งเพลง
```

Supabase เก็บข้อมูลและคำนวณสถิติ ไม่ประมวลผลเสียง PCM การฟังซ้ำเฉพาะช่วงเดิมเพิ่มความมั่นใจในช่วงนั้นได้ แต่ไม่เพิ่มเปอร์เซ็นต์ความครอบคลุมเพลง

## 4. Phase A — ทำให้ข้อมูลวัดเชื่อถือได้ก่อน

### 4.1 แยก meter ออกจาก gain controller

- meter ทำงานได้แม้ Auto Level ปิด หากเปิดการเรียนรู้และ capture ทำงาน
- จุดวัด Original อยู่ก่อน Vocal Cut; จุดวัดโหมดตัดร้องอยู่หลัง Vocal Cut แต่ก่อน normalizer/limiter
- รุ่นแรกเผยแพร่ profile ที่พร้อมใช้เฉพาะ Original; เก็บโหมดตัดร้องแยกได้ แต่ยังไม่ใช้ค่าข้ามโหมด
- profile key: `youtube_video_id + audio_mode + dsp_version + measurement_version + capture_calibration_version`
- Vocal Cut แบบ adaptive อาจให้ผลต่างกันตามลำดับการเล่น ต้องทดสอบ repeatability ก่อนเปิดใช้ profile ของโหมดนี้
- meter เดิมเป็น LUFS-like ไม่เปลี่ยนชื่อเป็น LUFS มาตรฐานเพียงเพราะเริ่มบันทึกลง DB

### 4.2 ตรวจ meter และ reference level

- พัฒนาหรือเลือกตัววัด BS.1770 ที่ตรวจสอบได้: K-weighting, channel weighting, 400 ms blocks ซ้อนทับตามมาตรฐาน และ absolute/relative gating
- เทียบผลกับ reference meter/EBU test vectors ที่ 44.1 และ 48 kHz; เป้าหมายความต่าง integrated loudness ไม่เกิน 0.2 LU ในชุดทดสอบที่รองรับ
- เพิ่ม true-peak estimator ที่ตรวจสอบด้วย inter-sample peak fixtures; sample peak อย่างเดียวไม่ใช้รับรองว่าเพิ่มเสียงได้โดยไม่ล้น
- เป้าหมายความคลาดเคลื่อน true peak ไม่เกิน 0.3 dB ในชุดทดสอบ; เผื่อ headroom เพิ่มเมื่อใช้จริง
- ตรวจ mapping ของ YouTube volume กับ amplitude ที่ capture ได้ที่หลายระดับ ไม่ถือว่าสูตร linear เดิมถูกต้องโดยอัตโนมัติ
- ห้ามบังคับตั้ง volume ผู้ใช้เป็น 100 เพื่อเก็บข้อมูล; ช่วงระดับเสียงที่ยังชดเชยไม่ได้แน่นอนให้เก็บเป็น provisional หรือไม่นำเข้า profile กลาง
- บันทึก browser/capture configuration และ calibration version ที่จำเป็นโดยไม่สร้าง device fingerprint
- YouTube processing ที่ตรวจไม่ได้ เช่น Stable volume/การเปลี่ยน source ทำให้ข้อมูลต่างกันได้: profile แทนเสียงที่ capture ภายใต้เงื่อนไขที่ตรวจแล้ว ไม่อ้างว่าเป็นค่าต้นฉบับ studio
- ถ้าข้อมูลข้าม session ต่างกันอย่างมีนัยสำคัญ ให้แยก candidate/ตั้ง disputed แทนเฉลี่ยกลบความต่าง

### 4.3 ผูกการวัดกับเวลาเพลง

- ส่ง actual video ID, actual duration, currentTime, playing/paused/buffering, playbackRate, volume/mute, mode และ track generation ID
- ผูก media timestamp กับ monotonic capture clock และชดเชย latency ของ pipeline โดยเฉพาะ Vocal Cut; ทดสอบความคลาดเคลื่อนก่อนรวมช่วงข้าม session
- เก็บ per-block linear energy พร้อมตำแหน่งเพลง และ peak; batch ขนาดประมาณ 5–10 วินาที ไม่สร้าง DB row ต่อ audio sample
- ไม่เก็บช่วง mute, volume ใกล้ศูนย์, seek boundary, buffering, video ID ไม่ตรง, playback rate ไม่ใช่ 1 หรือ state/timing ไม่แน่นอน
- reset filter/window หลัง seek/เปลี่ยนเพลง และตัดช่วง settling ออกจาก observations
- ช่วงเงียบของเพลงที่เล่นจริงนับเป็น coverage ได้ แต่ไม่ใช้เป็นเหตุผลเร่ง gain; เก็บเหตุผลแยกจาก silence เพราะ pause/mute
- เมื่อแยกโฆษณาหรือเสียงอื่นในแท็บออกจากเพลงไม่ได้ ให้ตัดช่วงไม่แน่นอนออก; ทดลองว่า ad/notification ไม่ปนก่อนเปิดการเผยแพร่ profile

## 5. Phase B — เก็บข้อมูลใน Supabase

โครงสร้างที่เสนอ (ชื่อและชนิด SQL ยืนยันอีกครั้งตอนพัฒนา):

| ตาราง | เนื้อหา | สิทธิ์ |
| --- | --- | --- |
| `song_loudness_sessions` | ID การเล่น, ผู้ส่ง, video ID, mode/versions, actual duration, calibration, timestamps, สถานะ complete/interrupted | server เท่านั้น |
| `song_loudness_observations` | session ID, batch ID, ช่วงเวลาที่วัด, compact block energies, observed peak, valid/invalid flags | server เท่านั้น |
| `song_loudness_profiles` | key รายเพลง/โหมด/รุ่น, integrated estimate, observed max true peak, unique coverage, confidence/status, revision, updated_at | อ่านผ่าน API; server เขียน |
| `loudness_target_versions` | target LUFS, peak ceiling, gain limits, calibration set/version, สถานะ draft/active, วันที่เผยแพร่ | อ่านค่าที่ active ผ่าน API; server เขียน |

- ใช้ video ID เป็น identity ไม่ใช้ชื่อเพลง; เพลงจากผลค้นหาใหม่เก็บได้ ไม่บังคับว่าต้องอยู่ใน catalog ล่วงหน้า แต่ตรวจรูปแบบและบริบทการเล่น
- ตรวจ input ขนาดจำกัด, finite numbers, sample rate/versions ที่รองรับ, duration/position สมเหตุผล
- unique constraint บน `(session_id, batch_id)` ทำให้ retry ไม่เพิ่มข้อมูลซ้ำ
- write session/observation และ aggregation ใช้ transaction/locking หรือ revision compare-and-swap ป้องกัน concurrent lost update
- เริ่มด้วย aggregation แบบจำกัดเฉพาะ profile ที่มีข้อมูลเปลี่ยนใน ingestion flow; ยังไม่ต้องตั้ง cron ใหม่
- ส่ง batch ประมาณทุก 10 วินาที และเมื่อจบ/เปลี่ยนเพลง; flush สุดท้ายเป็น best effort ไม่ใช้เป็นเงื่อนไขเดียวในการบันทึก
- offline queue ใน Extension เก็บเฉพาะตัวเลข ไม่เก็บ token; เสนอเพดาน 5 MB/24 ชั่วโมง, bounded retry with backoff และ re-auth ผ่านหน้าเว็บ
- เสนอเก็บ raw observations 30 วันเพื่อ debug/recompute จากนั้น compact เป็นสถิติรายช่วงก่อนลบ; ติดตาม storage/row count ก่อนกำหนด retention production
- การเปลี่ยน measurement algorithm ให้เริ่ม profile version ใหม่ สถิติเก่าไม่สามารถแทนการวิเคราะห์ PCM ด้วย algorithm ใหม่ได้

### API และสิทธิ์

- `POST /api/audio/loudness/sessions`: สร้าง session หลังตรวจ user และสิทธิ์ใช้งานห้อง/เพลงตาม flow เดิม
- `POST /api/audio/loudness/observations`: รับ batch ของ session ที่ user นั้นเป็นเจ้าของ ตรวจบริบทการเล่นและโควตาก่อนบันทึก
- `GET /api/audio/loudness/profile?videoId=...&mode=...`: คืนเฉพาะ profile summary + target version ที่ใช้งานได้ ไม่คืนประวัติผู้ส่ง
- ใช้ Route Handlers แบบ Node runtime; server ตรวจ token จริง ไม่เชื่อ user ID ใน payload
- เปิด RLS บนตาราง public และ revoke direct client writes; service key อยู่ฝั่ง server เท่านั้น
- Anonymous Supabase Auth ไม่เท่ากับไม่มีตัวตน แต่ identity แบบนี้ยังปลอมข้อมูลการวัดได้ จึงต้องมี rate limit ต่อ identity/session และจำกัดน้ำหนักผู้ส่ง ไม่ถือว่า client telemetry เชื่อถือได้ทั้งหมด
- ห้าม client กำหนด `ready`, target หรือ recommended gain โดยตรง server เป็นผู้คำนวณ
- ตรวจ live schema/grants ก่อน migration และทดสอบ allow/deny รวมถึงอ่าน raw data ของคนอื่นไม่ได้ ตามแนวทาง Supabase
- ใช้ batch และจำกัดขนาดเพื่อควบคุมค่า DB/API; ไม่มีค่า audio processing บน cloud แต่ไม่อ้างว่า cloud cost เป็นศูนย์

## 6. Phase C — รวมข้อมูลเป็นค่าประจำเพลง

ไม่เฉลี่ย dB จากทุกการเล่นตรง ๆ และไม่เฉลี่ย integrated LUFS ของเพลงที่เล่นไม่ครบให้เท่ากัน

1. จัด observations ลงตำแหน่งเวลาของเพลงด้วย grid ที่คงที่ เก็บความละเอียดพอสำหรับ gating; แต่ละตำแหน่งให้น้ำหนักตามเวลาเพียงครั้งเดียว
2. สำหรับตำแหน่งเดียวกันที่วัดซ้ำ ใช้ robust estimate ของ linear energy จากข้อมูลที่ผ่าน validation จำกัดน้ำหนักต่อ session/ผู้ส่ง และเก็บ dispersion เพื่อตรวจ outlier
3. นำลำดับ block energies ที่เป็นตัวแทนมาคำนวณ absolute/relative gating ใหม่ก่อนแปลงเป็น integrated estimate ไม่ average LUFS ตรง ๆ
4. Peak ใช้ค่าสูงสุดที่ผ่าน validation ไม่ใช้ค่าเฉลี่ย; peak ที่สูงผิดปกติควรหยุด boost/ตั้ง disputed จนตรวจได้ ไม่ทิ้งเพียงเพื่อเพิ่มเสียงให้มากขึ้น
5. เก็บ `unique_coverage`, จำนวน complete sessions, repeated-position agreement และความเปลี่ยนแปลงของค่าประจำเพลงแยกกัน ไม่ใช้จำนวนครั้งเล่นเป็น confidence อย่างเดียว
6. ผลรวมจากชิ้นส่วนยังเรียก estimated จนผ่านการเทียบกับการเล่นเต็มเพลงจริง; การเล่นหลายครั้งเฉพาะ 20 วินาทีแรกไม่ทำให้ ready

สถานะเสนอ:

- `collecting`: ข้อมูลยังไม่ครบหรือ calibration ยังไม่ผ่าน
- `candidate`: ครอบคลุมอย่างน้อย 90% ของ actual duration แต่ยังไม่มีหลักฐานเต็มเพลง/ความคงที่เพียงพอ
- `ready`: มีอย่างน้อย 2 qualified full-play sessions, ความต่าง integrated ไม่เกิน 0.5 LU และไม่มีตำแหน่ง peak/processing conflict
- `disputed`: พบความต่างที่อธิบายไม่ได้ แยกออกจาก target calibration และหยุดใช้ boost
- `stale`: source/duration/config/version เปลี่ยน ต้องเก็บใหม่

Qualified full-play ต้องเล่นตั้งแต่ต้นถึงจบ มี valid coverage อย่างน้อย 99% และไม่มีช่องว่างที่อาจซ่อนเสียงสูงสุด; ถ้ามี missing interval ที่ไม่ยืนยันว่าเป็น silence ให้ห้าม positive gain แม้ coverage สูง ตัวเลขข้างต้นเป็นเกณฑ์ทดลอง ต้องตรวจด้วยเพลงจริงก่อนใช้เป็นเกณฑ์เผยแพร่

## 7. Phase D — เลือกระดับกลางและคำนวณ gain

- ใช้เฉพาะ ready profiles ของ Original ที่ผ่าน calibration มาสร้างชุดอ้างอิง (เสนอเริ่มอย่างน้อย 20 เพลง กระจายเพลงเบา/ดัง/ไดนามิกกว้าง)
- ใช้ median ของ integrated loudness เป็น target candidate โดยให้น้ำหนักเพลงเท่ากัน ไม่ให้อันดับเพลงยอดนิยมดึงค่ากลาง
- ตรวจ headroom ของทุกเพลงในชุดแล้วค่อยเผยแพร่ target version; ไม่ยึด `-16` จากระบบเดิมโดยอัตโนมัติ
- หากต้องการให้ทุกเพลงในชุดถึง target โดยไม่บีบเสียง target ต้องไม่สูงกว่าระดับที่ปลอดภัยของเพลงที่มี headroom น้อยที่สุด รวมถึง gain limits

สูตรหลัก:

```text
requestedGainDb = targetLufs - songIntegratedLufs
safeGainCeilingDb = peakCeilingDbtp - songTruePeakDbtp
appliedGainDb = min(requestedGainDb, safeGainCeilingDb, maximumBoostDb)
```

ถ้า attenuation ที่ต้องใช้เกินขอบเขตที่ผ่านการทดสอบ ให้ตั้ง limited/unavailable แทนประกาศว่าถึงเป้าหมายแล้ว ค่า peak ceiling ทดลอง `-2 dBTP` และ maximum boost ทดลอง `+6 dB`; ยืนยันอีกครั้งจากผล calibration ไม่ใช้เป็นค่ารับประกันล่วงหน้า

- หากเพลงใหม่ไปไม่ถึง target โดยไม่ล้น ให้คง gain ที่ปลอดภัยและแจ้ง limited; ไม่ลด target ของทั้งระบบอัตโนมัติกลางการใช้งาน
- ปรับ target เป็นรอบที่มี version และผลทดสอบรองรับ
- เก็บ measurement เป็นข้อมูลหลัก คำนวณ gain ต่อ target version ไม่ฝังค่า gain เก่าจนเปลี่ยน target ไม่ได้
- คง volume/mute ของผู้ใช้เป็น master; ค่ากลางไม่ได้กำหนดระดับเสียงจริงจากลำโพงหรือระยะที่ผู้ฟังนั่ง

## 8. Phase E — นำ profile มาใช้ตอนเล่น

- Prefetch profile ของเพลงถัดไป เมื่อรู้คิว; snapshot profile revision + target version ตอนเริ่มเพลง
- ถ้า profile พร้อมก่อนเริ่มเสียง ใช้ gain คงที่พร้อม ramp สั้นป้องกัน click
- หากโหลดช้าจนเพลงเริ่มแล้ว ห้ามนำค่าที่เพิ่งโหลดมาเปลี่ยน gain กลางเพลง ใช้ครั้งถัดไป
- ถ้ายังไม่มี profile พร้อมใช้ ใช้ 0 dB และเก็บข้อมูลต่อ ไม่กลับไปใช้ streaming gain riding โดยเงียบ ๆ
- เปลี่ยนเพลงให้ reset identity/gain; session ของเพลงเก่าห้ามเขียนปนเพลงใหม่
- เปลี่ยน Vocal Cut เป็นการเปลี่ยนโหมด: ramp ไปยัง profile ที่ตรงหรือ 0 dB ถ้าไม่มี ห้ามนำ Original gain ไปใช้แทน
- ข้อมูลใหม่ที่เก็บระหว่างเพลงอัปเดต DB ได้ แต่ไม่เปลี่ยน gain ของเพลงที่กำลังเล่น
- Safety limiter เป็น last resort หากข้อมูลผิด/ต้นทางเปลี่ยน; `DynamicsCompressorNode` เดิมไม่ใช่หลักประกัน true-peak brickwall จึงต้องทดสอบหรือเปลี่ยน safety stage ก่อนอ้างเพดาน
- หาก safety stage ลดเสียงระหว่างเล่น แสดง limited และ downgrade profile สำหรับครั้งหน้า ยอมลดความตรง target เพื่อไม่ปล่อย clipping
- Gain คงที่รักษาสัดส่วนไดนามิกและโทนเดิมเมื่อไม่ clipping/limiting แต่ไม่ซ่อม distortion/noise ที่มีในต้นฉบับ

## 9. Rollout และหน้าจอ

ระยะแรกส่งมอบเฉพาะ A–C: calibration → collection → profile diagnostics ไม่เปิดใช้ gain จาก DB อัตโนมัติ

- เพิ่มสถานะสั้น ๆ `กำลังเก็บข้อมูล`, `ข้อมูลพร้อมใช้`, `ต้องเก็บใหม่`; เปอร์เซ็นต์หมายถึง unique coverage จริง
- การเก็บข้อมูลเป็น setting แยกจาก Auto Level และทำงานได้เฉพาะเมื่อ Extension capture ทำงาน
- เปลี่ยนจากรุ่นเดิมให้เลือกโหมดชัดเจน: `ปิด`, `Auto Level เดิม`, `ระดับเสียงรายเพลง` (โหมดใหม่เปิดให้ใช้หลังผ่าน D–E)
- คง preference เดิมระหว่าง collection rollout; เมื่อทดสอบเก็บข้อมูลแนะนำปิด Auto Level เดิมเพื่อฟัง baseline แต่ meter ต้องแยกจากมันได้อยู่แล้ว
- โหมดใหม่จะไม่เปิด streaming controller พร้อม fixed gain
- diagnostic สำหรับผู้พัฒนา: coverage, sessions, estimate, peak, uncertainty, target/profile versions, gain และ rejected reasons
- มี feature switches ฝั่ง server สำหรับ collection และ profile playback แยกกัน; rollback ปิด playback ใหม่โดยไม่ลบข้อมูล

## 10. ไฟล์ที่คาดว่าจะเปลี่ยน

- Extension: `loudness-normalizer.mjs`, `loudness-normalizer-processor.js`, `offscreen.js`, `service-worker.js`, `messages.mjs`, bridge/content script ที่เกี่ยวข้อง, manifest และ README
- เพิ่ม pure meter/profile modules แยกจาก streaming controller เดิม
- Web: `src/lib/vocal-cut-bridge.ts`, `src/hooks/useVocalCutExtension.ts`, `src/components/YouTubePlayer.tsx`, `src/app/player/page.tsx`, `src/components/PlayerVocalCutStatus.tsx`
- เพิ่ม API ภายใต้ `src/app/api/audio/loudness/` และ validator/aggregation/data-access modules
- เพิ่ม Supabase migrations พร้อม constraints/indexes/grants/RLS และ DB authorization tests; ไม่แก้ migration เก่าที่รันแล้ว
- เพิ่ม tests สำหรับ meter, timeline, aggregation, retries, lifecycle และ fixed gain
- ก่อนเขียนโค้ด Next.js อ่านเอกสารที่ตรงงานใน `node_modules/next/dist/docs/`; ตรวจ schema จริงและ API docs ก่อนสร้าง migration

## 11. การตรวจรับ

### Collection และข้อมูล

- ปิด Auto Level แล้วยังวัด/ส่งข้อมูลได้เมื่อเปิด collection; เสียงไม่เปลี่ยนเพราะ collection
- เล่นแค่อินโทรซ้ำ 10 ครั้ง coverage ไม่เพิ่มเกินช่วงที่ฟังและไม่กลายเป็น ready
- seek/pause/mute/buffer/change track/ad uncertainty ไม่สร้างข้อมูลผิดเพลง/ผิดตำแหน่ง
- volume หลายระดับหลัง calibration ให้ค่าประจำเพลงต่างกันไม่เกิน 0.5 LU มิฉะนั้นยังไม่รวมข้ามเงื่อนไข
- duplicate retry/concurrent submissions ไม่เพิ่มน้ำหนักซ้ำและไม่ทำข้อมูลหาย
- outage ของ Supabase ไม่ขัดการเล่น; queue มีขนาดจำกัดและส่งซ้ำได้หลัง re-auth
- identity อื่นเขียน session ของคนอื่นหรือแก้ profile/target ไม่ได้
- merged estimate เทียบ full-play reference ไม่เกิน 0.5 LU ในเพลงทดสอบ; ไม่อ้าง full-track true peak หากยังมีช่องว่างการวัด

### Playback และคุณภาพเสียง

- ชุดเพลงสำเนาสัญญาณเดียวกันที่ gain ต่างกัน ต้องออกมาระดับเดียวกันภายใน 0.5 LU เมื่อมี headroom พอ
- ชุดเพลงจริงอย่างน้อย 20 เพลงที่ไม่ติด headroom limit มี output integrated loudness ภายใน ±1 LU ของ target ในเส้นทางทดสอบเดียวกัน
- gain ไม่เปลี่ยนตามท่อนหรือ profile update ระหว่างเพลง; ไม่เกิด pumping จาก normalizer ใหม่
- ทำ null/ratio test ยืนยันว่าการเปิด fixed gain เท่ากับคูณด้วย scalar เมื่อพ้นช่วง ramp และ limiter ไม่ทำงาน
- ทดสอบ peak fixtures, อินโทรเงียบ, เพลงไดนามิกกว้าง, ปลายเพลงดัง, source/config เปลี่ยน และสลับ Vocal Cut
- no-profile/late-profile/stale-profile fallback ทำงานตามข้อกำหนด; เปลี่ยน volume/mute แล้วตอบสนองตามผู้ใช้
- ฟัง A/B จริงก่อนเปิดใช้ D–E; unit tests/build ไม่แทนการทดสอบเสียงผ่าน capture จริง
- รัน extension verification, relevant tests, lint/build และ browser verification ตามขอบเขตไฟล์ที่เปลี่ยน

## 12. จุดตัดสินใจจากการทดลองและขอบเขต

- ถ้า YouTube volume หรือ upstream processing ทำให้ข้อมูลข้าม session เทียบกันไม่ได้ ให้คง collection แบบ provisional/แยก calibration cohort; ห้ามเผยแพร่ profile กลางที่รู้ว่าไม่น่าเชื่อถือ
- ถ้า peak coverage ยังไม่ครบ ห้าม boost จากข้อมูล partial แม้ integrated estimate ดูนิ่ง
- ความดังรับรู้ใกล้กันกับการรักษาไดนามิกทุกเพลงไม่ทำให้ peak ทุกเพลงเท่ากันโดยอัตโนมัติ; เลือกรักษาไดนามิกและชดเชยทั้งเพลงตามความต้องการที่ตกลง
- แผนนี้ยังไม่เพิ่ม scheduled task, ดาวน์โหลด YouTube, ML model, การเก็บเสียง หรือ deploy production
- การเก็บค่าตัวเลขใน DB มีค่าใช้จ่ายตามปริมาณ; วัดจริงก่อนตั้ง retention/อัตราส่ง production

## แหล่งอ้างอิง

- [EBU R 128: loudness และ maximum true peak](https://tech.ebu.ch/publications/r128)
- [EBU Tech 3343: practical guidelines](https://tech.ebu.ch/publications/tech3343)
- [Supabase RLS: grants, policies และ authorization tests](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase changelog](https://supabase.com/changelog) — ตรวจอีกครั้งก่อน implementation
