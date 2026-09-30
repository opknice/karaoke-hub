import { ExternalLink } from 'lucide-react';

interface YouTubeSearchFallbackProps {
  query: string;
  onPasteLink: () => void;
}

export function YouTubeSearchFallback({ query, onPasteLink }: YouTubeSearchFallbackProps) {
  const searchUrl = new URL('https://www.youtube.com/results');
  searchUrl.searchParams.set('search_query', query.trim());

  return (
    <aside aria-label="ค้นหาผ่าน YouTube และนำลิงก์กลับมา" className="my-3 rounded-xl border border-white/10 bg-zinc-950/95 p-3 text-xs text-zinc-300">
      <div className="flex flex-wrap items-center gap-3">
        <a href={searchUrl.toString()} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 font-semibold text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          ค้นหาบน YouTube (แท็บใหม่)
        </a>
        <button type="button" onClick={onPasteLink}
          className="rounded-lg border border-zinc-600 px-3 py-2 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          วางลิงก์ในช่องค้นหา
        </button>
      </div>
      <p className="mt-2">ค้นในแอปไม่เจอหรือโควตาหมด: เปิด YouTube → คัดลอกลิงก์วิดีโอ → กลับมาวางในช่องค้นหา → กด Enter → เลือกเพิ่มเข้าคิว</p>
      <p className="mt-1 text-zinc-400">การค้นบนเว็บ YouTube ไม่ใช้โควตา Search ของแอป การตรวจลิงก์ยังใช้โควตารายละเอียดวิดีโอ และวิดีโอต้องอนุญาตให้เล่นแบบฝัง</p>
    </aside>
  );
}
