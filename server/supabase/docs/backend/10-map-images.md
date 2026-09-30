<!-- backend.md §10 — 색인: ../backend.md -->
## 10. 첨부 이미지 (0016 Storage 버킷 `map-images`)

**왜 옮겼나.** 이미지는 문서 본문(jsonb)에 base64 데이터 URL로 인라인돼 있었다.
첨부 한 장이면 수백 KB라 ① 저장량·egress가 통째로 커지고 ② 실시간 협업에서는
**메시지 크기 한도(무료 250KB)를 넘겨 합류 동기화가 조용히 버려졌다** — 커서는
오는데 편집이 영영 안 오던 그 사고다. 이제 본문에는 `mfimg:<경로>` 참조만 남는다.

**왜 Supabase Storage인가.** 이미 쓰는 프로젝트 안이라 새 벤더·새 키·새 요금제가
없고, 무엇보다 `storage.objects`에 RLS를 걸 수 있어 **문서 권한 헬퍼
(`owns_document`/`shared_with_me`, 0009)를 그대로 재사용**한다 — 이미지 접근 권한이
문서 접근 권한과 자동으로 같아진다(공유하면 같이 보이고, 끊으면 같이 막힌다).
별도 저장소(R2/S3 등)를 쓰면 그 규칙과 서명 발급을 우리가 다시 만들어야 하는데,
이 앱에는 그걸 둘 서버가 없다.

**경로 규칙**: `<document_id>/<uuid>.<ext>`. 첫 조각이 문서 id라서 정책이
`split_part(name, '/', 1)`로 문서를 알아낸다.

**정책 요약** (0016):
| 동작 | 누구 |
| --- | --- |
| select(읽기) | 문서 소유자 또는 초대받은 사람(view 포함) |
| insert(쓰기) | 소유자 또는 **edit** 초대 |
| delete | 소유자만 (문서 영구 삭제 시 앱이 함께 정리) |

버킷은 **비공개**다. 화면에 그릴 때마다 만료 **12시간**짜리 서명 URL을 받고
(`SupabaseImageStore.resolve` → `createSignedUrls`), 만료 전에 11시간마다 다시
받는다(`useImageUrls`).

### 왜 수명이 12시간인가 — 무료 한도는 저장 용량이 아니라 **전송량**에서 먼저 닿는다

서명 URL을 갱신하면 URL 문자열이 바뀌고, 그러면 브라우저·CDN 캐시가 무효화돼 화면의
이미지를 **전부 다시 내려받는다**. 수명이 1시간이던 시절엔 맵을 하루 열어 둔 사용자
한 명이 이미지 10장(2MB)을 열 번 넘게 다시 받아 ≈20MB/일을 태웠다 — 그런 사용자
20명이면 무료 전송량(월 5GB)을 넘긴다. 12시간이면 한 세션에 URL 하나라 사실상
기기당 한 번만 내려받는다. 객체 자체의 `Cache-Control`도 1년으로 길게 준다(경로가
uuid라 같은 경로의 내용이 바뀌지 않는다).

트레이드오프는 **유출된 URL의 유효 시간**이다. 그래서 무한(공개 버킷)으로 가지 않고
12시간에서 끊는다.

**이미지는 WebP로 인코딩한다**(`pickImageFormat`, 지원하지 않는 브라우저는 예전대로
PNG/JPEG). 같은 체감 화질에서 JPEG 대비 실측 **48~60% 작다**(사진풍 55% · 스크린샷풍
48% · 그라디언트 60%) — 저장 용량과 전송량이 함께 절반이 되므로 실질 수용 인원이 약
두 배가 된다.

### 한도에 가까워지면

| 한도(무료) | 대략 감당 | 다음 수 |
| --- | --- | --- |
| 저장 1GB | 이미지 약 1만 장(WebP 기준) | Pro(100GB) |
| 전송 5GB/월 | 캐시가 도는 한 수백~수천 명 | Pro(250GB/월) |

업로드가 실패하면(용량 초과·권한·네트워크) 앱은 **본문 인라인으로 폴백**하고 사용자에게
독칩 배너로 알린다(`imageInlined`). 조용히 넘기면 실시간 메시지 크기 사고가 되살아나고
Postgres(무료 500MB)도 부푸므로, 이 배너가 보이기 시작하면 용량을 확인할 신호다.

### 배포

`supabase/migrations/0016_map_images.sql`은 GitHub 연동으로 자동 배포된다. 수동으로
적용하려면 SQL Editor에서 파일 전체를 그대로 실행하면 된다(재실행 가능 —
버킷은 `on conflict do nothing`, 정책은 `drop … if exists` 후 생성).

### 확인

```sql
-- 버킷
select id, public, file_size_limit from storage.buckets where id = 'map-images';
-- 정책 3개
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'map images%';
-- 문서별 사용량
select split_part(name, '/', 1) as doc_id, count(*) files,
       pg_size_pretty(sum((metadata->>'size')::bigint)) as size
from storage.objects where bucket_id = 'map-images' group by 1 order by 3 desc;
```

### 옛 문서 이전 · 정리

- **이전은 자동**이다. 인라인 이미지가 있는 맵을 열면 에디터가 실물을 올리고 본문을
  참조로 바꿔 저장한다(`useEditorState`의 `imageMigratedRef` 효과). 실패해도 문서는
  온전하다 — 올라간 것만 참조가 되고 나머지는 인라인으로 남아 다음에 다시 시도한다.
- **정리는 영구 삭제 때만.** 편집 중 이미지를 지웠다가 undo하면 참조가 살아 돌아오므로
  그때는 실물을 지우지 않는다. 휴지통을 비울 때 `imageStore.removeForDoc`이 그 문서
  폴더를 통째로 지운다. 그래서 고아 파일이 남을 수 있는 경우는 하나뿐이다 — 두 사람이
  같은 옛 문서를 동시에 열어 각자 올렸을 때(한쪽 참조만 채택된다). 위 사용량 쿼리로
  확인하고 필요하면 수동 정리한다.
