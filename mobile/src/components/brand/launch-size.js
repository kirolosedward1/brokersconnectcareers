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
