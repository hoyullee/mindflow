import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Shared shell for the public legal documents (`/privacy`, `/terms`). These
 * routes are intentionally OUTSIDE `RequireAuth`: Google's brand verification
 * reviewers (and any user pre-signup) must be able to open them logged-out.
 * Styling follows the design system's document conventions — warm paper
 * background, ink text, coral brand accents (docs/design/design-system.md).
 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#fbf6f2',
        color: '#33281f',
        fontFamily: 'Pretendard, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px 72px' }}>
        <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#33281f' }}>
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: '#f0663f',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            G
          </span>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-.01em' }}>Geurio</span>
        </Link>

        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', margin: '36px 0 6px' }}>{title}</h1>
        <div style={{ fontSize: 13, color: '#9c8b7e', marginBottom: 34 }}>시행일: {updated}</div>

        <div style={{ fontSize: 14.5, lineHeight: 1.75 }}>{children}</div>

        <div style={{ marginTop: 56, paddingTop: 20, borderTop: '1px solid #ecdfd5', fontSize: 13, color: '#9c8b7e', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Link to="/privacy" style={{ color: '#9c8b7e' }}>
            개인정보처리방침
          </Link>
          <Link to="/terms" style={{ color: '#9c8b7e' }}>
            이용약관
          </Link>
          <span style={{ marginLeft: 'auto' }}>© 2026 Geurio</span>
        </div>
      </div>
    </div>
  );
}

const h2Style: CSSProperties = { fontSize: 18, fontWeight: 800, letterSpacing: '-.01em', margin: '34px 0 10px' };

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={h2Style}>{heading}</h2>
      {children}
    </section>
  );
}

export const legalListStyle: CSSProperties = { margin: '8px 0', paddingLeft: 22, display: 'grid', gap: 6 };
