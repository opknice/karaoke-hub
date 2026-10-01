import { NextResponse } from 'next/server';
import { syncOfficialCatalogDaily } from '@/lib/youtube-catalog';
import { cleanupSearchState } from '@/lib/youtube-search-store';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET is not configured.');
    return NextResponse.json({ success: false, error: 'Cron is not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncOfficialCatalogDaily();
    await cleanupSearchState();
    for (const message of result.messages) console.info(`[cron] ${message}`);
    return NextResponse.json({ success: true, ...result }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: unknown) {
    console.error('[cron] Daily catalog sync failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Daily catalog sync failed',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
