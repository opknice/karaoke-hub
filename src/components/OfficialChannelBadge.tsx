import { getOfficialYouTubeChannel } from '@/lib/official-youtube-channels';

export function OfficialChannelBadge({ channelId }: { channelId: string | undefined }) {
  const channel = getOfficialYouTubeChannel(channelId);
  if (!channel) return null;
  return (
    <span className="inline-block rounded border border-sky-400/30 bg-sky-950 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200"
      title={`ช่องทางการในรายการที่แอปตรวจสอบ: ${channel.name} (ไม่ใช่เครื่องหมายยืนยันของ YouTube)`}>
      Official · ตรวจสอบโดยแอป
    </span>
  );
}
