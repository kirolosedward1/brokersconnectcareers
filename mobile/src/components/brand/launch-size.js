/**
 * How big the opening logo is, in points.
 *
 * The phone's splash (app.config.ts, expo-splash-screen imageWidth) and the
 * in-app curtain draw the mark at this same width, so one gives way to the
 * other without the mark jumping. The mark is 44 points (it was 76). The
 * wordmark under it is 14 points tall (it was 20, then 12).
 *
 * This is JavaScript because Expo loads app.config as JS and does not compile
 * the modules it imports.
 */
exports.LAUNCH_MARK_WIDTH = 44;
exports.LAUNCH_WORDMARK_HEIGHT = 14;
