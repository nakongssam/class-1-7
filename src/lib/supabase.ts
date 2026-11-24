import { createClient } from "@supabase/supabase-js";

// 브라우저용 공개 키 (비밀 아님). 데이터 접근은 DB의 행 단위 보안 정책으로 막는다.
export const SUPABASE_URL = "https://tqdkwptubovtcxpinmgi.supabase.co";
export const SUPABASE_KEY = "sb_publishable_CxVENJVFoNtjZkJGYjMaxA_UxzpvuWT";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "class-1-7-auth" },
});

type FnResult = { ok: boolean; error?: string; [k: string]: unknown };

export async function callFn<T extends FnResult = FnResult>(name: "auth" | "ai", body: Record<string, unknown>): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      ...(s.session ? { Authorization: `Bearer ${s.session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, error: "서버에 연결하지 못했어요." }));
  return data as T;
}

export type Student = {
  id: string;
  student_no: string;
  name: string;
  role: "student" | "teacher" | "test";
  user_id: string | null;
  revealed: boolean;
  active: boolean;
  relay_reviewed_at?: string | null;
};
