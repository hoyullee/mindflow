// PDF 조립기 — 순수 함수라 바이트 구조를 직접 검증한다. PDF는 오프셋이 1바이트만
// 어긋나도 뷰어가 파일을 통째로 거부하므로, xref의 각 항목이 실제 그 바이트에서
// `N 0 obj`로 시작하는지까지 본다.
import { describe, expect, it } from 'vitest';
import { buildPdfFromJpeg } from './pdf';

// 오프셋 검증은 바이트↔문자 1:1이어야 한다 — latin1은 각 바이트를 한 글자로 매핑.
function asLatin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

describe('buildPdfFromJpeg', () => {
  const pdf = buildPdfFromJpeg(JPEG, 200, 100, 150, 75);
  const s = asLatin1(pdf);

  it('헤더·트레일러·이미지 사전이 온전하다', () => {
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s.endsWith('%%EOF\n')).toBe(true);
    expect(s).toContain('/Filter /DCTDecode');
    expect(s).toContain('/Width 200');
    expect(s).toContain('/Height 100');
    expect(s).toContain('/MediaBox [0 0 150 75]');
    expect(s).toContain(`/Length ${JPEG.length} >>`);
  });

  it('JPEG 바이트가 스트림에 그대로 들어간다', () => {
    const at = s.indexOf('/DCTDecode');
    const streamAt = s.indexOf('stream\n', at) + 'stream\n'.length;
    expect(Array.from(pdf.slice(streamAt, streamAt + JPEG.length))).toEqual(Array.from(JPEG));
  });

  it('startxref가 실제 xref 위치를 가리킨다', () => {
    const m = /startxref\n(\d+)\n%%EOF\n$/.exec(s)!;
    expect(m).toBeTruthy();
    const at = Number(m[1]);
    expect(s.slice(at, at + 5)).toBe('xref\n');
  });

  it('xref의 각 오브젝트 오프셋이 바이트 정확하다', () => {
    const xrefAt = s.indexOf('xref\n0 6\n');
    const entries = s
      .slice(xrefAt)
      .split('\n')
      .filter((ln) => / n $/.test(ln + '\n') || /^\d{10} 00000 n $/.test(ln));
    expect(entries.length).toBe(5);
    entries.forEach((ln, i) => {
      const off = Number(ln.slice(0, 10));
      expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('콘텐츠 스트림이 이미지를 페이지 크기로 놓는다', () => {
    expect(s).toContain('150 0 0 75 0 0 cm\n/Im0 Do');
  });
});
