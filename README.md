# 1-7 우리반

천안오성고 1학년 7반 통합 학급 앱. 따로 쓰던 세 앱을 하나로 합쳤습니다.

| 메뉴 | 예전 앱 |
|---|---|
| 🌱 출결 (보고·내 기록·내 정원·월말 확인) | Attendance Hero |
| 💌 칭찬 릴레이 (주인공·편지·AI 검사·결과 공개·인쇄) | Kindwords Classmate Spotlight |
| 📚 스터디그룹 (그룹 신청·활동일지·사진 인증·생기부 초안) | Pair And Progress |

- **로그인**: 학번 + 칭찬 릴레이에서 쓰던 4자리 비밀번호. 처음이거나 초기화된 학생은 생년월일 6자리로 들어와 새로 정합니다.
- **교사**: 10700 계정 하나로 모든 교사 화면(출결·칭찬·스터디·학생 계정·내보내기)을 씁니다.
- **데이터**: Supabase 「1-7반 통합 앱」. 학생은 자기 기록만, 교사는 전체를 볼 수 있게 DB 정책으로 막혀 있습니다.

## 구조

```
src/            React 화면 (GitHub Pages에 정적 배포)
supabase/
  migrations/   DB 스키마·보안 정책
  functions/
    auth/       로그인·비밀번호 설정/변경/초기화
    ai/         칭찬 편지 AI 검사·순화, 생기부 초안 (Claude API, 키는 Supabase Secrets의 ANTHROPIC_API_KEY)
```

## 배포

```bash
npm install
npm run build        # dist/ 생성
# dist/ 내용을 gh-pages 브랜치에 올리면 Pages에 반영
```
