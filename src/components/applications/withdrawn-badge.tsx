import { WITHDRAWN_BADGE } from '@/lib/application-stages';

/** The broker (and candidate) withdrawn badge: 12px, weight 500, #5B6475 on #F2F4F7. */
export function WithdrawnBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap px-1.5 py-0.5 leading-4"
      style={{
        fontSize: WITHDRAWN_BADGE.fontSize,
        fontWeight: WITHDRAWN_BADGE.fontWeight,
        color: WITHDRAWN_BADGE.color,
        backgroundColor: WITHDRAWN_BADGE.background,
        borderRadius: WITHDRAWN_BADGE.radius,
      }}
    >
      {label}
    </span>
  );
}
