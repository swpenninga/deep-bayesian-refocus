/* Bayesian REFoCUS - recovery gallery.

   Six B-modes of one scene: the ground truth, the two things that go in, and
   the three decodes of the encoded acquisition. Three controls move through
   the E2 grid -- scene, transmit encoding, and the number of transmits Nb.

   Assets are WebP sprite atlases (see eval/visualizations/e2_gallery_web.py in
   the research repo). One atlas holds every Nb of every method for one
   (scene, encoding) pair, so dragging the Nb slider is a canvas blit and never
   a request; only scene and encoding fetch, and the neighbours of the current
   cell are prefetched so those rarely stall either.

   The six are drawn into ONE canvas rather than six elements, sized to fit the
   viewport in BOTH axes: the figure is a comparison, so it is worth nothing if
   the reader has to scroll to see half of it. The internal grid reflows 6x1 ->
   3x2 -> 2x3 as the screen narrows, and the tile scale is whichever of the
   width and height budgets binds first.

   Every tile was written on the same fixed [-50, 0] dB window, so what changes
   between two panels is the recovery and not the display gain. */

(function () {
  "use strict";

  var root = document.getElementById("gallery");
  if (!root) return;

  var M = window.E2_MANIFEST;
  if (!M) { root.classList.add("is-failed"); return; }

  var BASE = root.dataset.assets || "static/gallery/";
  var TW = M.tile[0], TH = M.tile[1];

  /* Column order of the row, left to right. The first two are frame-only and
     come from their own strips; the rest are addressed in the sweep atlas by
     their index in M.methods. */
  var COLUMNS = [
    { key: "truth", strip: "truth", label: "ground truth" },
    { key: "input", strip: "input", label: "full data set" },
    { key: "adjoint", method: "adjoint", label: "encoded input" },
    { key: "dps", method: "dps", label: "Bayesian REFoCUS", ours: true },
    { key: "ramp", method: "ramp", label: "ramp-filtered" },
    { key: "tikhonov", method: "tikhonov", label: "oracle Tikhonov" }
  ];

  var ENC_LABEL = {
    focused: "focused", diverging: "diverging", wide: "wide",
    pw: "plane wave", hadamard: "Hadamard", random: "random"
  };

  var GAP = 3;            // px between columns; enough to separate, not to divide
  var GAP_Y = 12;         // more between rows: a label needs air under the
                          // image above it or it reads as that image's caption
  var LABEL_H = 15;       // strip reserved above each tile for its name
  var FAINT = "#6b7280", ACCENT = "#7dd3fc", ACCENT_DIM = "#38598a";
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  var scene = 0, enc = 0, nbi = M.nb.length - 1;   // open at full Nb: the
                                                   // agreement everyone expects,
                                                   // so the slider moves AWAY
                                                   // from it into the sparse
                                                   // regime that is the point.
  var ready = false;
  var cols = 6, rows = 1, drawW = 0, drawH = 0;

  /* ---- asset loading ----------------------------------------------------
     Only the strips are required to boot. Sweep atlases are fetched per cell
     and memoized; 60 of them is ~21 MB, which is not a page load. */

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

  function sweepName(s, e) { return M.sweeps[s * M.encodings.length + e]; }

  /* ---- atlas addressing ------------------------------------------------- */

  function sweepTile(im, method) {
    var mi = M.methods.indexOf(method);
    var i = nbi * M.cols + mi;
    return [im, (i % M.cols) * TW, Math.floor(i / M.cols) * TH];
  }

  function sourceFor(col) {
    if (col.strip) {
      var im = images[M[col.strip]];
      return im ? [im, scene * TW, 0] : null;
    }
    var sw = images[sweepName(scene, enc)];
    return sw ? sweepTile(sw, col.method) : null;
  }

  /* ---- layout -----------------------------------------------------------
     The tile scale is the smaller of what the width allows and what is left of
     the viewport height once the controls are on screen, so the whole figure
     is always visible at once. */

  var stage = root.querySelector("[data-gal=stage]");
  var controls = root.querySelector(".gal-controls");
  var cv = root.querySelector("[data-gal=sheet]");
  var ctx = cv.getContext("2d");

  /* Largest tile a given number of columns allows, within both budgets. */
  function scaleFor(nc, availW, budgetH) {
    var nr = Math.ceil(COLUMNS.length / nc);
    return Math.min((availW - (nc - 1) * GAP) / nc / TW,
                    ((budgetH - (nr - 1) * GAP_Y) / nr - LABEL_H) / TH);
  }

  function layout() {
    var availW = stage.clientWidth || root.clientWidth;
    var ctlH = controls ? controls.getBoundingClientRect().height : 0;
    // 150px covers the section's own padding plus a little air, so the figure
    // does not sit flush against the fold.
    var budgetH = Math.max(200, window.innerHeight - ctlH - 150);

    // Pick the arrangement that draws the BIGGEST tile rather than one keyed to
    // a width breakpoint. Six in a row is width-bound long before it is
    // height-bound, so on an ordinary laptop it wastes most of the screen and
    // 3x2 shows each B-mode at nearly twice the size.
    cols = 6;
    var best = -1;
    [6, 3, 2, 1].forEach(function (nc) {
      var sc = scaleFor(nc, availW, budgetH);
      if (sc > best) { best = sc; cols = nc; }
    });
    rows = Math.ceil(COLUMNS.length / cols);

    // Never draw a tile larger than the pixels behind it: past 1:1 the atlas
    // is only being interpolated, which costs sharpness and buys no detail.
    var scale = Math.min(best, 1);
    drawW = Math.max(1, Math.floor(TW * scale));
    drawH = Math.max(1, Math.floor(TH * scale));

    var cssW = cols * drawW + (cols - 1) * GAP;
    var cssH = rows * (drawH + LABEL_H) + (rows - 1) * GAP_Y;

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
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.imageSmoothingQuality = "high";

    COLUMNS.forEach(function (col, i) {
      var s = sourceFor(col);
      var x = (i % cols) * (drawW + GAP);
      var y = Math.floor(i / cols) * (drawH + LABEL_H + GAP_Y);

      ctx.fillStyle = col.ours ? ACCENT : FAINT;
      ctx.fillText(col.label.toUpperCase(), x, y + LABEL_H - 5);

      if (!s) return;
      ctx.drawImage(s[0], s[1], s[2], TW, TH, x, y + LABEL_H, drawW, drawH);
      // The row's whole point is a comparison against one column, so that
      // column is outlined rather than left to be found by reading labels.
      if (col.ours) {
        ctx.strokeStyle = ACCENT_DIM;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + LABEL_H + 0.5, drawW - 1, drawH - 1);
      }
    });
  }

  /* ---- cell selection --------------------------------------------------- */

  var nbOut = root.querySelector("[data-gal=nbout]");
  var pctOut = root.querySelector("[data-gal=pct]");

  function readout() {
    var nb = M.nb[nbi];
    nbOut.textContent = nb;
    pctOut.textContent = (100 * nb / M.n_tx_total).toFixed(
      nb * 100 % M.n_tx_total === 0 ? 0 : 1) + "% of a full acquisition";
  }

  /* Fetch the cell's atlas, then the four cells one step away, so the common
     moves (nudge the encoding, step the scene) are already resident. */
  function ensure() {
    var want = sweepName(scene, enc);
    load(want).then(function () {
      if (sweepName(scene, enc) !== want) return;   // moved on while loading
      root.classList.remove("is-busy");
      draw();
      var ne = M.encodings.length, ns = M.frames.length;
      [[scene, (enc + 1) % ne], [scene, (enc + ne - 1) % ne],
       [(scene + 1) % ns, enc], [(scene + ns - 1) % ns, enc]]
        .forEach(function (c) { load(sweepName(c[0], c[1])).catch(function () {}); });
    }).catch(function () { root.classList.add("is-failed"); });
    if (!images[want]) root.classList.add("is-busy");
  }

  function select(s, e, n) {
    var moved = (s !== scene || e !== enc);
    scene = s; enc = e; nbi = n;
    readout();
    if (moved) ensure(); else draw();
  }

  /* ---- controls --------------------------------------------------------- */

  function buttonGroup(host, labels, get, set) {
    var btns = labels.map(function (text, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "gal-chip";
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
    root.querySelector("[data-gal=enc]"),
    M.encodings.map(function (e) { return ENC_LABEL[e] || e; }),
    function () { return enc; },
    function (i) { select(scene, i, nbi); });

  buttonGroup(
    root.querySelector("[data-gal=scene]"),
    M.frames.map(function (_, i) { return String(i + 1); }),
    function () { return scene; },
    function (i) { select(i, enc, nbi); });

  var nbSlider = root.querySelector("[data-gal=nb]");
  nbSlider.max = M.nb.length - 1;
  nbSlider.value = nbi;
  nbSlider.addEventListener("input", function () {
    select(scene, enc, +nbSlider.value);
  });

  /* Tick labels under the slider, so the eight sampled counts are legible as
     the powers of two they are rather than a bare 0-7 position. */
  var ticks = root.querySelector("[data-gal=ticks]");
  M.nb.forEach(function (nb) {
    var s = document.createElement("span");
    s.textContent = nb;
    ticks.appendChild(s);
  });

  window.addEventListener("resize", layout);

  /* ---- start ------------------------------------------------------------ */

  function boot() {
    Promise.all([load(M.truth), load(M.input), load(sweepName(scene, enc))])
      .then(function () {
        ready = true;
        root.classList.add("is-ready");
        nbSlider.disabled = false;
        layout();
        ensure();
      })
      .catch(function () { root.classList.add("is-failed"); });
  }

  readout();
  layout();

  // Same reasoning as the trajectory viewer: a reader who never scrolls this
  // far should not pay for the atlases, so the gallery arms itself on approach.
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
