# เปิดใช้ YouTube API key สำรอง

โค้ดและ key สำรองใน `.env.local` เตรียมไว้แล้ว ต้องเพิ่มโครงสร้างฐานข้อมูลก่อนใช้งาน
ระบบสลับ key โดยไฟล์ SQL ไม่มี API key หรือค่าลับ

1. เปิด Supabase project `dtarlneapsypnxpcqjfn` แล้วเข้า **SQL Editor**
2. สร้าง query ใหม่ คัดลอกเนื้อหาทั้งหมดจาก
   [`20261108042641_youtube_key_failover.sql`](../supabase/migrations/20261108042641_youtube_key_failover.sql)
   แล้วกด **Run** ไฟล์นี้ใช้ตารางและฟังก์ชันจาก migrations เดิมของโปรเจ็กต์
3. ตรวจว่ารันสำเร็จ จากนั้นรีสตาร์ตเซิร์ฟเวอร์ในเครื่อง (`npm run dev`)
4. หากใช้บน Vercel ให้เพิ่ม `YOUTUBE_API_KEY_BACKUP` และ
   `YOUTUBE_SEARCH_BACKUP_DAILY_LIMIT=100` ใน Environment Variables ฝั่งเซิร์ฟเวอร์
   แล้ว redeploy โดยเก็บ `YOUTUBE_API_KEY` ตัวหลักไว้ตามเดิม

ตรวจการติดตั้งด้วย query ที่ไม่ใช้โควตา YouTube:

```sql
select
  to_regclass('public.karaoke_youtube_key_usage') is not null as table_ready,
  to_regprocedure('public.karaoke_youtube_reserve(jsonb,text,text[],boolean)') is not null as reserve_ready,
  to_regprocedure('public.karaoke_youtube_get_budget(jsonb)') is not null as budget_ready,
  to_regprocedure('public.karaoke_search_pool_begin(text,text)') is not null as lease_ready;
```

ผลต้องเป็น `true` ทุกช่อง ระบบจะเริ่มจาก key หลัก สลับไปสำรองเมื่อโควตารายวัน
หรืองบค้นหาของ key หลักหมด และกลับไปลอง key หลักในคำขอแรกหลังเที่ยงคืนเวลา Pacific
โดยปรับตาม daylight saving อัตโนมัติ ถ้าทั้งสอง key หมด ยังเลือกเพลงในคลังหรือผลแคชได้
การเปิดลิงก์วิดีโอยังต้องมีโควตาดึงรายละเอียดเหลืออยู่

การทดสอบใช้ API จำลองและฐานข้อมูล PostgreSQL แบบชั่วคราว ไม่ใช้โควตา YouTube จริง
จึงยังไม่ยืนยันสิทธิ์หรือโควตาคงเหลือจริงของ key สำรอง
