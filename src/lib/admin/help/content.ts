import { SECTIONS_A } from './sections-a';
import { SECTIONS_B } from './sections-b';
import { SECTIONS_C } from './sections-c';
import type { HelpSection } from './types';

/**
 * The guide, in the order of the admin menu.
 *
 * To change a sentence, edit the section file. Keep the Arabic label inside
 * «» identical to messages/ar.json, and the anchor `id` stable: it is the
 * deep link /admin/help#<id>.
 */
export const HELP_SECTIONS: HelpSection[] = [...SECTIONS_A, ...SECTIONS_B, ...SECTIONS_C];
