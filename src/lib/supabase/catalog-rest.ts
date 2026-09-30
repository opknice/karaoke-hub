import 'server-only';

// No browser imports, cookies, user session, or public key fallback for writes.
export async function catalogRest(path: string, init: RequestInit = {}): Promise<unknown> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('ยังไม่ได้ตั้งค่าคีย์ Supabase ฝั่งเซิร์ฟเวอร์สำหรับคลังเพลง');
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  // The new opaque secret key belongs in apikey, not in the JWT bearer header.
  if (!key.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${key}`);
  headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${base}/rest/v1/${path}`, {
      ...init, headers, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error('เชื่อมต่อคลังเพลง Supabase ไม่สำเร็จ กรุณาลองใหม่');
  }
  if (!response.ok) throw new Error(`คลังเพลง Supabase ไม่พร้อมใช้งาน (HTTP ${response.status})`);
  if (response.status === 204 || response.headers.get('content-length') === '0') return null;
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : null;
}
