import { useSearchParams } from 'react-router-dom';

/**
 * Temporary landing page for `/editor?map=<id>&title=<title>`.
 * MindFlow.dc.html (the mindmap editor) is ported to React in the next milestone.
 */
export function EditorPlaceholder() {
  const [params] = useSearchParams();
  const mapId = params.get('map') || '';
  const title = params.get('title') || '';

  return (
    <main
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontFamily: 'Pretendard, system-ui, sans-serif',
        background: '#fbf6f2',
        color: '#33281f',
      }}
    >
      <h1 style={{ margin: 0 }}>에디터 (곧 이식 예정)</h1>
      <p style={{ color: '#9c8b7e', margin: 0 }}>map: {mapId}</p>
      {title && <p style={{ color: '#9c8b7e', margin: 0 }}>title: {title}</p>}
    </main>
  );
}
