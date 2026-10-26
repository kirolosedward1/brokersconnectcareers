/**
 * How big the opening logo is, in points.
 *
 * The phone's splash (app.config.ts, expo-splash-screen imageWidth) and the
 * in-app curtain draw the mark at this same width, so one gives way to the
 * other without the mark jumping. The mark is 44 points (it was 76). The
 * wordmark under it is 14 points tall (it was 20, then 12).
 *
 * The welcome lockup uses that same share of its previous size (44 of 76).
 * It was a 52-point tile (44 when short) and a wordmark 26 tall (22 when
 * short); the mark inside the tile stays 0.68 of the tile.
 *
 * This is JavaScript because Expo loads app.config as JS and does not compile
 * the modules it imports.
 */
exports.LAUNCH_MARK_WIDTH = 44;
exports.LAUNCH_WORDMARK_HEIGHT = 14;

/** The opening mark before it was brought down (76). The welcome lockup uses this share. */
const LAUNCH_MARK_BEFORE = 76;

/** The same share of a previous size as the launch mark (44 of 76). */
function share(before) {
  return Math.round((before * exports.LAUNCH_MARK_WIDTH) / LAUNCH_MARK_BEFORE);
}

/**
 * The welcome lockup, scaled with the launch logo. It was a 52-point tile
 * (44 when short) and a wordmark 26 tall (22 when short).
 */
exports.welcomeTile = (compact) => share(compact ? 44 : 52);
exports.welcomeWordmarkHeight = (compact) => share(compact ? 22 : 26);
