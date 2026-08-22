import type { EditorController } from '../useEditorState';
import { MenuItemWrap } from '../../../components/Menu';

interface ExportMenuProps {
  controller: EditorController;
  onDone: () => void;
}

/** Export dropdown — port of the `.mf-export` popover body (MindFlow.dc.html:125-133): PNG / JSON. */
export function ExportMenu({ controller, onDone }: ExportMenuProps) {
  const th = controller.uiTheme;
  const itemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '9px 13px',
    fontSize: 13,
    cursor: 'pointer',
    color: th.text,
    borderRadius: 8,
    width: '100%',
    border: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    textAlign: 'left',
  } as const;

  // 면·그늘·위치는 `Menu`(Radix Content)가 그린다 — 여기서 또 그리면 패널이 겹쳐
  // 그늘이 두 번 깔린다. 각 행은 `MenuItemWrap`으로 감싸 키보드 이동을 얻는다.
  return (
    <div className="mf-ed-exportmenu" style={{ display: 'contents' }}>
      {/* 칸반에는 그릴 캔버스가 없다(좌표가 없는 열·카드 문서) — 그림 형식 셋은
          빈 파일이 되므로 아예 내주지 않는다. 남는 JSON·Markdown이 칸반의
          내보내기다("할 수 없는 것은 보이지 않는다"). */}
      {!controller.isKanban && (
      <>
      <MenuItemWrap>
        <button
          type="button"
          className="mf-ed-btn"
          style={itemStyle}
          onClick={() => {
            controller.exportPNG();
            onDone();
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x={3} y={3} width={18} height={18} rx={2} />
            <circle cx={8.5} cy={8.5} r={1.5} />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          PNG 이미지
        </button>
      </MenuItemWrap>
      <MenuItemWrap>
        <button
          type="button"
          className="mf-ed-btn"
          style={itemStyle}
          onClick={() => {
            controller.exportSVG();
            onDone();
          }}
        >
          {/* 벡터 펜촉+노드 아이콘 — 확대해도 깨지지 않는 형식임을 보여 준다 */}
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 7c4 8 10 8 14 0" />
            <rect x={3} y={5} width={4} height={4} rx={1} />
            <rect x={17} y={5} width={4} height={4} rx={1} />
            <rect x={10} y={13} width={4} height={4} rx={1} />
          </svg>
          SVG 이미지 (.svg)
        </button>
      </MenuItemWrap>
      <MenuItemWrap>
        <button
          type="button"
          className="mf-ed-btn"
          style={itemStyle}
          onClick={() => {
            controller.exportPDF();
            onDone();
          }}
        >
          {/* 인쇄물(문서+접힌 귀) 아이콘 */}
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1={8} y1={13} x2={16} y2={13} />
            <line x1={8} y1={17} x2={13} y2={17} />
          </svg>
          PDF 문서 (.pdf)
        </button>
      </MenuItemWrap>
      </>
      )}
      <MenuItemWrap>
        <button
          type="button"
          className="mf-ed-btn"
          style={itemStyle}
          onClick={() => {
            controller.exportJSON();
            onDone();
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          JSON 파일 (.json)
        </button>
      </MenuItemWrap>
      <MenuItemWrap>
        <button
          type="button"
          className="mf-ed-btn"
          style={itemStyle}
          onClick={() => {
            controller.exportMarkdown();
            onDone();
          }}
        >
          {/* 개요(불릿) 아이콘 — 목록 형태임을 보여 준다 */}
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1={9} y1={6} x2={20} y2={6} />
            <line x1={11} y1={12} x2={20} y2={12} />
            <line x1={13} y1={18} x2={20} y2={18} />
            <circle cx={5} cy={6} r={1.4} fill="currentColor" stroke="none" />
            <circle cx={7} cy={12} r={1.4} fill="currentColor" stroke="none" />
            <circle cx={9} cy={18} r={1.4} fill="currentColor" stroke="none" />
          </svg>
          Markdown 개요 (.md)
        </button>
      </MenuItemWrap>
    </div>
  );
}
