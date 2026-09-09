/**
 * Third-party marks, drawn rather than imported.
 *
 * Lucide dropped brand glyphs, and the generic stand-ins are worse than they
 * look: a speech bubble on a button that says "message them on WhatsApp" reads
 * as in-app chat, which this platform does not have. In this market WhatsApp
 * *is* the contact channel, so the button should carry the thing people
 * recognise.
 *
 * Both are single paths at their official geometry so they stay crisp at any
 * size, and both take their colour from the button they sit in rather than
 * carrying WhatsApp green — a green glyph inside a filled primary button is a
 * clash, and inside a white one it reads as a second accent.
 */

export function WhatsAppMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? 'size-4 shrink-0'}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347Z" />
      <path d="M12.05 0h-.01C5.405 0 .003 5.404.003 12.05a11.99 11.99 0 0 0 1.635 6.052L.057 22.812l4.874-1.558a11.98 11.98 0 0 0 7.12 2.335c6.645 0 12.048-5.404 12.048-12.05C24.098 5.404 18.695 0 12.05 0Zm7.012 17.014c-.29.82-1.444 1.5-2.364 1.699-.629.134-1.45.24-4.216-.906-3.538-1.466-5.816-5.06-5.994-5.294-.17-.233-1.43-1.903-1.43-3.63 0-1.729.878-2.57 1.232-2.932.29-.297.77-.432 1.23-.432.15 0 .283.007.404.013.354.015.532.036.765.594.29.7.997 2.428 1.081 2.606.086.178.171.42.051.653-.112.24-.21.346-.389.55-.178.205-.347.362-.525.581-.163.19-.347.394-.142.748.205.347.912 1.5 1.951 2.427 1.341 1.194 2.428 1.575 2.818 1.738.29.12.636.092.848-.134.269-.29.6-.77.938-1.243.24-.34.543-.382.861-.262.325.113 2.045.964 2.399 1.14.354.178.588.263.673.412.084.152.084.87-.206 1.69Z" />
    </svg>
  );
}
