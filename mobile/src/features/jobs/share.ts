import { Platform, Share } from 'react-native';
import { withShareSource } from '@/lib/share-source';
import { env } from '~/lib/env';

/** A listing's link to the share sheet, marked as shared (the website counts where its visits come from). */
export function shareJobLink({ slug, title }: { slug: string; title: string }) {
  const url = withShareSource(`${env.siteUrl}/jobs/${slug}`);
  // `url` is iOS's alone: Android shares the message, so there the link goes inside it.
  Share.share(Platform.OS === 'ios' ? { message: title, url } : { message: `${title}\n${url}` }).catch(() => {});
}
