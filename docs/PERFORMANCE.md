# Page weight and media loading

Audit: 11 September 2026; compression and readiness update: 12 September 2026.
Sizes use decimal MB (1 MB = 1,000,000 bytes).

## Findings

Before these changes, `docs/` contained about 97.95 MB of assets. This is the
entire collection, not the amount downloaded when opening the page:

| Assets | Size before changes |
| --- | ---: |
| In-vivo animated WebPs | 74.05 MB |
| Recovery gallery | 12.84 MB |
| Teaser and poster | 5.58 MB |
| Trajectory viewer | 2.79 MB |
| Noise viewer | 1.82 MB |
| Uncertainty viewer | 0.75 MB |
| HTML, CSS, and viewer JavaScript | 0.11 MB |

The live GitHub Pages response already sends HTML with `Content-Encoding: gzip`:
the checked HTML response was 5,457 bytes compressed (18,410 bytes locally).
Images already use WebP. The original teaser is a silent H.264 MP4, 1920×1080
at 60 fps, 102.55 seconds, 5,523,815 bytes. Its `moov` metadata is already at the
front, so playback does not require downloading the entire file first.

Additional gzip files would not address the media payload. Changing codecs is
also not automatically an improvement: the tested 1080p H.264/30 fps encode was
larger than the original, and a VP9/1080p/60 fps trial exceeded the original size
before finishing. The subsequent still-image study is described below. In-vivo animations and
uncertainty maps retain their original pixels because further tested compression
affected speckle or smooth-map detail too strongly.

## Implemented changes

- The teaser starts paused, with a prominent keyboard-accessible play button.
  Native controls remain available, including when JavaScript is disabled.
