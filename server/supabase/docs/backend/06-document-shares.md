<!-- backend.md §6 — 색인: ../backend.md -->
## 6. 문서 공유 (0009) — 사람 사이의 실시간 공동 편집

M5/M5-awareness가 Yjs 동기화와 커서 공유를 붙였지만, **`documents`가 소유자 전용이라
다른 사람과는 공동 편집이 불가능했습니다** — 상대가 문서를 아예 읽을 수 없으니 협업할
대상이 없었죠. `0009_document_shares.sql`이 그 구멍을 메웁니다.

- **`document_shares`** — `(document_id, invitee_email)` PK, `role`(`edit`/`view`),
  `invited_by`. 초대 대상이 uuid가 아니라 **이메일**인 이유: 클라이언트는 `auth.users`를
  읽을 수 없어 이메일 → uuid 변환을 할 수 없고, 이메일로 두면 **아직 가입하지 않은
  사람도 초대**할 수 있습니다(그 이메일로 가입하는 순간 권한이 생김). 트리거가 항상
  `lower(trim())`으로 정규화합니다.
- **`documents` 정책 확장** — SELECT는 `소유자 OR 공유(view 이상)`, UPDATE는
  `소유자 OR 공유(edit)`. INSERT/DELETE는 소유자 전용 그대로.
- **순환 방지** — `documents` 정책이 `document_shares`를 참조하고 그 반대도 필요하므로,
  판정을 `owns_document()` / `shared_with_me()` **SECURITY DEFINER** 함수로 빼서 정책
  재귀를 끊었습니다.
