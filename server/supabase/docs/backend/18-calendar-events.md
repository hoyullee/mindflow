<!-- backend.md §18 — 색인: ../backend.md -->
## 18. Geurio 일정 (0033 `calendar_events`) — 일정 화면의 두 번째 원천

일정 화면(홈의 세 번째 화면)은 처음에 **칸반 카드의 마감**만 모았다. 칸반에 없는
일정(회의·휴가·개인 약속)을 적을 자리가 없어서, 사용자는 "일정 하나 적으려고" 칸반
카드를 만들어야 했다. 0033이 그 자리다.

### 왜 별도 표인가 (문서 본문이 아니라)

| 이유 | 설명 |
| --- | --- |
| **사람에 붙는다** | 캘린더는 문서가 아니라 per-user 뷰다 — 본문(jsonb)에 넣으면 "누구의 일정인가"에 답이 없고 스페이스·공유에 얽힌다 |
| **수명이 다르다** | 문서를 지워도 내 일정은 남아야 한다 |
| **본문은 통째로 오간다** | 자동저장마다 전문이 오르내리므로 일정이 늘수록 저장·전송이 무거워지고, CRDT 병합 대상이 되어 끊긴 채 양쪽이 적으면 한쪽이 사라진다(0020 댓글과 같은 판단) |

### 스키마의 결정 셋

- **날짜는 로컬 날짜 문자열**(`date`, `YYYY-MM-DD`) — 칸반 `due`/`start`가 그 꼴이고,
  타임존을 끌어들이면 같은 종일 일정이 기기마다 다른 날에 놓인다(종일 일정의 고전적 함정).
- **시각은 `HH:MM` 텍스트 + 쌍 제약** — `start_time`/`end_time`은 **둘 다 있거나 둘 다
  없다**(`calendar_events_times`). 하나만 있으면 그릴 수 없다. 꼴도 정규식으로 막는다.
- **`end_date >= start_date`**(`calendar_events_range`) — 여러 날 일정의 마지막 날은 포함.
- `source`/`google_id`를 미리 둔다 — 구글 캘린더는 **선택적 거울**이라는 설계 결정에 따라
  우리 표가 정본이고, 연동되면 그 일정을 여기에 미러링하거나 겹쳐 그린다.

RLS는 넷 다 `owner = auth.uid()`이고 **UPDATE를 직접 연다** — 알림 우편함(0022)과 같은
판단이다: 이 표에는 남의 행이 섞여 있지 않아 어떤 컬럼을 바꿔도 피해자가 자기 자신뿐이라,
컬럼을 좁히려고 RPC를 두던 0019·0021의 이유가 여기엔 없다. `owner`는 클라이언트가 보내지
않는다(표의 default가 `auth.uid()`), `updated_at`은 트리거가 찍는다(0015와 같은 이유).

### 조회는 "보이는 6주 격자"

```sql
select * from calendar_events
 where start_date <= '<격자 마지막 날>' and end_date >= '<격자 첫날>'
 order by start_date;
```

월 격자가 항상 6주라 구간이 **달 경계를 넘는다**(`gridRange()`가 그 값을 만든다 — 목록이
세는 것과 격자가 그리는 것이 같아야 한다). 인덱스는 `(owner, start_date)`.

### 적용 확인

```sql
select count(*) from information_schema.tables
 where table_schema='public' and table_name='calendar_events';
select policyname from pg_policies where tablename='calendar_events';
select conname from pg_constraint where conrelid='public.calendar_events'::regclass and contype='c';
```

1행 / 4행 / 4행(range·times·time_fmt·source)이면 적용된 것이다. 파일 하나가 트랜잭션이라
**한 문장이 실패하면 파일 전체가 롤백**된다(0023의 교훈) — 급하면
`supabase/migrations/0033_calendar_events.sql`을 SQL Editor에 그대로 붙여 넣어도 된다
(전 문장이 재실행 가능하게 쓰여 있다).

### 배포 순서 안전

표가 없는 서버에서도 일정 화면은 깨지지 않는다 — 조회는 콘솔 경고와 함께 **빈 목록**으로
물러나고(칸반 마감은 그대로 뜬다) 쓰기는 사람이 읽을 문구를 돌려준다. 데모(로컬) 모드는
`mf_events`에 쌓으며 **같은 계약**(겹침 조회 + 저장 전 정규화)을 지키므로, 모드에 따라
화면이 달라지지 않는다. 정규화(`normalizeEventInput`)는 두 어댑터가 같은 함수를 쓴다 —
표의 제약을 클라이언트에서도 지키는 단일 소스다.

### 반복 일정 (0034 `recurrence`)

`calendar_events.recurrence`에 **RRULE 한 줄**을 담는다(`RRULE:FREQ=WEEKLY;INTERVAL=2`).
구글에 만드는 일정이 이미 같은 형식을 쓰므로(`buildRecurrence`) 규칙을 두 벌로 두지 않는다.

- **한 행 = 하나의 반복.** 회차별 예외(그 날만 시간 변경·그 날만 삭제)는 두지 않는다 —
  담으려면 별도 표와 "이 회차만/전체" 분기가 필요하다. 그래서 화면은 회차를 **끌어서
  옮기지 못하게** 하고, 상세 팝업이 "고치거나 삭제하면 전체 반복에 적용돼요"라고 적는다.
- **펼치는 일은 클라이언트가 한다**(`expandRecurrence`) — 서버가 펼치면 같은 규칙을 두
  곳에서 해석하게 되고, 달력이 그리는 것과 목록이 세는 것이 어긋날 수 있다.
- **조회는 반복 행의 `end_date`를 보지 않는다**(첫 회차가 몇 달 전이어도 이번 달에 회차가
  있다): `start_date <= 끝날 and (end_date >= 첫날 or recurrence is not null)`.
  그 행만 빠르게 고르도록 부분 인덱스(`calendar_events_recurring_idx`)를 둔다.
- **0034 미적용 서버**에서도 깨지지 않는다: 조회는 예전 질의로 물러나고(반복만 빠진다),
  저장은 규칙을 뺀 채 한 번 더 시도한다(일정 자체는 남는다). 둘 다 콘솔 경고를 남긴다.

적용 확인:

```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='calendar_events' and column_name='recurrence';
```
