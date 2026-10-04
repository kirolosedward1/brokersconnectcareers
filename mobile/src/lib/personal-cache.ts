import { Directory, File, Paths } from 'expo-file-system';

/**
 * Where the pickers and the image re-encoder leave their copies in the app's
 * cache — a CV picked to apply with, a commercial register photographed, a
 * logo shrunk before upload — and the data export's file. Nothing the app
 * shows, but a person's files on a phone the next person signs in on.
 */
const FOLDERS = ['DocumentPicker', 'ImagePicker', 'ImageManipulator'];
const EXPORT = /^brokers-connect-data-.*\.json$/;

/** What the person leaving left in the cache goes with them. Never throws: a sign-out is not held up by a file. */
export function clearPersonalCache(): void {
  try {
    for (const name of FOLDERS) {
      const folder = new Directory(Paths.cache, name);
      if (folder.exists) folder.delete();
    }
    for (const item of new Directory(Paths.cache).list()) {
      if (item instanceof File && EXPORT.test(item.name)) item.delete();
    }
  } catch {
    // A folder already gone, or a file in use: the cache is the system's to empty in the end.
  }
}