- With JavaScript, `preload="auto"` allows advance buffering. Browsers reporting
  Save-Data or a 2G/3G connection retain `preload="metadata"`. Without JavaScript,
  the HTML also defaults to metadata. Preload is a browser hint, not a guaranteed
  download amount; see [MDN's video reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video).
  Advance buffering still consumes data even if the reader never presses play.
- Viewports up to 720 CSS pixels select a 1280×720, 30 fps MP4 of 3,454,897 bytes,
  **37.5% smaller**. Larger viewports retain the original 1080p/60 fps source.
  The browser selects one source using [source media queries](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/source).
  This is selection at load time, not adaptive streaming; entering fullscreen
  does not automatically upgrade the mobile video.
- Recovery, noise, uncertainty, and in-vivo viewers prefetch the next two choices
  in their curated display order, including on slow connections and with
  Save-Data enabled. Prefetch never wraps from the first choice to the last, or
  runs backward: subject 1 warms subjects 2 and 3, for example. As a reader
  advances, each selection warms the following two. Visited examples remain
  cached and sliders stay local. User-selected requests receive higher priority.
- Once the overview actually starts playing, all result sections initialize in
  the background: the trajectory, each selected example and its neighbors, and
  the selected in-vivo cine grid and its neighbors. This also works through the
  native play control.
  Startup runs once, so scrolling or replaying does not reload or reset viewers.
- Before video playback, the existing scroll-based loading still applies. The
  trajectory starts at the viewport boundary instead of 300 pixels before it.
  Readers who skip the video can scroll directly to the interactive results.
- Background warming covers each section's initial view and nearby choices.
  Distant in-vivo settings and examples load as readers explore; it does not
  fetch the entire 74 MB recording collection at once.

Keeping both video renditions increases repository size by 3.45 MB, but a browser
selects one rendition rather than downloading both.

## Earlier browser measurements (11 September deployment)

These historical figures predate the additional compression and in-vivo
neighbor prefetching below. The latter deliberately increases background data
use to make upcoming selections quicker; it is not an additional transfer saving.

Cold local Chromium runs at 1440×1000 and 390×844, with Google Fonts requests
blocked identically in both versions. Each figure was scrolled into view once,
using its default selection. The opening measurement is taken before pressing
play; in the updated version the video is then played before scrolling. Figures
and images were allowed to load before recording the scrolled result.

These figures are the **sum of the full sizes of unique local assets requested**,
including HTML and video, not measured wire bytes or a promise of load time.
Browsers can download only part of a video, and production gzip, fonts, caches,
viewport height, and connection settings change actual transfer totals.

| Scenario | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Desktop, opening view | 8.49 MB | 5.77 MB | 32% |
| Mobile, opening view | 8.46 MB | 3.67 MB | 57% |
| Desktop, scrolled through default results | 14.10 MB | 14.10 MB | approximately 0% |
| Mobile, scrolled through default results | 14.10 MB | 12.03 MB | 15% |

Neighbor prefetching is intentionally retained for quick navigation. Video-only
savings on mobile are 2.07 MB. Deferring the trajectory avoids another 2.72 MB
until the reader either plays the overview or reaches that viewer. Once video
playback starts, background result downloads increase the page's transfer total
above the opening-view numbers.

Verified in Chromium: paused initial state, buffered data before play, keyboard
play, pause overlay, mobile/desktop source selection, all viewer initialization,
sliders making no extra requests, example switching, in-vivo transmit selection,
no JavaScript errors, and no horizontal overflow. Additional checks cover 320px
width, Save-Data, 3G, browsers without Network Information, rejected `play()`
promises, and native controls with JavaScript disabled. The mobile encode was
also visually inspected. Follow-up checks verified that starting the video
without scrolling warms all five result sections, including their neighbors,
on both desktop and a mobile viewport simulating 3G plus Save-Data. Neighbor
switching, replay preserving selection, and no duplicate trajectory requests
were verified. Safari and physical mobile devices were not tested.

## Regenerating the mobile teaser

From the repository root, with FFmpeg installed:

```sh
ffmpeg -i docs/static/videos/teaser.mp4 \
  -vf scale=1280:-2,fps=30 \
  -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p \
  -movflags +faststart -an \
  docs/static/videos/teaser-mobile.mp4
```

After replacing either video, update its `?v=` cache version in `docs/index.html`.
Retain the original master for future exports; repeatedly recompressing the mobile
version introduces unnecessary quality loss.

## Still-image compression and readiness (12 September)

Applied the reviewed WebP quality 54, method 6 candidates to all 72 recovery and
noise images, retaining their dimensions and atlas layouts:

| Collection | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Recovery gallery (61 files) | 12.842 MB | 10.899 MB | 1.943 MB |
| Noise gallery (11 files) | 1.818 MB | 1.603 MB | 0.216 MB |
| Combined | 14.660 MB | 12.502 MB | **2.158 MB** |

Worst per-file grayscale SSIM against the previous site assets was 0.9784 for
gallery and 0.9820 for noise. Native-size comparisons, including tiles from the
worst-scoring atlas, showed small visual differences. These are comparisons to
the previous lossy assets, not a measure against the original simulation data.
The tested AVIF and video encodes did not justify changing formats. More
aggressive animated WebP/AV1 samples suggested 13–16 MB of possible collection
savings but visibly changed speckle, so those candidates were not applied.

Each updated image URL carries a content hash in both manifest.json and
manifest.js, so existing browser caches receive the compressed files. For future
exports, prefer encoding from source frames with Pillow's `quality=54, method=6`
for gallery and noise, then regenerate the content hashes. Do not repeatedly
recompress these published files. Keep the uncertainty and animation export
settings unchanged.

Readiness dots on subject, transmit-type, example, and transmit-count buttons
mean every image required by that choice has downloaded and decoded. Readiness
is recomputed for the current values of the other controls: a cached subject at
one transmit type does not falsely mark it ready at a different type. In-vivo
requires the full selected grid of cines. Its settings swap only after that
complete set is available, keeping partial or stale comparisons hidden.

The dot key appears once below “Interactive results”; the per-viewer legend rows
were removed. Tooltips and accessible names describe each button's state, and
loading choices show a small spinner. Screen readers retain an offscreen live
loading/error announcement. Every choice remains selectable. Reduced-motion
settings disable spinner animation. Failed files never receive a ready dot and
can be retried by selecting the example again. The shared image cache deduplicates
in-flight requests and uses `Image.decode()` before marking a resource ready.

The page deliberately does not fetch the complete roughly 89 MB result
collection. Forward two-choice warming favors the strongest early examples
without charging every visitor for every result.

Validation: controlled Chromium tests delayed downloads and decoding separately,
blocked one image in a four-file uncertainty example and one cine in an in-vivo
grid, exercised errors and retries, changed both control axes, and verified that
only complete comparisons became ready. Tests also covered overview-triggered
loading, in-vivo neighbor prefetching, keyboard-accessible labels, and layouts
at 1440px, 390px, and 320px. Screenshots were visually checked. Real mobile
hardware and Safari were not tested.
