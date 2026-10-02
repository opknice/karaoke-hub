# แผนเริ่มเพลง GMM Karaoke ที่วินาที 16

## เป้าหมาย

- เพลงจากช่อง YouTube **GMM Karaoke** เริ่มเล่นที่ `00:16`
- เพลงจากช่องอื่นยังเริ่มที่ `00:00` ตามเดิม
- ใช้ Channel ID เป็นหลักฐานยืนยันช่อง ไม่ใช้ชื่อช่องซึ่งปลอมเลียนแบบได้
- การเริ่มเพลงใหม่ (restart) ของ GMM Karaoke กลับไปที่ `00:16` เช่นกัน
- การ seek ด้วยผู้ใช้ยังทำงานตามเดิม แผนนี้เปลี่ยนเฉพาะจุดเริ่มเล่นอัตโนมัติ

## ผลการสำรวจระบบปัจจุบัน

### ตัวระบุ GMM Karaoke

ระบบมีทะเบียนช่องทางการอยู่แล้วใน `src/lib/official-youtube-channels.ts`:

- ชื่อ: `GMM Karaoke`
- Channel ID: `UCHmKRqvKPYVx23RJ8uF6AtA`

การตรวจต้องเทียบ `channel_id` แบบตรงตัวและ case-sensitive เท่านั้น ชุดทดสอบปัจจุบันยืนยันอยู่แล้วว่าชื่อที่ดูเหมือนช่องทางการ เช่น `GMM Karaoke Official` แต่มี Channel ID อื่น ต้องไม่ถือว่าเป็นช่องทางการ

### เส้นทางข้อมูลเพลง

1. YouTube API แปลง `snippet.channelId` เป็น `YouTubeVideo.channel_id`
2. เมื่อเพิ่มเพลงเข้าคิว `KaraokeContext.addToQueue()` ส่งออบเจ็กต์ `video` เต็มก้อนไปยัง RPC `enqueue_song`
3. RPC เก็บ `video` ไว้ใน metadata ของ `queue_items.notes`
4. ตอนโหลดคิว `mapSupabaseQueueRow()` อ่าน metadata กลับมาเป็น `nowPlaying.video`
5. `YouTubePlayer` จึงอ่าน `nowPlaying.video.channel_id` ได้โดยไม่ต้องเรียก YouTube API ซ้ำ

หากรายการเก่าหรือ metadata เสียจนไม่มี `channel_id` ระบบควรใช้ค่าเริ่มต้น `00:00` เพื่อไม่ระบุช่องจากชื่อหรือคาดเดาเอง

### จุดที่เริ่มวิดีโอในปัจจุบัน

`src/components/YouTubePlayer.tsx` กำหนด `startSeconds: 0` หรือ `seekTo(0)` อยู่ในเส้นทางเหล่านี้:

1. Player พร้อมและโหลด/คิวเพลงแรก (`onReady`)
2. เปลี่ยนไปเพลงถัดไป (`loadVideoById` / `cueVideoById`)
3. เปิดเล่นใหม่หลัง Player อยู่สถานะจบ (`enablePlayback`)
4. เริ่มเพลงปัจจุบันใหม่ (`restartCurrentSong`)

ทุกเส้นทางต้องใช้กฎเดียวกัน มิฉะนั้นบางกรณีจะเริ่มที่วินาที 16 แต่บางกรณีย้อนกลับไปวินาที 0

## แผนการแก้ไข

### 1. ทำตัวตนและกฎเวลาเริ่มให้เป็นแหล่งกลาง

- ประกาศ Channel ID ของ GMM Karaoke เป็น named constant ใน `src/lib/official-youtube-channels.ts` แล้วนำ constant เดียวกันไปใช้ในทะเบียนช่อง
- เพิ่ม pure helper ใน `src/lib` สำหรับรับ `YouTubeVideo` หรือ `channel_id` แล้วคืนค่าเวลาเริ่ม:
  - Channel ID ตรงกับ GMM Karaoke: `16`
  - ช่องอื่นหรือไม่มี Channel ID: `0`
- ไม่ตรวจด้วย `channel_name`, ชื่อเพลง หรือ YouTube video ID รายเพลง