- **Realtime 채널 인증(중요)** — 문서 내용은 `mindflow-collab:<docId>` 브로드캐스트
  채널을 흐르는데 **여기에 아무 인증이 없었습니다**. anon 키는 클라이언트 번들에 공개돼
  있으므로 docId를 아는 사람은 누구나 붙어 편집 내용을 받아 보거나 주입할 수 있었습니다
  (특히 예전 방식 id는 `m<제목해시>` — 제목만 알면 계산됩니다). 0009가 `realtime.messages`에
  RLS를 걸어 채널 참가(SELECT)와 발신(INSERT)을 문서 권한과 묶고, 클라이언트는
  `channel(name, { config: { private: true } })`로 붙습니다.

  ⚠️ **`realtime` 스키마는 우리 소유가 아닙니다.** 마이그레이션 실행 역할에 권한이 없으면
  이 블록만 실패하는데, 그때 배포 전체가 막히지 않도록 예외를 잡아 NOTICE만 남깁니다.
  **그 경우 채널은 예전처럼 열린 상태로 남습니다.**

  **수동 적용 절차 (실 프로젝트에서 검증됨, 2026-07)** — SQL Editor는 `postgres`로 돌고
  `realtime.messages`의 소유자는 `supabase_realtime_admin`이라, 0009의 `do` 블록을
  SQL Editor에 그대로 붙여 넣으면 **예외 가드가 오류를 삼켜 "Success"처럼 보이지만
  아무것도 적용되지 않습니다.** 실제로 필요한 건 이것뿐입니다:
  1. `alter table … enable row level security`는 **실행하지 않는다** — 소유자가 아니라
     `must be owner of table messages`(42501)로 실패하고, 최신 프로젝트는 애초에 RLS가
     이미 켜져 있다(`select relrowsecurity from pg_class where
     oid = 'realtime.messages'::regclass;` → `t`).
  2. 0009 마지막 블록에서 **`create policy` 두 개(+ 앞의 `drop policy if exists`)만**
     꺼내 SQL Editor에서 실행한다 — 정책 생성은 `postgres`로도 통과한다.
  3. 확인: `select policyname from pg_policies where schemaname='realtime';`에
  `collab_channel_read`/`collab_channel_write`가 보이면 적용된 것입니다. 두 계정의
  탭을 새로고침해 우상단 경고 아이콘이 사라졌는지도 확인하세요.

  **정책이 없으면 어떻게 되는지(그리고 왜 조용히 죽지 않는지)** — private 채널은 서버
  정책이 없으면 **구독 자체가 거부**되고, 그러면 문서 동기화·접속자·커서가 **한꺼번에**
  죽습니다(전부 같은 채널을 씁니다). 실제로 배포 후 그렇게 터졌고, 아무도 구독 상태를
  보지 않아 화면상 "혼자 있는 것"과 구분되지 않았습니다. 그래서 클라이언트
  (`collab/SupabaseRealtimeProvider.ts`)는 이제:
  1. private으로 붙고, 구독 전 `realtime.setAuth()`를 **await**해 소켓에 사용자 JWT를
     실어 줍니다. (기다리지 않던 시절엔 토큰이 늦게 실리는 레이스로 **한 탭만** 폴백해
     한쪽은 private·한쪽은 public에 앉았고 — 같은 이름이어도 두 모드는 서로 메시지가
     오가지 않아 — 협업이 조용히 죽었습니다.)
  2. 구독이 거부되면 private을 **한 번 재시도**한 뒤 **공개 채널로 폴백**합니다 —
     협업이 통째로 죽는 것보다 낫지만, 상태를 `connected-insecure`로 올려 보내 에디터
     우상단에 경고 아이콘이 뜨고 콘솔에 실패 사유와 조치 방법(이 문단)을 남깁니다.
  3. 구독은 되지만 **발신만 거부**되는 조합(읽기 정책만 적용된 경우)도 잡습니다 —
     `broadcast: { ack: true }`로 서버 확인을 받아, 첫 sync-request가 **명시적 오류**로
     ack되면 같은 폴백을 탑니다. ack가 단순히 늦거나 오지 않는 것(timed out)은 강등
     사유가 아닙니다 — 그걸로 강등하면 정책이 멀쩡한 서버에서도 전원이 공개 채널로
     떨어집니다(실제 그랬습니다).
  4. 공개 채널로도 못 붙으면 `offline` — 우상단에 "실시간 연결 끊김"이 뜹니다.
  5. **메시지 유실 자가 치유** — Realtime은 끊긴 동안의 브로드캐스트를 재전송하지
     않는데, Yjs 업데이트는 증분이라 하나를 놓치면 이후 업데이트 전부가 보류됩니다
     (커서는 절대 상태라 저절로 복구 — 그래서 "커서는 보이는데 편집만 안 온다"는
     증상이 됩니다). 각 클라이언트가 15초마다 상태 벡터(`ysv`)를 방송하고, 받은 쪽이
     빠진 연산만 diff로 돌려줘 한 주기 안에 메워집니다(삭제는 상태 벡터에 안 잡히므로
     diff의 delete set이 함께 나릅니다). join 밖에서는 send하지 않습니다 — 예전엔
     realtime-js가 REST로 우회 전송해 콘솔 스팸("falling back to REST API")과 반쪽
     발신을 만들었습니다.

  디버깅 팁: 콘솔 첫 줄의 `[geurio] build <시각>`으로 지금 어느 빌드가 떠 있는지 확인할
  수 있습니다. PWA는 에디터가 열려 있는 동안 업데이트를 미루므로, "고쳤다는데 그대로"의
  절반은 이전 번들이었습니다 — 모든 탭을 닫았다 다시 열면 새 빌드가 적용됩니다.

  즉 정책을 적용하지 않아도 공동 편집은 동작하지만(공개 채널), 그동안은 docId를 아는
  사람이 끼어들 수 있습니다. 경고가 보이면 위 `do` 블록을 실행하세요.
- **권한 UI는 `edit`만** 노출합니다. `view`는 컬럼·정책에 준비돼 있지만, 뷰어를 제대로
  만들려면 CRDT로 자기 편집이 상대에게 전파되는 것부터 막아야 해서 별도 작업입니다.
- 어댑터: `adapters/supabase/supabaseShareStore.ts`(실제), `adapters/local/localShareStore.ts`
  (데모 — 목록 계약만 동일하게 유지하고 실제 접근은 열어 주지 않습니다).
