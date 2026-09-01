'use client';

/**
 * The last resort: an error thrown by the locale layout itself, before the
 * header, the translations or the stylesheet exist. This replaces the root
 * layout wholesale, so it has to bring its own <html> and <body>, and it
 * cannot reach for a translation hook or a Tailwind class — nothing that
 * would normally provide them has run.
 *
 * Hence the hardcoded Arabic and the inline styles. Arabic is the only
 * published locale, so the copy is not a guess; the day English ships, this
 * file becomes the one place that needs a language decision made without a
 * request context.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          background: '#fff',
          color: '#0a0a0a',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>في حاجة غلط</h1>
          <p style={{ marginTop: '0.5rem', color: '#6b7280' }}>
            مقدرناش نحمّل الصفحة. جرّب تاني بعد شوية.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1.25rem',
              borderRadius: '0.5rem',
              border: 0,
              background: '#0a0a0a',
              color: '#fff',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            جرّب تاني
          </button>

          {error.digest ? (
            <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: '#6b7280' }}>
              كود العطل <span style={{ fontFamily: 'monospace' }}>{error.digest}</span>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
