import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import {
  alternatesFor,
  activeLocales,
  dirOf,
  type Locale,
} from "@/i18n/routing";
import { PUBLIC_MESSAGES, pick } from "@/i18n/client-messages";
import { env } from "@/lib/env";
import "../globals.css";
import { Analytics } from "@/components/analytics";

/**
 * One family, both scripts.
 *
 * IBM Plex Sans Arabic is the Arabic companion to IBM Plex Sans and ships the
 * Latin glyphs too, which is why the latin subset is loaded here. A second
 * Latin face used to sit alongside it — Inter, 55 KB across three files —
 * purely so numerals could be set in something other than the body font. On a
 * market this mobile that is an eleventh of the page's weight to draw digits
 * in a typeface almost nobody could pick out of a line-up next to Plex's own.
 *
 * Named --font-plex rather than --font-arabic because it is no longer only the
 * Arabic font, and because the old name collided with the theme token that
 * referenced it.
 */
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

/**
 * The colour a phone paints its own chrome with, above and below the page.
 *
 * Two values, because the site has two themes and one of them would look
 * broken under the other's bar — a brand-blue status bar over a dark page
 * reads as a rendering fault rather than as branding. The dark value is the
 * page's own surface, so the bar disappears into it.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1a3fd4" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

export function generateStaticParams() {
  return activeLocales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    metadataBase: new URL(env.siteUrl),
    title: {
      default: `${t("siteName")} — ${t("tagline")}`,
      template: `%s | ${t("siteName")}`,
    },
    description: t("defaultDescription"),
    alternates: alternatesFor("/", locale),
    openGraph: {
      type: "website",
      siteName: t("siteName"),
      locale: locale === "ar" ? "ar_EG" : "en_US",
      alternateLocale: locale === "ar" ? "en_US" : "ar_EG",
      /**
       * A static card, not a generated one.
       *
       * Links here are shared far more often than they are typed, and in this
       * market that mostly means WhatsApp — which showed a grey box with a URL
       * under it until now.
       *
       * next/og was the obvious way to draw it per page, and it cannot: Satori
       * shapes Arabic letters correctly but reverses the words on any wrapped
       * line and puts trailing punctuation on the wrong side. A listing card
       * with visibly broken Arabic on it is worse than no card. This one is
       * rendered by scripts/og-card.swift through CoreText, which gets bidi
       * right, and committed.
       */
      images: [
        { url: "/brand/og.jpg", width: 1200, height: 630, alt: t("tagline") },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${t("siteName")} — ${t("tagline")}`,
      description: t("defaultDescription"),
      images: ["/brand/og.jpg"],
    },
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(activeLocales, locale)) notFound();

  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "nav" });

  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={plex.variable}
      suppressHydrationWarning
    >
      <head>
        {/*
          Runs before the first paint, for the readers who have chosen dark.
          Without it their document renders light and repaints dark once React
          hydrates — a flash worse than not offering dark mode at all. Inline
          and synchronous on purpose: it must finish before the body is
          painted, so it cannot be a component or a deferred script.

          Light is the default. Dark happens only on an explicit choice, or on
          an explicit choice to follow the OS.

          The key and the logic here mirror applyTheme in theme-toggle.tsx.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('bc-theme');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="flex min-h-dvh flex-col">
        {/* Only what the public site's client components read. The console
            nests its own provider and adds its half. See client-messages.ts. */}
        <NextIntlClientProvider
          messages={pick(await getMessages(), PUBLIC_MESSAGES)}
        >
          {/*
            The first thing a keyboard reaches, and invisible until it does.
            Without it, getting to the content on any page means tabbing past
            the logo, four nav links, a search button, the theme toggle and the
            menu — every time.

            A plain anchor, not a Link: the target is on the page already, and
            routing through the client router would scroll without moving
            focus, which is the half of the job that actually matters.
          */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
          >
            {t("skipToContent")}
          </a>

          {children}
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
