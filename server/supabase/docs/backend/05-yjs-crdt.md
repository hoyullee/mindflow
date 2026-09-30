<!-- backend.md §5 — 색인: ../backend.md -->
## 5. Yjs/CRDT 도입 지점 (2단계, 설계만)

지금 코드를 짜지는 않지만, 다음 경계가 이미 준비되어 있습니다:

- `DocStore.save(id, doc, { prevVersion })`의 낙관적 잠금(LWW)은 "마지막에 저장한 사람이
  이긴다" 방식입니다. 진짜 동시 편집(같은 문서를 여러 사람이 동시에)을 지원하려면 이
  `save()`/`load()` 왕복을 Y.Doc 업데이트 브로드캐스트로 교체해야 합니다.
- `documents.data` JSONB는 그대로 Y.Doc → `DocV1` 스냅샷의 "체크포인트" 저장소로 재사용
  가능합니다(실시간 상태는 Y.Doc/awareness가, 영속 상태는 기존 테이블이 담당).
- 전송 계층 후보: Supabase Realtime(브로드캐스트 채널)로 Y.Doc 업데이트를 릴레이하거나,
  별도 `y-websocket` 서버. 어느 쪽이든 `apps/web/src/adapters/` 안에 `YjsDocStore` 같은
  새 어댑터로 캡슐화하면 `features/editor`는 변경 없이 소스만 교체됩니다(포트 설계의
  목적이 바로 이것입니다).
- `packages/mindmap-core`에는 아직 CRDT 관련 코드가 없습니다(ADR-0001 §2의 `crdt/`
  디렉터리는 스켈레톤 상태) — Y.Doc ↔ `DocV1` 매핑 함수가 필요해지면 그 시점에 코어에
  순수 함수로 추가하고, 실제 Y.Doc 인스턴스/네트워크는 여전히 `apps/web`이 소유합니다
  (코어 순수성 원칙 유지).
