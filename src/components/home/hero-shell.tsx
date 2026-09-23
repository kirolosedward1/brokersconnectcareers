import { HeroVideo } from '@/components/home/hero-video';
import { HomeTabs } from '@/components/home/home-tabs';

/**
 * The hero's staging: film, overlays, and the audience switcher.
 *
 * Both landing pages share it so the two sides of the marketplace feel like
 * one product with two doors, rather than two sites that happen to use the
 * same logo. Only what sits inside changes.
 */
export function HeroShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* The gradient is the hero's actual background. The film, when the
          reader's connection can afford it, sits on top of it — which is why
          this is a full brand treatment and not a grey placeholder. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-[linear-gradient(135deg,#0b1020_0%,#141c3a_45%,#0e2b47_100%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-20 opacity-60 bg-[radial-gradient(60rem_32rem_at_75%_-10%,var(--brand-blue),transparent_70%),radial-gradient(40rem_24rem_at_10%_110%,var(--brand-cyan),transparent_75%)]"
      />

      <div aria-hidden className="absolute inset-0 -z-10">
        <HeroVideo src="/media/hero.mp4" poster="/media/hero-poster.jpg" />
      </div>

      {/* Two overlays doing different jobs: the flat one guarantees a contrast
          floor whatever frame is showing, the vertical one keeps the type
          legible against the brighter middle of the shot and hands off cleanly
          to the section below. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-slate-950/65" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgba(8,12,24,0.85)_0%,rgba(8,12,24,0.45)_40%,rgba(8,12,24,0.92)_100%)]"
      />

      {/* Sized by what is in it. This had a 42rem floor, which on a laptop is
          the whole screen: a visitor's first view of a job board was a film
          and a search box, with no sign below the fold that there were jobs.
          The top padding clears the header, which floats over the film. */}
      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pt-24 pb-10 text-center sm:pt-28 sm:pb-12">
        <div className="mb-6">
          <HomeTabs />
        </div>

        {children}
      </div>
    </section>
  );
}
