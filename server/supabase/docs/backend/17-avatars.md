<!-- backend.md §17 — 색인: ../backend.md -->
## 17. 프로필 이미지 (0031 `profiles.avatar_url` + Storage 버킷 `avatars`)

설정 → **프로필** 구획에서 사진을 고르면 그 얼굴이 홈과 세 에디터(마인드맵·화이트
보드·칸반)의 모든 아바타 자리에 함께 나타난다. 사진이 없거나 주소가 죽으면 지금처럼
이름 첫 글자로 되돌아간다 — 글자는 **이미지 아래에 늘 남겨 둔다**(깜빡임 없이 폴백).

### 저장 위치가 둘인 이유

| 어디 | 무엇 | 왜 |
| --- | --- | --- |
| Storage `avatars/<uid>/<ts>.webp` | 실제 파일 | 본문(jsonb)에 base64로 넣으면 문서마다 사진이 복사된다(0016과 같은 판단) |
| `auth.users.raw_user_meta_data.avatar_url` | 내 화면이 읽는 주소 | 세션에 실려 오므로 **왕복 0회**로 첫 페인트에 얼굴이 뜬다 |
| `public.profiles.avatar_url` | 남이 읽는 주소 | 다른 사람의 `auth.users`는 클라이언트가 못 읽는다 |

업로드 순서는 **파일 → users 메타 → profiles**이고, 마지막으로 그 폴더의 옛 파일을
지운다(실패해도 경고만 — 사진은 이미 바뀌었다). 경로 첫 조각이 uid라 Storage 정책이
`split_part(name,'/',1) = auth.uid()::text`로 "자기 폴더만 쓴다"를 강제한다. 읽기는
공개다 — 프로필 사진은 함께 쓰는 사람 누구에게나 보여야 하고, 파일 이름이 타임스탬프라
주소를 모르면 찾을 수 없다.

버킷은 **공개**이므로 서명 URL이 없다(0016의 `map-images`와 반대) → 주소가 안정적이라
브라우저·CDN 캐시가 그대로 살고(파일마다 `Cache-Control: 31536000`), 바꿀 때만 새 주소가
된다.

### 남이 쓴 사진을 어떻게 찾는가

`share_participants(text)`(0011)에 **`avatar_url`·`user_id` 두 칼럼을 더했다**(0031이
함수를 재정의한다 — 0018의 링크 뷰어 가드는 그대로). 이 RPC 하나로 칸반 담당(이메일
기준)·댓글 작성자·핀 얼굴(계정 id 기준)이 모두 해결된다:

- 담당 = `card.owner`(이메일) → `avatars.byEmail`
- 댓글·핀 = `comments.author`(uuid) → `avatars.byUserId`
- **내 얼굴은 참가자 목록에 없다** — 멘션 후보에서 나를 빼기 때문(의도) → 세션에서 직접

이름은 스냅샷(`author_name`, 0020)이지만 **사진은 조인**이라 바꾸면 옛 댓글의 얼굴까지
함께 바뀐다. 이름과 규칙이 다른 것은 의도다 — 얼굴은 "지금 이 사람"을 가리키는 표식이고,
이름은 "그때 그렇게 적혀 있었다"는 기록이다.

접속자 아바타(협업)는 서버를 거치지 않는다 — awareness의 `PresenceUser.avatar`에 실어
피어에게 곧바로 보낸다(이름·색과 같은 경로).

### 다듬기는 클라이언트에서

`avatarImage.ts`가 정사각으로 잘라 **256px webp**(품질 0.9, 120KB를 넘으면 0.75로 재인코딩)로
바꾼 뒤 올린다 — 원본을 그대로 올리면 사진 한 장이 수 MB가 되고 모든 화면이 그것을
내려받는다. webp를 못 만드는 브라우저는 png로 폴백.

### 적용 확인 · 수동 적용 (⚠️ 배포 전에는 업로드가 반드시 실패한다)

0031은 GitHub 연동으로 **`main` 머지 시점에** 적용된다 — 그전에는 버킷이 없어 업로드가
`400 / NoSuchBucket / "Bucket not found"`로 떨어진다(프리뷰 프런트엔드도 **프로덕션**
Supabase를 보므로 프리뷰에서 먼저 확인할 수 없다). 화면에는 원문 대신
"프로필 이미지 저장소가 아직 준비되지 않았어요"가 뜨고, 원문은 콘솔에 남는다.

적용됐는지 확인(SQL Editor):

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars';
select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'avatars%';
select column_name from information_schema.columns
 where table_schema='public' and table_name='profiles' and column_name='avatar_url';
```

세 질의가 각각 1행 / 4행 / 1행이면 적용된 것이다. 하나라도 비면 대시보드 →
**Database → Migrations**(또는 GitHub 연동 배포 이력)에서 0031이 실패로 남아 있는지
본다 — 파일 하나가 트랜잭션이므로 **한 문장이 실패하면 파일 전체가 롤백**된다(0023의
교훈). 급하면 `supabase/migrations/0031_profile_avatar.sql`을 SQL Editor에 그대로
붙여 넣어도 된다(전 문장이 재실행 가능하게 쓰여 있다 — `add column if not exists`,
`on conflict do update`, `drop policy if exists`, `drop function if exists`).

### 배포 순서 안전

`avatar_url` 칼럼·버킷이 없는 서버에서도 앱은 깨지지 않는다 — 어댑터가 실패를 문구로
돌려주고(설정 화면에 표시) 목록 조회는 사진 없이 그대로 뜬다. 데모(로컬) 모드는 파일을
data URL로 바꿔 `mf_profile_avatars`에 두고, 참가자 목록도 그 캐시에서 읽어 **같은 길**을
탄다(프로필명 캐시와 같은 규칙).
