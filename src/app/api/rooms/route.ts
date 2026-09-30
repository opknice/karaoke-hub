import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
const MAX_ROOM_NAME_LENGTH = 80;
const MAX_NICKNAME_LENGTH = 40;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateRoomCode(value: unknown): string | null {
  const roomCode = readTrimmedString(value).toUpperCase();
  return ROOM_CODE_PATTERN.test(roomCode) ? roomCode : null;
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== 'string') {
      return NextResponse.json({ success: false, error: 'คำขอไม่ถูกต้อง' }, { status: 400 });
    }

    const { action } = body;
    const supabase = getAdminClient();

    if (!supabase) {
      console.error('Room API is unavailable because the Supabase server configuration is incomplete.');
      return NextResponse.json(
        { success: false, error: 'ระบบห้องยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ' },
        { status: 503 }
      );
    }

    const accessToken = readBearerToken(request);
    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'กรุณาเริ่มเซสชันผู้ใช้ใหม่' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return NextResponse.json({ success: false, error: 'เซสชันผู้ใช้ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });
    }

    // 1. CREATE or ENSURE ROOM
    if (action === 'create') {
      const requestedCode = readTrimmedString(body.roomCode);
      const roomCode = requestedCode
        ? validateRoomCode(requestedCode)
        : Math.random().toString(36).substring(2, 8).toUpperCase();
      if (!roomCode) {
        return NextResponse.json(
          { success: false, error: 'รหัสห้องต้องเป็นตัวอักษรอังกฤษหรือตัวเลข 4-12 ตัว' },
          { status: 400 }
        );
      }

      const requestedName = readTrimmedString(body.name);
      if (requestedName.length > MAX_ROOM_NAME_LENGTH) {
        return NextResponse.json(
          { success: false, error: `ชื่อห้องต้องไม่เกิน ${MAX_ROOM_NAME_LENGTH} ตัวอักษร` },
          { status: 400 }
        );
      }
      const roomName = requestedName || `Karaoke Party ${roomCode}`;

      const { data, error } = await supabase.rpc('create_karaoke_room_for_user', {
        p_host_user_id: userData.user.id,
        p_room_code: roomCode,
        p_name: roomName,
      });

      if (error || !isRecord(data)) {
        console.error('Error creating room in Supabase:', error);
        if (error?.code === '23505') {
          return NextResponse.json(
            { success: false, error: 'รหัสห้องนี้ถูกใช้งานแล้ว กรุณาลองสร้างห้องใหม่' },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { success: false, error: 'ไม่สามารถสร้างห้องในระบบได้' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, room: data.room, member: data.member });
    }

    // 2. JOIN ROOM
    if (action === 'join') {
      const roomCode = validateRoomCode(body.roomCode);
      const nickname = readTrimmedString(body.nickname);

      if (!roomCode) {
        return NextResponse.json({ success: false, error: 'รหัสห้องไม่ถูกต้อง' }, { status: 400 });
      }
      if (!nickname || nickname.length > MAX_NICKNAME_LENGTH) {
        return NextResponse.json(
          { success: false, error: `ชื่อเล่นต้องมีความยาว 1-${MAX_NICKNAME_LENGTH} ตัวอักษร` },
          { status: 400 }
        );
      }

      const { data, error } = await supabase.rpc('join_karaoke_room_for_user', {
        p_user_id: userData.user.id,
        p_room_code: roomCode,
        p_nickname: nickname,
      });

      if (error || !isRecord(data)) {
        console.error('Failed to join room:', error);
        if (error?.code === 'P0002') {
          return NextResponse.json(
            { success: false, error: `ไม่พบห้องรหัส "${roomCode}" กรุณาตรวจสอบรหัสห้องอีกครั้ง` },
            { status: 404 }
          );
        }
        return NextResponse.json(
          { success: false, error: 'ไม่สามารถเข้าร่วมห้องได้ กรุณาลองใหม่' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, room: data.room, member: data.member });
    }

    return NextResponse.json({ success: false, error: 'การกระทำไม่ถูกต้อง' }, { status: 400 });
  } catch (err) {
    console.error('API /api/rooms error:', err);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดในการประมวลผล' },
      { status: 500 }
    );
  }
}
