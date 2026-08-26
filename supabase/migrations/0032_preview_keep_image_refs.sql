-- 0032: 썸네일 본문 RPC가 이미지 **참조**는 그대로 두게 한다.
--
-- 왜: 0012는 `img`가 문자열이기만 하면 무조건 'stripped'로 바꿨다. 그 함수를 쓴
-- 이유는 이미지가 본문 jsonb 안에 **base64 data URL로 인라인**이라 카드마다 수백
-- KB~수 MB가 실려 왔기 때문이다(무료 플랜 egress).
--
-- 그런데 0016부터 이미지 실물은 Storage에 있고 본문에는 `mfimg:<경로>` **참조**만
-- 남는다 — 50바이트짜리 문자열이다. 그걸 지워 봐야 아끼는 전송량은 0인데, 대신
-- 홈 카드·대시보드 위젯 썸네일이 **영영 회색 자리표시자**가 됐다(제보).
--
-- 그래서 판단 기준을 값의 **모양**으로 바꾼다: `data:`로 시작하는 인라인 데이터만
-- 떼고(옛 문서 — 여기서 아끼는 양이 크다) 참조는 그대로 보낸다. 크기 필드
-- (`imgW`/`imgH`, 플로트의 `w`/`h`)는 예전처럼 손대지 않으므로 박스 계산도 그대로다.
--
-- 클라이언트는 받은 참조를 서명 URL로 바꿔 그린다(apps/web `previewImageUrls`).
-- 실물 다운로드는 **화면에 실제로 그려지는 카드**에서만 일어나고, 서명 URL은 기기에
-- 캐시해 재방문에 같은 문자열을 쓴다(브라우저 캐시 적중 — `imageUrlCache.ts`).
--
-- 보안·동시성은 0012 그대로(security invoker → documents RLS, 읽기 전용).

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
              -- 인라인 데이터만 뗀다. 참조(`mfimg:…`)는 그대로 — 그래야 썸네일이
              -- 이미지를 그릴 수 있고, 지워 봐야 아끼는 전송량도 없다.
              when jsonb_typeof(e.v -> 'img') = 'string' and (e.v ->> 'img') like 'data:%'
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
            when jsonb_typeof(f.v -> 'img') = 'string' and (f.v ->> 'img') like 'data:%'
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

revoke execute on function public.preview_doc(text) from public, anon;
grant execute on function public.preview_doc(text) to authenticated;