### 2. ใช้เวลาเริ่มเดียวกันตลอด lifecycle ของ Player

- ใน `YouTubePlayer` คำนวณ `playbackStartSeconds` จากเพลงปัจจุบัน
- เก็บค่าล่าสุดใน ref เช่นเดียวกับ `videoIdRef` เพื่อให้ callback ของ YouTube IFrame API ไม่อ่านค่าเก่า
- แทน `startSeconds: 0` ทั้งหมดใน `loadVideoById` และ `cueVideoById` ด้วยค่านี้
- แทน `seekTo(0)` ใน `restartCurrentSong` ด้วยค่านี้
- เมื่อเริ่มหรือ restart ให้ตั้ง `currentTime` เป็นค่าเดียวกัน เพื่อไม่ให้ UI แสดง `00:00` ชั่วคราว
- เพิ่มค่าเวลาเริ่มใน dependency ที่เกี่ยวข้อง เพื่อรองรับกรณี metadata ของรายการปัจจุบันถูกอัปเดต

### 3. รักษาพฤติกรรมเดิมของช่องอื่น

- ช่องอื่นทุกช่องยังใช้ `0`
- กรณีไม่มี `channel_id` ต้อง fail closed เป็น `0`
- ไม่แก้ฐานข้อมูล, RPC, schema, catalog sync หรือ search ranking เพราะข้อมูล `channel_id` เดินทางถึง Player อยู่แล้ว
- ไม่บังคับ slider หรือผู้ใช้ให้ seek ได้เฉพาะหลังวินาที 16; ขอบเขตนี้คือจุดเริ่มอัตโนมัติเท่านั้น

### 4. เพิ่มการทดสอบ

เพิ่ม unit test ให้ helper อย่างน้อยดังนี้:

1. Channel ID ของ GMM Karaoke คืน `16`
2. ช่องชื่อ `GMM Karaoke` แต่ Channel ID อื่นคืน `0`
3. ช่องชื่อเลียนแบบ `GMM Karaoke Official` คืน `0`
4. ช่องอื่นในทะเบียนทางการคืน `0`
5. ไม่มี `channel_id` คืน `0`
6. Channel ID ที่เปลี่ยนตัวพิมพ์เล็ก/ใหญ่คืน `0`

ตรวจการเชื่อมเข้ากับ Player ว่าทั้ง 4 เส้นทางใช้ `playbackStartSeconds` และไม่มี `startSeconds: 0` หรือ `seekTo(0)` เหลือในเส้นทางเริ่ม/restart เพลง

### 5. ตรวจสอบก่อนส่งมอบ

- รัน unit tests ทั้งหมด
- รัน ESLint
- รัน production build
- เปิดหน้า `/player` แล้วทดสอบจริงอย่างน้อย 3 กรณี:
  1. เพลง GMM Karaoke เริ่มที่ประมาณ `00:16`
  2. เพลงช่องอื่นเริ่มที่ประมาณ `00:00`
  3. สั่ง restart เพลง GMM Karaoke แล้วกลับไปประมาณ `00:16`
- ทดสอบเปลี่ยนเพลง GMM → ช่องอื่น → GMM เพื่อยืนยันว่าค่าเวลาเริ่มไม่ค้างข้ามเพลง

## เกณฑ์ยอมรับงาน

- ระบบตัดสินว่าเป็น GMM Karaoke จาก Channel ID `UCHmKRqvKPYVx23RJ8uF6AtA` เท่านั้น
- การเล่นอัตโนมัติและ restart เพลงจากช่องนี้เริ่มที่วินาที 16 ทุกเส้นทาง
- ช่องอื่นและรายการที่พิสูจน์ Channel ID ไม่ได้เริ่มที่วินาที 0
- ไม่มีการเรียก YouTube API เพิ่มและไม่มี migration ฐานข้อมูล
- test, lint และ build ผ่าน

## ไฟล์ที่คาดว่าจะเปลี่ยนตอนลงมือทำ

- `src/lib/official-youtube-channels.ts`
- ไฟล์ helper ใหม่ใน `src/lib` สำหรับกฎเวลาเริ่มเล่น
- `src/components/YouTubePlayer.tsx`
- ไฟล์ unit test ใหม่ใน `tests`
