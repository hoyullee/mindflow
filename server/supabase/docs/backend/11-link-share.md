<!-- backend.md §11 — 색인: ../backend.md -->
## 11. 링크 공유 (0017 `documents.link_role`)

### 무엇을 여는가

"링크를 아는 사람은 **열람**." 공유 팝업의 `링크가 있는 사람은 열람` 토글이
`documents.link_role`을 `'view'`로 바꾼다. 끄면 `null`이 되고 같은 주소도 즉시
막힌다.

**링크의 비밀은 문서 id 그 자체다** — 주소가 `/editor?map=<docId>`이고 id는 랜덤이라
추측할 수 없다. 별도 토큰을 두지 않은 이유: 회수 수단이 "끄기"로 충분하고, 토큰을
두면 주소가 둘(문서 주소 / 공유 주소)이 되어 사용자가 어느 것을 붙여넣었는지에 따라
결과가 달라진다.

### 이번 범위에서 **의도적으로 제외한 것**

- **편집 링크.** `check (link_role is null or link_role = 'view')`가 DB에서 막는다.
  링크는 유출되면 끄기 전까지 회수할 수 없는데, 열람은 피해가 "봤다"에서 멈추지만
  편집은 내용을 되돌릴 수 없게 만든다. 열려면 제약을 푸는 **의도적인** 마이그레이션이
  필요하다(그때 `documents_update_*` 정책도 함께 손봐야 한다).
- **익명 열람.** `anon` 역할에는 아무것도 열지 않았다(`link_shared`의 execute도
  회수). 익명을 열려면 공개 라우트 + 익명 RLS + 익명 이미지 서명 URL + 저장/협업
  비활성이 함께 필요하다 — 별도 작업이다.

### 클라이언트가 뷰어를 알아보는 방법

링크로 들어온 사람은 `document_shares`에 **행이 없다**. 그런데 소유자도 자기 행이
없어서, 초대 목록만으로는 둘이 구별되지 않는다. 그래서 `DocStore.load()`가
`owner`를 함께 읽어 `ownedByMe`를 실어 준다:

> 내 문서가 아닌데(`ownedByMe === false`) 초대 행도 없다 → **링크로 열었다** → 보기 전용

이건 어포던스일 뿐이고 진짜 게이트는 RLS다(링크는 SELECT만 열고 UPDATE는 열지
않는다). 이 판별이 없으면 뷰어에게 편집 UI를 내주고 저장만 서버가 거부하는 화면이
된다.

### 이미지도 함께 열린다

0016의 `map images readable by document readers` 정책을 0017이 다시 만들어
`link_shared(...)`를 더한다. 이게 없으면 링크로 연 사람에게 **본문은 보이는데 사진
자리마다 회색 자리표시자**가 뜬다.

### 배포

`supabase/migrations/0017_document_link_share.sql`은 GitHub 연동으로 자동 배포된다.
수동 적용도 파일 전체를 SQL Editor에서 그대로 실행하면 된다(재실행 가능 — `add
column if not exists`, `create or replace`, `drop policy if exists`).

### 확인

```sql
-- 컬럼과 제약
select column_name, data_type from information_schema.columns
where table_name = 'documents' and column_name = 'link_role';

-- 지금 링크가 열려 있는 문서
select id, title, link_role from public.documents where link_role is not null;

-- documents SELECT 정책에 링크 조건이 들어갔는지
select policyname, qual from pg_policies
where tablename = 'documents' and policyname = 'documents_select_own_or_shared';

-- 이미지 read 정책에 link_shared가 들어갔는지
select policyname, qual from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname = 'map images readable by document readers';
```

### 링크 뷰어에게 보이는 참가자 (0018)

배포 후 제보: 링크로 연 사람의 공유 팝업에 **소유자가 안 보이고**, 소유자 전용
UI(링크 토글·초대 입력)가 그대로 열려 있었다.

원인은 `share_participants` RPC(0011)의 가드였다 — `owns_document or
shared_with_me`만 통과시키는데 **링크 뷰어는 둘 다 아니다** → 빈 목록 → 클라이언트가
"구 서버"로 착각해 나를 소유자로 폴백. 서버 RLS가 실제 쓰기는 막고 있었으니 권한이
샌 것은 아니고, **할 수 없는 일을 할 수 있는 것처럼 보여 준** 화면이었다.

0018이 **소유자 행에만** `link_shared(doc_id)`를 더한다. 초대 명단은 그대로
`owns_document or shared_with_me`다 — 그 목록은 곧 **이메일 주소 목록**이고 링크는
누구에게나 전달될 수 있다. "이 맵이 누구 것인가"는 뷰어가 알아야 하지만 "누구누구가
초대돼 있는가"는 아니다.

클라이언트에도 잠금이 하나 더 있다(`ShareModal`의 `viewerOnly`) — 참가자 목록이
비어 오는 서버에서도 `readOnly` 하나로 공유 설정이 잠긴다.

### 전체 끄기(사고 대응)

```sql
update public.documents set link_role = null where link_role is not null;
```
