/**
 * Whether what was typed confirms deleting an account, on the website and in
 * the app.
 *
 * The page asks for the word in its own language (account.deleteConfirmWord:
 * «حذف»). Somebody whose keyboard has no Arabic on it — App Review among
 * them — could never type that, and so could never delete their account. The
 * English word is taken wherever another is asked for, in any case, and the
 * spaces a keyboard adds around a word are not counted.
 *
 * The typing is the only check: deleting is a deliberate act, and the server
 * asks for no word.
 */

/** messages/en.json's account.deleteConfirmWord, which every keyboard can type (held to it by a test). */
export const DELETE_WORD_ANY_KEYBOARD = 'delete';

export function confirmsDeletion(typed: string, word: string): boolean {
  const said = typed.trim().toLowerCase();
  return said !== '' && (said === word.trim().toLowerCase() || said === DELETE_WORD_ANY_KEYBOARD);
}
