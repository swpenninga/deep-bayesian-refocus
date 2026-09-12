/* Bayesian REFoCUS - noise robustness.

   Three B-modes of one subject at a fixed transmit count and sequence: the
   multistatic data set, the Bayesian REFoCUS posterior mean recovered from
   the measurements, and those measurements themselves. Two controls move
   through the E3 grid -- measurement SNR, and subject.

   Assets are WebP sprite atlases (see eval/visualizations/e3_noise_web.py in
   the research repo). One atlas holds every SNR for one subject, so dragging
   the slider is a canvas blit and never a request; only the subject fetches,
   and the next two subjects are prefetched so those rarely stall either.

   All three are drawn into ONE canvas rather than three elements, sized to fit
   the viewport in both axes: the figure is a comparison, so it is worth
   nothing if the reader has to scroll to see half of it.

   Every tile was written on the same fixed [-50, 0] dB window, so what changes
   between two panels is the recovery and not the display gain.

   The panel deliberately shows ONE cell of two axes E3 swept -- one encoding
   and one transmit count -- rather than a control for each. Both are named in
   the caption instead, and both are still axes in the manifest, so restoring
   either is a re-export plus (for the encoding) nothing at all here: the draw
   loop already runs one row per M.encodings entry and grows a gutter for their
   names as soon as there is more than one. */

