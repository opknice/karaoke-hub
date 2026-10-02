import { NextRequest, NextResponse } from 'next/server';
import { searchKaraokeVideos, YouTubeSearchError } from '@/lib/youtube';
import { getSearchBudget } from '@/lib/youtube-search-store';
import { randomUUID } from 'node:crypto';
import { saveCatalogVideos, searchCatalogWithRefresh } from '@/lib/youtube-catalog';
import { isOfficialChannelTitleExcluded } from '@/lib/official-youtube-channels';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const existingClient = request.cookies.get('karaoke-search-client')?.value;
  const client = existingClient && /^[a-zA-Z0-9-]{1,64}$/.test(existingClient) ? existingClient : randomUUID();
  const reply = async (body: Record<string, unknown>, status = 200) => {
    let budget: Awaited<ReturnType<typeof getSearchBudget>> | undefined;
    try { budget = await getSearchBudget(); } catch { /* Keep the original storage error visible. */ }
    const response = NextResponse.json({ ...body, budget }, { status, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set('karaoke-search-client', client, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 86400 * 30 });
    return response;
  };
  try {
    const body: unknown = await request.json().catch(() => null);
    const query = typeof body === 'object' && body !== null && 'query' in body ? body.query : undefined;
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 250) {
      return reply({ success: false, error: 'กรุณาระบุคำค้น 2–250 ตัวอักษร' }, 400);
    }
    const source = typeof body === 'object' && body !== null && 'source' in body ? body.source : 'catalog';
    if (source !== 'catalog' && source !== 'youtube') return reply({ success: false, error: 'แหล่งค้นหาไม่ถูกต้อง' }, 400);
    const direct = /^(?:https?:\/\/|id:)/i.test(query.trim());
    if (source === 'catalog' && !direct) {
      const { videos, warning } = await searchCatalogWithRefresh(query);
      return reply({ success: true, count: videos.length, data: videos, source, warning });
    }
    const results = (await searchKaraokeVideos(query, client)).filter((video) => (
      !isOfficialChannelTitleExcluded(video.channel_id, video.title)
    ));
    let warning: string | undefined;
    try { await saveCatalogVideos(results); }
    catch { warning = 'แสดงผลได้ แต่ยังบันทึกเพลงลงคลัง Supabase ไม่สำเร็จ'; }
    return reply({ success: true, count: results.length, data: results, source: direct ? 'video' : 'youtube', warning });
  } catch (error: unknown) {
    console.error('Error in /api/search:', error);
    const status = error instanceof YouTubeSearchError ? error.status : 500;
    return reply(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search karaoke videos',
      },
      status
    );
  }
}
