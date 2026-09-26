-- 0043: 공책 **본문**의 멘션에도 알림을 보낸다.
--
-- 0026의 `doc_mention_sites`는 `nodes`(주제)와 `floats`(메모) 둘만 훑는다 — 맵과
-- 화이트보드의 구조다. 공책은 본문이 `pages[].blocks[]`에 있어 그 함수가 **한 글자도
-- 보지 못했고**, 그래서 공책에서 사람을 불러도 알림이 가지 않았다(스펙 4-9가
-- "실서비스 필수"라고 적은 자리다).
--
-- ## 자리(site)를 무엇으로 두나
--
-- `<페이지id>:<블록id>`다. 0026이 정한 규칙 — "새 객체에 단 멘션은 새 쌍이라 알림이
-- 가고, 같은 객체 안 재멘션은 울리지 않는다" — 을 공책의 낱개 단위에 그대로 옮긴
-- 것이다. 목록 항목·표의 칸까지 쪼개지 않은 이유도 같다: 한 블록은 사람이 "한
-- 덩어리"로 읽는 단위라, 같은 목록 안에서 같은 사람을 두 번 부르는 것은 0026이 이미
-- "같은 객체 안 재멘션"으로 보고 넘기기로 한 경우와 같다.
--
-- ## 훑을 자리 셋
--
-- 코어가 본문을 평문으로 펼 때 보는 자리와 **같다**(`blockText`의 세 갈래):
--   · `runs`        — 문단·제목·인용·콜아웃·토글 머리·코드
--   · `items[].runs` — 글머리·번호·체크리스트
--   · `rows[][]`     — 표의 칸(런의 배열의 배열)
-- 그 셋이 전부라는 것은 `noteBlockShape`가 못박고 있다(나머지 종류는 글이 없다).
-- 종류가 늘어 새 자리가 생기면 **여기도 함께 늘어야 한다** — 빠뜨리면 그 자리의
-- 멘션만 조용히 알림이 가지 않는다.
--
-- 맵·보드 갈래는 건드리지 않았다(`union`으로 덧붙이기만 한다). `rich`가 평문이면
-- JSON null이라 `jsonb_typeof` 가드가 필수인 것도 0023부터 이어지는 규칙이다.

create or replace function public.doc_mention_sites(doc jsonb)
returns table(em text, site text)
language sql
immutable
as $$
  -- 노드: nodes는 id를 키로 갖는 객체 — 키가 곧 객체 id.
  select distinct lower(r->>'m'), n.id
  from jsonb_each(case when jsonb_typeof(doc->'nodes') = 'object' then doc->'nodes' else '{}'::jsonb end) as n(id, node),
       jsonb_array_elements(case when jsonb_typeof(node->'rich') = 'array' then node->'rich' else '[]'::jsonb end) as r
  where r ? 'm' and coalesce(r->>'m', '') <> ''
  union
  select distinct lower(r->>'m'), coalesce(f->>'id', '')
  from jsonb_array_elements(case when jsonb_typeof(doc->'floats') = 'array' then doc->'floats' else '[]'::jsonb end) as f,
       jsonb_array_elements(case when jsonb_typeof(f->'rich') = 'array' then f->'rich' else '[]'::jsonb end) as r
  where r ? 'm' and coalesce(r->>'m', '') <> ''
  union
  -- 공책 ①: 블록 자신의 런(문단·제목·인용·콜아웃·토글 머리·코드).
  select distinct lower(r->>'m'), coalesce(p->>'id', '') || ':' || coalesce(b->>'id', '')
  from jsonb_array_elements(case when jsonb_typeof(doc->'pages') = 'array' then doc->'pages' else '[]'::jsonb end) as p,
       jsonb_array_elements(case when jsonb_typeof(p->'blocks') = 'array' then p->'blocks' else '[]'::jsonb end) as b,
       jsonb_array_elements(case when jsonb_typeof(b->'runs') = 'array' then b->'runs' else '[]'::jsonb end) as r
  where r ? 'm' and coalesce(r->>'m', '') <> ''
  union
  -- 공책 ②: 목록 항목의 런(글머리·번호·체크리스트).
  select distinct lower(r->>'m'), coalesce(p->>'id', '') || ':' || coalesce(b->>'id', '')
  from jsonb_array_elements(case when jsonb_typeof(doc->'pages') = 'array' then doc->'pages' else '[]'::jsonb end) as p,
       jsonb_array_elements(case when jsonb_typeof(p->'blocks') = 'array' then p->'blocks' else '[]'::jsonb end) as b,
       jsonb_array_elements(case when jsonb_typeof(b->'items') = 'array' then b->'items' else '[]'::jsonb end) as it,
       jsonb_array_elements(case when jsonb_typeof(it->'runs') = 'array' then it->'runs' else '[]'::jsonb end) as r
  where r ? 'm' and coalesce(r->>'m', '') <> ''
  union
  -- 공책 ③: 표의 칸 — `rows`는 **런의 배열의 배열**이라 한 겹 더 편다.
  select distinct lower(r->>'m'), coalesce(p->>'id', '') || ':' || coalesce(b->>'id', '')
  from jsonb_array_elements(case when jsonb_typeof(doc->'pages') = 'array' then doc->'pages' else '[]'::jsonb end) as p,
       jsonb_array_elements(case when jsonb_typeof(p->'blocks') = 'array' then p->'blocks' else '[]'::jsonb end) as b,
       jsonb_array_elements(case when jsonb_typeof(b->'rows') = 'array' then b->'rows' else '[]'::jsonb end) as tr,
       jsonb_array_elements(case when jsonb_typeof(tr) = 'array' then tr else '[]'::jsonb end) as tc,
       jsonb_array_elements(case when jsonb_typeof(tc) = 'array' then tc else '[]'::jsonb end) as r
  where r ? 'm' and coalesce(r->>'m', '') <> ''
$$;
