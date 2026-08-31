/**
 * Payloads are built from our own database rows, never from user-typed HTML.
 * JSON.stringify escapes the values, and `<` is escaped again so a stray
 * `</script>` inside a text column cannot close the tag early.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
