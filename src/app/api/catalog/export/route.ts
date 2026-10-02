import { NextRequest, NextResponse } from 'next/server';
import { getLocalCatalogPage } from '@/lib/local-catalog-export';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get('cursor');
  if (cursor !== null && !/^[A-Za-z0-9_-]{11}$/.test(cursor)) {
    return NextResponse.json({ success: false, error: 'cursor ไม่ถูกต้อง' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getLocalCatalogPage(cursor), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'ดาวน์โหลดข้อมูลคลังเพลงไม่สำเร็จ กรุณาลองใหม่' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
