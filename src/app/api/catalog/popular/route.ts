import { NextResponse } from 'next/server';
import { getPopularCatalogPage } from '@/lib/youtube-catalog';

export const runtime = 'nodejs';

// This endpoint deliberately reads the existing catalog only. It does not
// call YouTube or start a synchronization job when a guest opens the room.
export async function GET(request: Request) {
  const offsetParam = new URL(request.url).searchParams.get('offset') ?? '0';
  if (!/^(0|[1-9]\d*)$/.test(offsetParam) || !Number.isSafeInteger(Number(offsetParam))) {
    return NextResponse.json({ success: false, error: 'ตำแหน่งรายการเพลงไม่ถูกต้อง' }, { status: 400 });
  }
  try {
    const page = await getPopularCatalogPage(Number(offsetParam));
    return NextResponse.json({
      success: true,
      data: page.videos,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
      source: 'catalog',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({
      success: false,
      error: 'คลังเพลงยอดนิยมยังไม่พร้อมใช้งาน กรุณาลองใหม่',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
