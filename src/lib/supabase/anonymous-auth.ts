import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export interface SupabaseIdentity {
  accessToken: string;
  userId: string;
}

export async function ensureSupabaseIdentity(): Promise<SupabaseIdentity> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error('ระบบยืนยันตัวตนยังไม่พร้อมใช้งาน');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(`ไม่สามารถตรวจสอบตัวตนได้: ${sessionError.message}`);
  }

  if (sessionData.session) {
    return {
      accessToken: sessionData.session.access_token,
      userId: sessionData.session.user.id,
    };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session || !data.user) {
    throw new Error(`ไม่สามารถเริ่มเซสชันผู้ใช้ได้${error ? `: ${error.message}` : ''}`);
  }

  return {
    accessToken: data.session.access_token,
    userId: data.user.id,
  };
}
