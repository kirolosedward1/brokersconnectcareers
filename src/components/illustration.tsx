import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The product's illustrations: one family, used sparingly.
 *
 * All of them are the same hand — black line, one blue, white paper — and the
 * blue is close enough to the brand's that they read as drawn for it. The
 * folder they came from held a second family in orange, purple and pink; none
 * of those are here, because two illustration styles on one site is the
 * quickest way to look assembled rather than designed.
 *
 * Where they go is a rule, not a taste: a picture appears where there would
 * otherwise be nothing to look at — an empty list, a search with no results —
 * or where a step needs a person in it. Never beside real data, and never
 * large: an empty state is a sentence and a way onward, and the picture is
 * there to soften it, not to fill the screen.
 *
 * Decorative by definition. The words next to each one carry the meaning, so
 * the alt text is empty and the image is hidden from assistive technology
 * rather than announced as "illustration of a man with a magnifying glass".
 */
const SOURCES = {
  /** A candidate pressing "apply" on a tall screen, briefcase in hand. */
  apply: { src: '/illustrations/apply.png', width: 960, height: 960 },
  /** Arranging cards on a screen — browsing and narrowing listings. */
  browse: { src: '/illustrations/browse.png', width: 960, height: 639 },
  /** Replies and a bell on a clipboard — an application moving. */
  updates: { src: '/illustrations/updates.png', width: 960, height: 960 },
  /** Looking hard and not finding — no results, no such page. */
  search: { src: '/illustrations/search.png', width: 960, height: 960 },
  /** Weighing three profile cards — a shortlist, saved items. */
  choose: { src: '/illustrations/choose.png', width: 960, height: 960 },
  /** A magnifier over a stamped document — verification. */
  verify: { src: '/illustrations/verify.png', width: 960, height: 702 },
  /** Writing a document at a laptop — posting a listing, setting up. */
  write: { src: '/illustrations/write.png', width: 960, height: 702 },
  /** Reading through applicants' cards — the inbox. */
  review: { src: '/illustrations/review.png', width: 960, height: 702 },
  /** Sorting people into a structure — listings and who is on them. */
  organise: { src: '/illustrations/organise.png', width: 960, height: 703 },
  /** Writing at a laptop with a phone of posts behind — the blog. */
  blog: { src: '/illustrations/blog.png', width: 960, height: 702 },
} as const;

export type IllustrationName = keyof typeof SOURCES;

export function Illustration({
  name,
  className,
  sizes = '(min-width: 1024px) 22rem, 60vw',
  priority = false,
}: {
  name: IllustrationName;
  /** Sets the box; the image keeps its own proportions inside it. */
  className?: string;
  /** What the layout actually gives it, so a 160px picture is not a 960px download. */
  sizes?: string;
  priority?: boolean;
}) {
  const { src, width, height } = SOURCES[name];

  return (
    <Image
      src={src}
      width={width}
      height={height}
      alt=""
      aria-hidden
      sizes={sizes}
      priority={priority}
      className={cn(
        'h-auto w-full select-none',
        /*
          Dark mode without a second set of files.

          The drawings are black line on transparent, so on a dark page the
          lines vanish and the white paper glares. Inverting flips the
          lightness — black line to white, white paper to near-black — and the
          half-turn of hue puts the blue back where it started instead of
          leaving it orange. What comes out is the same drawing as it would
          have been drawn for a dark ground.
        */
        'dark:hue-rotate-180 dark:invert',
        className,
      )}
    />
  );
}

/**
 * The small one, for an empty state: fixed at 9rem, centred, and gone on very
 * short screens where it would push the message and its button out of view.
 */
export function EmptyIllustration({ name }: { name: IllustrationName }) {
  return (
    <Illustration
      name={name}
      sizes="9rem"
      className="mx-auto mb-3 w-36 [@media(max-height:34rem)]:hidden"
    />
  );
}
