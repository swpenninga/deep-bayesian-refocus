/* Bayesian REFoCUS - noise robustness.

   Six B-modes of one subject at one transmit count: a row per encoding
   (focused above, Hadamard below), and along each row the noiseless truth, the
   measurement the sampler is handed, and the Bayesian REFoCUS posterior mean.
   Three controls move through the E3 grid -- measurement SNR, transmit count
   Nb, and subject.

   Assets are WebP sprite atlases (see eval/visualizations/e3_noise_web.py in
   the research repo). One atlas holds every SNR of BOTH encodings for one
   (subject, Nb) pair, so dragging the SNR slider is a canvas blit and never a
   request -- and so is comparing the two rows, which are the comparison the
   figure exists for. Only subject and Nb fetch, and the neighbours of the
   current cell are prefetched so those rarely stall either.

   All six are drawn into ONE canvas rather than six elements, sized to fit the
   viewport in both axes: the figure is a comparison, so it is worth nothing if
   the reader has to scroll to see half of it.

   Every tile was written on the same fixed [-50, 0] dB window, so what changes
   between two panels is the recovery and not the display gain. The truth
   column is frame-only and is deliberately redrawn in both rows: each row is
   then a complete statement on its own, read left to right. */

(function () {
  "use strict";

  var root = document.getElementById("noise");
  if (!root) return;

  var M = window.E3_MANIFEST;
  if (!M) { root.classList.add("is-failed"); return; }

  var BASE = root.dataset.assets || "static/noise/";
  var TW = M.tile[0], TH = M.tile[1];

  /* Column order, and it carries the argument: what was there, what was
     measured of it, what the posterior recovered. "truth" is frame-only and
     comes from its own strip; the rest are addressed in the sweep atlas by
     their index in M.methods.

     The oracle Tikhonov baseline the atlas still carries is deliberately not
     drawn. On the Hadamard row it is the adjoint EXACTLY -- that operator has
     one repeated singular value, so its Tikhonov filter is a scalar for any
     gamma and the B-mode normalisation divides that scalar out -- which put
     two identical panels side by side and read as a broken figure. Restoring
     it is one entry here. */
  var COLS = [
    { key: "truth", strip: "truth", label: "ground truth" },
    { key: "adjoint", method: "adjoint", label: "model input" },
    { key: "dps", method: "dps", label: "Bayesian REFoCUS", ours: true }
  ];

  /* All lower case, including hadamard: these read as a set of options, and
     capitalising the one that happens to be a surname breaks that. */
  var ENC_LABEL = { focused: "focused", hadamard: "hadamard" };

  var GAP = 3;            // px between columns; enough to separate, not to divide
  var GAP_Y = 4;          // and less between rows: the two encodings are one
                          // block, not two figures stacked
  var LABEL_H = 16;       // strip reserved above the top row for column names
  var GUTTER = 20;        // left gutter for the rotated encoding names
  var FAINT = "#6b7280", MUTED = "#9aa0a8";
  var ACCENT = "#7dd3fc", ACCENT_DIM = "#38598a";
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  // Open at the headline SNR rather than at an extreme: it is the operating
  // point every other figure on this page is drawn at, so the reader starts
  // from the familiar cell and drags AWAY from it in either direction.
  var HEADLINE_SNR = 10;

  function snrLabel(v) { return v === null ? "clean" : String(v); }

  var scene = 0;
  var nbi = 0;
  var snri = Math.max(0, M.snr.indexOf(HEADLINE_SNR));
  var ready = false;
  var drawW = 0, drawH = 0;

  /* ---- asset loading ----------------------------------------------------
     Only the truth strip is required to boot. Sweep atlases are fetched per
     cell and memoized; 20 of them is ~12 MB, which is not a page load. */

  var images = {};
  var pending = {};

  function load(name) {
    if (images[name]) return Promise.resolve(images[name]);
    if (pending[name]) return pending[name];
    pending[name] = new Promise(function (res, rej) {
      var im = new Image();
      im.decoding = "async";
      im.onload = function () { images[name] = im; res(im); };
      im.onerror = function () { rej(new Error(name)); };
      im.src = BASE + name;
    });
    return pending[name];
  }

  function sweepName(s, n) { return M.sweeps[s * M.nb.length + n]; }

  /* ---- atlas addressing -------------------------------------------------
     Row-major over (SNR, encoding, method), exactly as the exporter packs it. */

  function sourceFor(col, enci) {
    if (col.strip) {
      var st = images[M[col.strip]];
      return st ? [st, scene * TW, 0] : null;
    }
    var sw = images[sweepName(scene, nbi)];
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

  function layout() {
    var nrow = M.encodings.length, ncol = COLS.length;
    var availW = stage.clientWidth || root.clientWidth;
    var ctlH = controls ? controls.getBoundingClientRect().height : 0;
    // 150px covers the section's own padding plus a little air, so the figure
    // does not sit flush against the fold.
    var budgetH = Math.max(200, window.innerHeight - ctlH - 150);

    var scale = Math.min(
      (availW - GUTTER - (ncol - 1) * GAP) / ncol / TW,
      (budgetH - LABEL_H - (nrow - 1) * GAP_Y) / nrow / TH);
    // Never draw a tile larger than the pixels behind it: past 1:1 the atlas
    // is only being interpolated, which costs sharpness and buys no detail.
    scale = Math.min(scale, 1);
    drawW = Math.max(1, Math.floor(TW * scale));
    drawH = Math.max(1, Math.floor(TH * scale));

    var cssW = GUTTER + ncol * drawW + (ncol - 1) * GAP;
    var cssH = LABEL_H + nrow * drawH + (nrow - 1) * GAP_Y;

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

    var fs = Math.max(8, Math.min(11, Math.round(drawW / 22)));
    ctx.font = fs + "px " + MONO;
    ctx.textBaseline = "alphabetic";
    ctx.imageSmoothingQuality = "high";

    // Column names once, above the top row: repeating them over the second
    // row would say the rows differ in something they do not.
    ctx.textAlign = "left";
    COLS.forEach(function (col, c) {
      ctx.fillStyle = col.ours ? ACCENT : FAINT;
      ctx.fillText(col.label.toUpperCase(),
                   GUTTER + c * (drawW + GAP), LABEL_H - 5);
    });

    M.encodings.forEach(function (enc, r) {
      var y = LABEL_H + r * (drawH + GAP_Y);

      // The encoding names go in the gutter, turned on their side: a row
      // heading in the flow above the images would push the two rows apart and
      // break the block they are meant to read as.
      ctx.save();
      ctx.translate(fs + 1, y + drawH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillStyle = MUTED;
      ctx.fillText((ENC_LABEL[enc] || enc).toUpperCase(), 0, 0);
      ctx.restore();

      COLS.forEach(function (col, c) {
        var s = sourceFor(col, r);
        if (!s) return;
        var x = GUTTER + c * (drawW + GAP);
        ctx.drawImage(s[0], s[1], s[2], TW, TH, x, y, drawW, drawH);
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
  var nbOut = root.querySelector("[data-noise=nbout]");
  var pctOut = root.querySelector("[data-noise=pct]");

  function readout() {
    var snr = M.snr[snri];
    snrOut.textContent = snr === null ? "noiseless" : snr + " dB";
    var nb = M.nb[nbi];
    nbOut.textContent = nb;
    pctOut.textContent = (100 * nb / M.n_tx_total).toFixed(
      nb * 100 % M.n_tx_total === 0 ? 0 : 1) + "% of a full acquisition";
  }

  /* Fetch the cell's atlas, then the cells one step away, so the common moves
     (flip the transmit count, step the subject) are already resident. */
  function ensure() {
    var want = sweepName(scene, nbi);
    load(want).then(function () {
      if (sweepName(scene, nbi) !== want) return;   // moved on while loading
      root.classList.remove("is-busy");
      draw();
      var nn = M.nb.length, ns = M.frames.length;
      [[scene, (nbi + 1) % nn],
       [(scene + 1) % ns, nbi], [(scene + ns - 1) % ns, nbi]]
        .forEach(function (c) { load(sweepName(c[0], c[1])).catch(function () {}); });
    }).catch(function () { root.classList.add("is-failed"); });
    if (!images[want]) root.classList.add("is-busy");
  }

  function select(s, n, si) {
    var moved = (s !== scene || n !== nbi);
    scene = s; nbi = n; snri = si;
    readout();
    if (moved) ensure(); else draw();
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
    root.querySelector("[data-noise=nb]"),
    M.nb.map(String),
    function () { return nbi; },
    function (i) { select(scene, i, snri); });

  buttonGroup(
    root.querySelector("[data-noise=scene]"),
    M.frames.map(function (_, i) { return String(i + 1); }),
    function () { return scene; },
    function (i) { select(i, nbi, snri); });

  var snrSlider = root.querySelector("[data-noise=snr]");
  snrSlider.max = M.snr.length - 1;
  snrSlider.value = snri;
  snrSlider.addEventListener("input", function () {
    select(scene, nbi, +snrSlider.value);
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

  function boot() {
    Promise.all([M.truth, sweepName(scene, nbi)].map(load))
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

  // Same reasoning as the gallery: a reader who never scrolls this far should
  // not pay for the atlases, so the panel arms itself on approach.
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
