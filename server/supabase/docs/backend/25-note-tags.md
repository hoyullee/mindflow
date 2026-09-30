<!-- backend.md §25 — 색인: ../backend.md -->
## 25. 공책 태그 판 (0042 `note_tags`) — 계정에 딸린 한 벌

공책 페이지에 붙는 태그의 **이름과 색**을 담는 표입니다. 처음에는 공책 한 권의
속성이었다가(`doc.cover.tags`) "태그는 한판으로 관리됐으면 좋겠어"라는 요청으로
문서 밖의 판이 됐고, 그 판이 **이 기기 `localStorage`**에만 살던 것을 이 절에서
계정으로 옮깁니다. 텍스트 몇 줄짜리 행이라 저장량·egress 모두 사실상 0입니다.

- **스키마**: `note_tags(owner uuid pk default auth.uid() → auth.users on delete
  cascade, data jsonb, updated_at)`. `data`는 판 전체 —
  `{ made: string[], colors: Record<string,string>, hidden: string[] }`.
  사용자당 **한 행**이고 `workspaces`와 같은 모양입니다(판은 늘 통째로 읽고
  통째로 쓰므로 태그마다 한 행일 이유가 없습니다).
- **RLS**: SELECT/INSERT/UPDATE 모두 `auth.uid() = owner`. DELETE 정책은 두지
  않습니다(판을 비우는 일은 빈 판을 쓰는 것으로 족하고, 계정을 지우면 위 FK가
  cascade로 함께 지웁니다 — `delete_account()`가 그 길입니다).
- **`hidden`이 하는 일**: 기본 여섯(`NOTE_TAGS`)은 코드 상수라 목록에서 뺄 수
  없어 **가려서** 지웁니다. 만든 태그도 지우면 여기에 이름을 남깁니다 — 묘비가
  없으면 아직 그 태그를 들고 있는 **다른 기기의 판과 합칠 때 되살아납니다**.
- **클라이언트**: `TagStore` 포트(`adapters/ports.ts`). 화면은 이 포트를 직접
  부르지 않습니다 — `features/editor/noteTags.ts`가 `localStorage`를 기기 캐시로
  두고 **동기로** 답하고(블록을 그릴 때마다 색을 묻는 자리가 있어 비동기일 수
  없습니다), 로그인 화면이 뜰 때 `NoteTagsHost`가 `attachNoteTagStore`로 이어
  붙이면 뒤에서 서버 판과 합칩니다. 고칠 때는 캐시를 먼저 쓰고 서버로 던집니다
  (기다리지 않습니다).
- **합치기 규칙**: 서버 판이 먼저, 기기에만 있는 것을 얹고, 양쪽 `hidden`을 합쳐
  마지막에 한 번 더 걸러 냅니다. 기기 캐시에 **다른 계정 id**가 찍혀 있으면
  (공용 PC) 섞지 않고 서버 판을 그대로 씁니다.
- **배포**: GitHub 연동 자동 마이그레이션. 테이블이 아직 없는 서버에서도
  어댑터가 던지지 않고 `null`(= 서버에 판이 없다)로 돌아서므로, 앱이 먼저
  나가도 그동안은 기기 판으로 그대로 돕니다.
- **확인**: 한 기기에서 태그를 만들고 다른 기기(또는 시크릿 창)로 로그인해 고르개
  목록에 그 태그가 있으면 됩니다. SQL로는
  `select owner, data from note_tags;`.
- **지금 하지 않는 것**: 실시간 반영. 다른 기기에서 만든 태그는 **다음에 앱을
  열 때** 보입니다(판을 붙일 때 한 번 맞춥니다) — 테마·첫 화면 같은 다른 계정
  설정과 같은 태도입니다.
