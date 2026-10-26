import type { Locale } from '@/lib/locale';
import { HELP_SECTIONS } from './content';
import type { LocalizedFeature, LocalizedSection } from './search';
import type { HelpFeature, LocaleText } from './types';

function pick(text: LocaleText, locale: Locale): string {
  return text[locale];
}

function localizeFeature(feature: HelpFeature, locale: Locale): LocalizedFeature {
  return {
    id: feature.id,
    title: pick(feature.title, locale),
    summary: pick(feature.summary, locale),
    href: feature.href,
    steps: (feature.steps ?? []).map((step) => pick(step, locale)),
    fields: (feature.fields ?? []).map((field) => ({
      label: pick(field.label, locale),
      detail: pick(field.detail, locale),
    })),
    statuses: (feature.statuses ?? []).map((status) => ({
      label: pick(status.label, locale),
      detail: status.detail ? pick(status.detail, locale) : undefined,
      tone: status.tone,
    })),
    tips: (feature.tips ?? []).map((tip) => pick(tip, locale)),
  };
}

export function localizeHelp(locale: Locale): LocalizedSection[] {
  return HELP_SECTIONS.map((section) => ({
    id: section.id,
    title: pick(section.title, locale),
    lede: pick(section.lede, locale),
    features: section.features.map((feature) => localizeFeature(feature, locale)),
  }));
}

export const HELP_SUPPORT_EMAIL = 'info@topsuite.net';