(function () {
  "use strict";

  var root = document.getElementById("noise");
  if (!root) return;

  var M = window.E3_MANIFEST;
  if (!M) { root.classList.add("is-failed"); return; }

  var BASE = root.dataset.assets || "static/noise/";
  var TW = M.tile[0], TH = M.tile[1];

  /* Column order, shared with the guidance-strength and transmit-count panels
     so the three read as one figure: the recovery sits in the MIDDLE, flanked
     by the multistatic set it is estimating and the measurements it was given.
     It is the only column that moves with the slider, so both comparisons a
     reader makes are with adjacent panels rather than across the figure.
     "truth" is frame-only and comes from its own strip; the rest are addressed
     in the sweep atlas by their index in M.methods.

     The oracle Tikhonov baseline is not exported any more. On the Hadamard
     encoding it is the adjoint EXACTLY -- that operator has one repeated
     singular value, so its Tikhonov filter is a scalar for any gamma and the
     B-mode normalisation divides that scalar out -- and on the others it sits
     within a fraction of a dB of it over most of the image. Drawing it put two
     all-but-identical panels side by side and read as a broken figure. */
  var COLS = [
    { key: "truth", strip: "truth", label: "multistatic data set" },
    { key: "dps", method: "dps", label: "Bayesian REFoCUS", ours: true },
    { key: "adjoint", method: "adjoint", label: "measurements" }
  ];

  /* All lower case, including hadamard: these read as a set of options, and
     capitalising the one that happens to be a surname breaks that. */
  var ENC_LABEL = { focused: "focused", hadamard: "hadamard" };

  /* The beamformed grid has a circular valid-range boundary -- support.py's
     image_mask is hypot(x, z) < VALID_RANGE_M -- and the posterior lays a thin
     bright rim right on it that appears in neither the truth nor the
     measurement. The paper's own qualitative figures mask that boundary away
     (eval/e3/run.py draws through support.mask_image); the web export never
     did, and that rim is the arc along the bottom of every recovery panel.

     A horizontal crop cannot remove it. The boundary is a CURVE -- lowest in
     the middle, rising to 0.87 of the tile at the edges -- so a straight cut
     deep enough to clear it discards 13% of the image, and a shallow one just
     slices the rim where it is brightest, leaving a harder line than before
     (measured at the cut: 58/255 uncut, 136 at 0.97, 170 at 0.95). Clip to the
     curve instead.

     SUP_A/SUP_B are the semi-axes in FULL-GRID pixels -- an ellipse because
     the grid's x and z spacings differ -- fitted to the exported support to
     1.3px rms rather than recomputed from the scan geometry, and converted
     below through whichever crop and tile size the manifest carries. KEEP is a
     fraction of that radius: a radial profile puts the rim entirely in the
     outer 3% (excess over truth ~9 levels across 0.975-0.985, ~0.4 levels
     inside 0.965), so 0.965 takes the rim and nothing else. */
  var SUP_A = 1190.1, SUP_B = 983.1, KEEP = 0.965;
  var _cr = M.crop, _src = M.source_shape;
  var _sx = TW / (_cr[3] - _cr[2]), _sy = TH / (_cr[1] - _cr[0]);
  var SUP_CX = (_src[1] / 2 - _cr[2]) * _sx;   // tile px, on the array axis
  var SUP_CY = -_cr[0] * _sy;                  // tile px; the arc is centred
                                               // on the transducer face
  var SUP_RX = SUP_A * KEEP * _sx;
  var SUP_RY = SUP_B * KEEP * _sy;
  // Nothing survives the clip below the mask's lowest point, so end the tile
  // there rather than pad every panel with a strip of black.
  var TH_SHOWN = Math.min(TH, Math.ceil(SUP_CY + SUP_RY) + 1);
  var sX = 1, sY = 1;                          // dest px per source px; set in layout

  // The transmit count is fixed, so the atlas axis is pinned rather than
  // controlled. The export writes one entry; index 0 is that entry.
  var NBI = 0;

  var GAP = 3;            // px between columns; enough to separate, not to divide
  var GAP_Y = 4;          // and less between rows, when there is more than one
  var LABEL_H = 25;       // strip reserved above the top row for column names
  // A single row needs no gutter: there is nothing to tell apart, and the
  // caption already names the encoding.
  var GUTTER = M.encodings.length > 1 ? 20 : 0;
  var FAINT = "#a4adb9", MUTED = "#9aa0a8";
  var ACCENT = "#7dd3fc", ACCENT_DIM = "#426b85";
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  // Open at the headline SNR, which the export also makes the CLEAN end of the
  // sweep: it is the operating point every other figure on this page is drawn
  // at, and the recovery has visibly converged by it, so the reader starts
  // from the familiar cell and drags left into the noise. Falls back to the
  // first stop if a re-export drops this SNR.
  var HEADLINE_SNR = 10;

  function snrLabel(v) { return v === null ? "clean" : String(v); }

  var scene = 0;
  var snri = Math.max(0, M.snr.indexOf(HEADLINE_SNR));
  var ready = false;
  var drawW = 0, drawH = 0;

  /* ---- asset loading ----------------------------------------------------
     Only the truth strip is required to boot. Sweep atlases are fetched per
     subject and memoized; 10 of them is ~1.6 MB, which is not a page load. */

  var assets = window.RefocusAssets;
  var images = {};

  function load(name, priority) {
    return assets.load(BASE + name, priority).then(function (image) {
      images[name] = image;
      return image;
    });
  }

  function sweepName(s) { return M.sweeps[s * M.nb.length + NBI]; }

  /* ---- atlas addressing -------------------------------------------------
     Row-major over (SNR, encoding, method), exactly as the exporter packs it. */

  function sourceFor(col, enci) {
    if (col.strip) {
      var st = images[M[col.strip]];
      return st ? [st, scene * TW, 0] : null;
    }
    var sw = images[sweepName(scene)];
    if (!sw) return null;
    var i = snri * M.cols
      + enci * M.methods.length + M.methods.indexOf(col.method);
    return [sw, (i % M.cols) * TW, Math.floor(i / M.cols) * TH];
  }

  /* ---- layout -----------------------------------------------------------
     The tile scale is the smaller of what the width allows and what is left of
     the viewport height once the controls are on screen, so the whole figure
     is always visible at once. */

  var stage = root.querySelector("[data-noise=stage]");
  var controls = root.querySelector(".noise-controls");
  var cv = root.querySelector("[data-noise=sheet]");
  var ctx = cv.getContext("2d");
  var narrow = false;

  function layout() {
    var nrow = M.encodings.length, ncol = COLS.length;
    var stageStyle = getComputedStyle(stage);
    var availW = (stage.clientWidth || root.clientWidth)
      - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
    narrow = availW < 560;
    if (narrow) { nrow *= ncol; ncol = 1; }
    var ctlH = controls ? controls.getBoundingClientRect().height : 0;
    // 150px covers the section's own padding plus a little air, so the figure
    // does not sit flush against the fold.
    var budgetH = Math.max(200, window.innerHeight - ctlH - 150);

    if (narrow) budgetH = Infinity;
    var scale = Math.min(
      (availW - GUTTER - (ncol - 1) * GAP) / ncol / TW,
      (budgetH - LABEL_H - (nrow - 1) * GAP_Y) / nrow / TH_SHOWN);
    // Never draw a tile larger than the pixels behind it: past 1:1 the atlas
    // is only being interpolated, which costs sharpness and buys no detail.
    scale = Math.min(scale, 1);
    drawW = Math.max(1, Math.floor(TW * scale));
    drawH = Math.max(1, Math.floor(TH_SHOWN * scale));
    sX = drawW / TW;
    sY = drawH / TH_SHOWN;

    var cssW = GUTTER + ncol * drawW + (ncol - 1) * GAP;
    var cssH = (narrow ? nrow : 1) * LABEL_H + nrow * drawH + (nrow - 1) * GAP_Y;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.style.width = cssW + "px";
    cv.style.height = cssH + "px";
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    draw();
  }

  /* ---- drawing ---------------------------------------------------------- */

  function draw() {
    var cssW = parseFloat(cv.style.width), cssH = parseFloat(cv.style.height);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!ready) return;

    var fs = Math.max(10, Math.min(12, Math.round(drawW / 22)));
    ctx.font = fs + "px " + MONO;
    ctx.textBaseline = "alphabetic";
    ctx.imageSmoothingQuality = "high";

    // Column names once, above the top row: repeating them over a second row
    // would say the rows differ in something they do not.
    ctx.textAlign = "left";
    if (!narrow) COLS.forEach(function (col, c) {
      ctx.fillStyle = col.ours ? ACCENT : FAINT;
      ctx.fillText(col.label.toUpperCase(),
                   GUTTER + c * (drawW + GAP), LABEL_H - 5);
    });

    M.encodings.forEach(function (enc, r) {
      var rowY = LABEL_H + r * (drawH + GAP_Y);

      // With more than one encoding their names go in the gutter, turned on
      // their side: a row heading in the flow above the images would push the
      // rows apart and break the block they are meant to read as.
      if (GUTTER && !narrow) {
        ctx.save();
        ctx.translate(fs + 1, rowY + drawH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.fillStyle = MUTED;
        ctx.fillText((ENC_LABEL[enc] || enc).toUpperCase(), 0, 0);
        ctx.restore();
      }

      COLS.forEach(function (col, c) {
        var s = sourceFor(col, r);
        if (!s) return;
        var x = GUTTER + (narrow ? 0 : c * (drawW + GAP));
        var y = narrow ? LABEL_H + (r * COLS.length + c) * (LABEL_H + drawH + GAP_Y) : rowY;
        if (narrow) {
          ctx.fillStyle = col.ours ? ACCENT : FAINT;
          ctx.fillText(col.label.toUpperCase(), x, y - 5);
        }
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x + SUP_CX * sX, y + SUP_CY * sY,
                    SUP_RX * sX, SUP_RY * sY, 0, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(s[0], s[1], s[2], TW, TH_SHOWN, x, y, drawW, drawH);
        ctx.restore();
        // The figure's whole point is a comparison against one panel, so that
        // panel is outlined rather than left to be found by reading labels.
        if (col.ours) {
          ctx.strokeStyle = ACCENT_DIM;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, drawW - 1, drawH - 1);
        }
      });
    });
  }

  /* ---- cell selection --------------------------------------------------- */

  var snrOut = root.querySelector("[data-noise=snrout]");

  function readout() {
    var snr = M.snr[snri];
    root.style.setProperty("--range-progress", (100 * snri / Math.max(1, M.snr.length - 1)) + "%");
    snrOut.textContent = snr === null ? "noiseless" : snr + " dB";
  }

  /* Fetch this subject, then the next two. Never wrap subject 1 to subject 10:
     examples are ordered strongest first. */
  function ensure() {
    var want = sweepName(scene);
    load(want).then(function () {
      if (sweepName(scene) !== want) return;   // moved on while loading
      root.classList.remove("is-busy", "is-failed");
      draw();
      var ns = M.frames.length;
      [scene + 1, scene + 2].filter(function (s) { return s < ns; })
        .forEach(function (s) { load(sweepName(s), "low").catch(function () {}); });
    }).catch(function () {
      if (sweepName(scene) === want) root.classList.add("is-failed");
    });
    if (!images[want]) root.classList.add("is-busy");
  }

  function select(s, si) {
    var moved = (s !== scene);
    scene = s; snri = si;
    readout();
    if (refreshReadiness) refreshReadiness();
    if (moved || !images[sweepName(scene)]) ensure(); else draw();
  }

  /* ---- controls --------------------------------------------------------- */

  function buttonGroup(host, labels, get, set) {
    var btns = labels.map(function (text, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "noise-chip";
      b.textContent = text;
      b.addEventListener("click", function () { set(i); sync(); });
      host.appendChild(b);
      return b;
    });
    function sync() {
      btns.forEach(function (b, i) {
        var on = i === get();
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    sync();
    return sync;
  }

  buttonGroup(
    root.querySelector("[data-noise=scene]"),
    M.frames.map(function (_, i) { return String(i + 1); }),
    function () { return scene; },
    function (i) { select(i, snri); });

  function subjectUrls(s) {
    return [BASE + M.truth, BASE + sweepName(s)];
  }
  var refreshReadiness = assets.watch(root, function () {
    root.querySelectorAll("[data-noise=scene] button").forEach(function (button, i) {
      assets.mark(button, subjectUrls(i));
    });
    return subjectUrls(scene);
  });

  var snrSlider = root.querySelector("[data-noise=snr]");
  snrSlider.max = M.snr.length - 1;
  snrSlider.value = snri;
  snrSlider.addEventListener("input", function () {
    select(scene, +snrSlider.value);
  });

  /* Tick labels under the slider, so the ten sampled levels are legible as the
     dB values they are rather than a bare 0-9 position.

     Each label is pinned to where the THUMB CENTRE actually lands, not to an
     even division of the track. A range input's thumb travels only
     (track - thumb) px, so evenly spaced labels drift away from the thumb
     towards both ends -- most visibly at -20 and clean. The CSS turns --i into
     calc(thumb/2 + (100% - thumb) * i/(n-1)). */
  var ticks = root.querySelector("[data-noise=ticks]");
  var last = M.snr.length - 1;
  M.snr.forEach(function (v, i) {
    var el = document.createElement("span");
    el.textContent = snrLabel(v);
    el.style.setProperty("--i", i);
    el.style.setProperty("--n", last);
    ticks.appendChild(el);
  });

  window.addEventListener("resize", layout);

  /* ---- start ------------------------------------------------------------ */

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    if (io) io.disconnect();
    Promise.all([M.truth, sweepName(scene)].map(function (name) { return load(name); }))
      .then(function () {
        ready = true;
        root.classList.add("is-ready");
        snrSlider.disabled = false;
        layout();
        ensure();
      })
      .catch(function () { root.classList.add("is-failed"); });
  }

  readout();
  layout();

  // Warm this viewer during the overview, or when the reader scrolls to it.
  document.addEventListener("refocus:prefetch", boot, { once: true });
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        io.disconnect();
        boot();
      }
    }, { rootMargin: "300px" });
    io.observe(root);
  } else {
    boot();
  }
})();
