# MindFlow

MindFlow는 중심 주제에서 가지를 뻗어 생각을 정리하는 마인드맵 웹 앱입니다. 이 저장소는
Claude Design 프로젝트(`MindFlow.dc.html`)를 그대로 가져와 실행 가능한 정적 웹 앱으로
구성한 것입니다.

## 화면 구성

| 파일 | 설명 |
| --- | --- |
| `index.html` | 진입점. `Login.dc.html`으로 리다이렉트합니다. |
| `Login.dc.html` | 로그인 · 회원가입 · 이메일 인증 · 비밀번호 찾기 (데모 인증 코드 제공). |
| `Home.dc.html` | 대시보드. 최근 · 즐겨찾기 맵 목록, 새 맵 만들기, 템플릿, 검색, 로그아웃. |
| `MindFlow.dc.html` | 마인드맵 편집기 — 노드/메모/연결선/영역, 레이아웃·연결선·테마 스타일, 아웃라인 보기, 미니맵, PNG·Markdown·JSON 내보내기, 실행 취소/다시 실행, 자동 저장. |
| `support.js` | `dc-runtime` — `<x-dc>` 템플릿과 컨트롤러(`class Component extends DCLogic`)를 해석해 React로 렌더링하는 런타임입니다. |

세 화면은 `localStorage`에 문서를 저장하고 `window.location`으로 서로를 오갑니다
(로그인 → 홈 → 편집기 → 홈). 로그인/인증은 데모용이며 실제 서버를 호출하지 않습니다.

## 실행 방법

`support.js`가 페이지 자신과 형제 문서를 `fetch`하고 React(UMD)를 CDN에서 불러오므로
`file://`이 아니라 정적 HTTP 서버로 열어야 합니다.

```bash
# 아무 정적 서버나 사용할 수 있습니다
python3 -m http.server 8000
# 또는
npx serve .
```

브라우저에서 `http://localhost:8000/` 를 열면 로그인 화면으로 이동합니다.
(인터넷 연결이 필요합니다 — React와 Pretendard 웹폰트를 CDN에서 로드합니다.)

## 구조 메모 (dc 포맷)

각 `*.dc.html` 파일은 두 부분으로 구성됩니다.

- `<x-dc>…</x-dc>` — `{{ 바인딩 }}`, `<sc-if>`, `<sc-for>`, `ref`, `onClick` 등을 쓰는 선언적
  템플릿.
- `<script type="text/x-dc" data-dc-script>` — `renderVals()`가 템플릿 바인딩 값을 돌려주는
  컨트롤러 클래스.

`support.js`가 `DOMContentLoaded` 시 템플릿을 파싱하고 컨트롤러를 인스턴스화해
`#dc-root`에 렌더링합니다. 빌드 단계는 필요 없습니다.
