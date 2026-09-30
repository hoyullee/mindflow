<!-- backend.md §1c — 색인: ../backend.md -->
## 1c. 로컬 개발 PC에서 실 백엔드 연결 (Windows 포함)

1. **Node LTS + pnpm**: `node -v`(20/22 권장) 확인 후 `corepack enable`
   (또는 `npm i -g pnpm@10`). 리포의 `packageManager: pnpm@10.33.0`이 버전을
   고정하므로 corepack이 첫 실행 때 정확한 버전을 받음(`Y`로 승인).
   - Windows에서 `pnpm.ps1 ... 스크립트를 실행할 수 없으므로` 에러 →
     `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 한 번 실행.
   - `corepack enable`이 EPERM → 관리자 PowerShell에서 한 번 실행.
2. **env 파일**: `apps/web/.env.example`을 복사해 **`apps/web/.env.local`**
   생성(리포 루트 아님!) 후 값 채우기 — 둘 다 있어야 Supabase 모드:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable key>
   ```
   - 키는 `Project Settings → API Keys`의 **Publishable key**
     (`sb_publishable_...`) — 신형 키 이름이며 레거시 `anon` 키와 동등.
     변수명은 역사적 이유로 `ANON_KEY` 그대로. **`sb_secret_...`은 절대 금지.**
   - 메모장이 `.env.local.txt`로 저장하는 함정 주의. 값에 따옴표/공백 금지.
3. **코어 선빌드** (fresh clone 1회):
   `pnpm --filter @mindflow/mindmap-core build`
   — `apps/web`은 코어의 `dist/`를 참조하므로, 없으면
   `Failed to resolve entry for package "@mindflow/mindmap-core"` 에러.
4. `pnpm install` → `pnpm -C apps/web dev` → `http://localhost:5173`.
   env 파일을 고쳤다면 dev 서버 재시작 필수(시작 시 1회만 읽음).

### 트러블슈팅

| 증상 | 원인/해결 |
| --- | --- |
| 구글 버튼 클릭 시 구글 화면 없이 즉시 로그인 | env 미적용 = 데모 모드. 프로필 이메일이 `demo-google@mindflow.local`이면 확정. §1c-2/4 점검 |
| `redirect_uri_mismatch` | ①-3 리디렉션 URI가 Supabase Callback URL과 불일치 |
| `액세스 차단됨: 확인되지 않은 앱` | 테스트 사용자 미등록(①-2) 또는 게시 필요 |
| env가 안 읽힘 | 파일 위치(`apps/web/`)·이름(`.txt` 없음)·재시작 여부, 콘솔에서 `import.meta.env.VITE_SUPABASE_URL` 확인 |
| `Failed to resolve entry ... mindmap-core` | 코어 미빌드 — §1c-3 |
