-- 지난 날짜의 미공개 예약(옛 자동 순서표)은 후보 제외 사유가 아니다.
-- (relay_choose_hero / relay_replace_today 재정의: Supabase 대시보드 마이그레이션 002_relay_candidate_rule 참고)
-- 트리거 전용 함수는 직접 호출 불가
revoke execute on function public.attendance_fill() from authenticated;
revoke execute on function public.relay_record_activity() from authenticated;
