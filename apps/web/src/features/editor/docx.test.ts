// `.docx` — 우리가 손으로 쓰는 zip이 **정말 유효한 zip인가**가 이 파일의 관심사다.
// (Word가 열어 주는지는 여기서 확인할 수 없지만, 구조가 깨지면 그건 확실히 못 연다.)
import { describe, expect, it } from 'vitest';
import { buildDocxZip, zipEntryNames } from './docx';

describe('docx zip', () => {
  it('항목 이름을 되읽을 수 있다 — 로컬 헤더가 제대로 섰다는 뜻', () => {
    const bytes = buildDocxZip([
      { name: '[Content_Types].xml', text: '<Types/>' },
      { name: 'word/document.xml', text: '<w:document/>' },
    ]);
    expect(zipEntryNames(bytes)).toEqual(['[Content_Types].xml', 'word/document.xml']);
  });

  it('끝 기록(EOCD)이 있고 항목 수가 맞는다', () => {
    const bytes = buildDocxZip([{ name: 'a.xml', text: 'a' }, { name: 'b.xml', text: 'b' }]);
    // EOCD 서명은 마지막 22바이트의 머리에 있다(주석이 없으므로).
    const v = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 22);
    expect(v.getUint32(0, true)).toBe(0x06054b50);
    expect(v.getUint16(8, true)).toBe(2);
    expect(v.getUint16(10, true)).toBe(2);
  });

  it('한글도 그대로 실린다 — XML이 UTF-8이라 별도 처리가 없다', () => {
    const bytes = buildDocxZip([{ name: 'word/document.xml', text: '<w:t>회의록</w:t>' }]);
    expect(new TextDecoder().decode(bytes)).toContain('회의록');
  });
});
