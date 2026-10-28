# Third-party files

The MIT license in `LICENSE` covers the code written for this package. These bundled files keep their own licenses:

| File | What | License |
|---|---|---|
| `app/public/vendor/hls.min.js` | hls.js, HLS playback in the web room | Apache-2.0 (https://github.com/video-dev/hls.js) |
| `app/public/vendor/volc-rtc.min.js` | Volcengine RTC Web SDK, the live picture in the web room and the Square feed | New BSD, text in `volc-rtc.LICENSE` next to it |
| `app/relay/vendor/trtc.js` | Tencent TRTC Web SDK (`trtc.js` from the npm package `trtc-sdk-v5`, a 5.x build), used by the server-side relay page | ISC, as declared in that package's `package.json`. To update: `npm pack trtc-sdk-v5` and copy `package/trtc.js` here |
| `app/relay/fonts/kai.ttf` | LXGW WenKai | SIL Open Font License 1.1, see `app/relay/fonts/README.md` |
| `app/relay/fonts/num.ttf` | Oswald | SIL Open Font License 1.1, see `app/relay/fonts/README.md` |

npm packages (`app/package.json`) are installed at setup time, not shipped.
The folders under `tools/` list their own outside tools and models in their READMEs.
