-- 0012: 홈 썸네일 전용 본문 RPC — 이미지 데이터를 뗀 문서를 돌려준다.
--
-- 왜: 이미지 첨부(캔버스 플로트 `floats[].img` / 노드 `nodes.*.img`)는 본문
-- jsonb 안에 base64 data URL로 인라인이다. 홈 썸네일이 문서 **전문**을
-- 내려받으면 카드마다 수백 KB~수 MB가 실려 와 무료 플랜의 송신량(egress,
-- 5GB/월)을 잠식한다. 이 함수는 그 이미지 "데이터"만 자리표시 문자열
-- ('stripped')로 바꾼다 — 크기 필드(`imgW`/`imgH`, 플로트의 `w`/`h`)는
-- 그대로라 클라이언트 미리보기의 박스/레이아웃 계산은 변하지 않고, 이미지
-- 자리는 회색 자리표시자로 그린다(apps/web mapPreview 참고).
--
-- 보안: security **invoker**(기본값) — documents의 RLS SELECT 정책(내 문서
-- 또는 나에게 공유된 문서, 0009)이 그대로 적용된다. 행이 안 보이면 결과가
-- 없고 클라이언트는 null을 받는다.
--
-- 동시 편집: 이 함수는 읽기 전용(stable)이며 어떤 판을 읽는지는 클라이언트가
-- list()로 받은 version/updated_at으로 판단한다(낙관적 잠금 카운터 — 자세한
-- 검토는 apps/web/src/adapters/previewBodyCache.ts 머리주석).

create or replace function public.preview_doc(doc_id text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_set(
    jsonb_set(
      d.data,
      '{nodes}',
      coalesce(
        (
          select jsonb_object_agg(
            e.k,
            case
              when jsonb_typeof(e.v -> 'img') = 'string'
                then jsonb_set(e.v, '{img}', to_jsonb('stripped'::text))
              else e.v
            end
          )
          from jsonb_each(
            case when jsonb_typeof(d.data -> 'nodes') = 'object' then d.data -> 'nodes' else '{}'::jsonb end
          ) as e(k, v)
        ),
        '{}'::jsonb
      )
    ),
    '{floats}',
    coalesce(
      (
        select jsonb_agg(
          case
            when jsonb_typeof(f.v -> 'img') = 'string'
              then jsonb_set(f.v, '{img}', to_jsonb('stripped'::text))
            else f.v
          end
        )
        from jsonb_array_elements(
          case when jsonb_typeof(d.data -> 'floats') = 'array' then d.data -> 'floats' else '[]'::jsonb end
        ) as f(v)
      ),
      '[]'::jsonb
    )
  )
  from public.documents d
  where d.id = doc_id;
$$;

-- 로그인 사용자만 — 홈은 인증 뒤에만 접근한다.
revoke execute on function public.preview_doc(text) from public, anon;
grant execute on function public.preview_doc(text) to authenticated;
