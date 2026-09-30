# Documentation fonts

These are the Bloxwap brand faces used by `monorepo/workers/docs`. All files are
self-hosted, so documentation builds and visitors do not need Google Fonts requests.

- **Nunito**: variable Latin subset, weights 200–1000, from Google Fonts
  (`https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaBTMnFcQ.woff2`).
  License copied from `monorepo/packages/og/assets/Nunito-OFL.txt`.
- **Nunito Bold and Black**: static TTF faces copied from
  `monorepo/packages/og/assets/` for Open Graph rendering (weights 700 and 900).
  They share the adjacent `Nunito-OFL.txt` license; the image renderer needs TTF
  rather than the site's WOFF2 font.
- **Space Grotesk Bold**: copied with its OFL license from
  `monorepo/workers/www/public/fonts/`.
- **Maple Mono**: variable subset, weights 100–800, copied with its OFL license from
  `monorepo/workers/www/src/app/fonts/`.

Keep each adjacent OFL license with its font when updating these assets.
