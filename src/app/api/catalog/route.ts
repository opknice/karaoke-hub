import { NextRequest, NextResponse } from 'next/server';
import { searchCatalog } from '@/lib/youtube-catalog';

export const runtime = 'nodejs';

// Read-only typing preview: deliberately no YouTube requests or synchronization.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? '';
  if (query.trim().length < 2 || query.length > 250) {
    return NextResponse.json({ success: false, error: 'กรุณาระบุคำค้น 2–250 ตัวอักษร' }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, data: await searchCatalog(query), source: 'catalog' },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ success: false, error: 'คลังเพลงยังไม่พร้อมใช้งาน กรุณาลองใหม่ ไม่มีการค้น YouTube อัตโนมัติ' }, { status: 503 });
  }
}
