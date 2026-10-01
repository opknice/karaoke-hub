import { NextResponse } from 'next/server';
import { getTopCatalogVideos } from '@/lib/youtube-catalog';

export const runtime = 'nodejs';

// This endpoint deliberately reads the existing catalog only. It does not
// call YouTube or start a synchronization job when a guest opens the room.
export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      data: await getTopCatalogVideos(50),
      source: 'catalog',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({
      success: false,
      error: 'คลังเพลงยอดนิยมยังไม่พร้อมใช้งาน กรุณาลองใหม่',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
