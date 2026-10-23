/**
 * How big the opening logo is, in points.
 *
 * The phone's splash (app.config.ts, expo-splash-screen imageWidth) and the
 * in-app curtain draw the mark at this same width, so one gives way to the
 * other without the mark jumping. The curtain's wordmark is the same share
 * of its previous size, so the name under the mark stays in proportion.
 * Both are a little under three fifths of what they were (the mark was 76,
 * the wordmark 20 tall).
 *
 * This is JavaScript because Expo loads app.config as JS and does not compile
 * the modules it imports.
 */
exports.LAUNCH_MARK_WIDTH = 44;
exports.LAUNCH_WORDMARK_HEIGHT = 12;

/** The opening mark before it was brought down (76). Other lockups use this share. */
const LAUNCH_MARK_BEFORE = 76;

/** The same share of a previous size as the launch mark (44 of 76). */
function share(before) {
  return Math.round((before * exports.LAUNCH_MARK_WIDTH) / LAUNCH_MARK_BEFORE);
}

/**
 * The welcome lockup, scaled with the launch logo. It was a 52-point tile
 * (44 when short) and a wordmark 26 tall (22 when short); the mark inside
 * the tile stays 0.68 of the tile.
 */
exports.welcomeTile = (compact) => share(compact ? 44 : 52);
exports.welcomeWordmarkHeight = (compact) => share(compact ? 22 : 26);
