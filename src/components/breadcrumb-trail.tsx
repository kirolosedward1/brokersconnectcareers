import { Link } from '@/i18n/navigation';

/** A visible trail. The matching BreadcrumbList is emitted beside it. */
export function BreadcrumbTrail({
  label,
  items,
}: {
  label: string;
  items: { name: string; href?: string }[];
}) {
  return (
    <nav aria-label={label} className="mb-4 text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden>·</span> : null}
            {item.href ? (
              <Link href={item.href} className="underline-offset-4 hover:text-foreground hover:underline">
                {item.name}
              </Link>
            ) : (
              <span className="text-foreground">{item.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
