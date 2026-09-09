-- =============================================================================
-- 26 — An SVG logo was accepted and then rendered as a broken image
--
-- The company-logos bucket allowed image/svg+xml and so did the upload form.
-- Everywhere a logo appears — the board, the directory, every listing — it is
-- rendered through next/image, and next/image refuses an SVG source unless
-- `dangerouslyAllowSVG` is set: it answers 400. So the upload succeeded, the
-- URL was stored, and the logo was broken from that moment on, on the one
-- element that was specifically asked for beside every company name.
--
-- Removed rather than allowed. Setting that flag is the other way to make an
-- SVG render, and it is named the way it is for a reason: an SVG is a document
-- that can carry script, and these are uploaded by anybody who registers a
-- company. PNG, JPEG and WebP cover every real logo.
--
-- No company had uploaded one yet, so nothing needs migrating — this closes it
-- before the first one does.
-- =============================================================================

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'company-logos';
