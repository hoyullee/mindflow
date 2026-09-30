<!-- backend.md §14 — 색인: ../backend.md -->
## 14. 알림 우편함 (0022 `notifications`) — 홈 알림 센터

알림의 종류가 셋을 넘었다(공유 초대·멘션·답글·새 댓글) — 종류마다 배지를 늘리는
대신 우편함 하나에 모으고, 홈 툴바의 종(벨) 버튼이 읽는다.

### 클라이언트는 알림을 만들지 못한다

insert 정책이 없다 — 전부 **DB 트리거**가 만든다. 클라이언트 insert를 열면 로그인한
아무나 남의 우편함에 "당신이 멘션됐다"를 꽂을 수 있다(share-invite 함수가 초대를
서버에서 재확인하는 것과 같은 원칙: 알림의 근거는 서버가 본 사실이어야 한다).

| 트리거 | 시점 | 알림 |
| --- | --- | --- |
| `document_comments_notify` | 댓글 insert | 멘션된 사람(`mention`) → 스레드 뿌리 작성자(`reply`) → 문서 소유자(`comment`) — 우선순위 순, 같은 사람에게 한 번만, 자기 행동은 제외 |
| `document_shares_notify` | 공유 insert | 초대받은 사람(`share`) — upsert의 UPDATE(권한 변경)는 insert 트리거를 타지 않으므로 **처음 초대에만** |

아직 가입하지 않은 이메일은 우편함(auth.users 행)이 없어 알림도 없다 — 가입하면
LNB '공유받음' 배지(0019)가 그 역할을 한다.

### 읽기·읽음 처리

RLS는 전부 `recipient = auth.uid()`. UPDATE를 (0019·0021의 RPC 패턴과 달리) 직접
연 이유: 이 행에는 남의 것이 섞여 있지 않다 — 자기 알림의 어떤 컬럼을 바꿔도
피해자가 자기 자신뿐이라 컬럼을 좁힐 이유가 없다.

읽음 처리 시점은 **알림 센터를 열었을 때 전부**(0019 공유 배지와 같은 규칙 —
목록이 한 화면이라 열었으면 본 것이다). 항목을 누르면 그 맵으로 가고, 댓글류는
`?comments=<nodeId>`로 에디터가 그 주제의 댓글 패널을 바로 연다.

### 배포·확인

0022는 GitHub 연동으로 자동 배포된다. 미적용 서버에서는 select가 실패하고
어댑터가 빈 배열로 넘어가 벨이 조용히 빈다(콘솔 경고).

```sql
-- 내 우편함 (Studio에서 특정 사용자로 확인)
select kind, actor_name, preview, doc_title, created_at, read_at
from public.notifications where recipient = '<uid>' order by created_at desc;
```

**메일 알림은 아직 없다** — 멘션의 이메일 명단(0021 `mentions`)과 Resend 인프라
(§12)가 준비돼 있으므로, 원하면 `share-invite`와 같은 꼴의 Edge Function으로 붙일
수 있다(시크릿 설정 전까지는 아무 일도 하지 않는 같은 계약으로).
