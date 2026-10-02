import { NextRequest, NextResponse } from 'next/server';
import { getCurrentCatalogVideo } from '@/lib/local-catalog-export';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ success: false, error: 'video ID ไม่ถูกต้อง' }, { status: 400 });
  }
  try {
    const video = await getCurrentCatalogVideo(id);
    return NextResponse.json({ success: true, video }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ success: false, error: 'ตรวจสอบเพลงกับคลังออนไลน์ไม่สำเร็จ' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
