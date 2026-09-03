/* Bayesian REFoCUS - recovery gallery.

   Five B-modes of one subject, in two rows: what goes in (the complete
   multistatic acquisition, and the encoded measurements the sampler actually
   sees) above the three decodes of those measurements. Three controls move
   through the E2 grid -- subject, transmit sequence, and the transmit count Nb.

   Assets are WebP sprite atlases (see eval/visualizations/e2_gallery_web.py in
   the research repo). One atlas holds every Nb of every method for one
   (scene, encoding) pair, so dragging the Nb slider is a canvas blit and never
   a request; only scene and encoding fetch, and the neighbours of the current
   cell are prefetched so those rarely stall either.

   All five are drawn into ONE canvas rather than five elements, sized to fit
   the viewport in BOTH axes: the figure is a comparison, so it is worth nothing
   if the reader has to scroll to see half of it. The 2-then-3 split is fixed
   because it carries the meaning (inputs above, recoveries below), so the tile
   scale is set by the wider row and whichever of the width and height budgets
   binds first.

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

  /* Two rows, and the split is the point: what is measured, then what is
     recovered from it. "input" is frame-only and comes from its own strip; the
     rest are addressed in the sweep atlas by their index in M.methods. */
  var ROWS = [
    [{ key: "input", strip: "input", label: "multistatic data set" },
     { key: "adjoint", method: "adjoint", label: "measurements" }],
    [{ key: "tikhonov", method: "tikhonov", label: "oracle Tikhonov" },
     { key: "dps", method: "dps", label: "Bayesian REFoCUS", ours: true },
     { key: "ramp", method: "ramp", label: "ramp-filtered adjoint" }]
  ];
  var NCOL = Math.max.apply(null, ROWS.map(function (r) { return r.length; }));

  /* All lower case, including hadamard: these read as a set of options, and
     capitalising the one that happens to be a surname breaks that. */
  var ENC_LABEL = {
    focused: "focused", diverging: "diverging", wide: "wide",
    pw: "plane wave", hadamard: "hadamard", random: "random"
  };

  /* Presentation order of the transmit sequences, which is not the order the
     manifest stores them in: this runs from the most focused to the least, so
     stepping along the row is stepping along a physical axis. Anything the
     manifest carries but this does not name is appended, so an encoding added
     to the export still shows up. */
  var ENC_ORDER = ["focused", "wide", "pw", "diverging", "hadamard", "random"]
    .filter(function (e) { return M.encodings.indexOf(e) >= 0; })
    .concat(M.encodings.filter(function (e) {
      return ["focused", "wide", "pw", "diverging", "hadamard", "random"]
        .indexOf(e) < 0;
    }))
    .map(function (e) { return M.encodings.indexOf(e); });

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
  var rows = 2, drawW = 0, drawH = 0;

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

  function layout() {
    var availW = stage.clientWidth || root.clientWidth;
    var ctlH = controls ? controls.getBoundingClientRect().height : 0;
    // 150px covers the section's own padding plus a little air, so the figure
    // does not sit flush against the fold.
    var budgetH = Math.max(200, window.innerHeight - ctlH - 150);

    rows = ROWS.length;
    // Both rows share one tile size -- a comparison in which the inputs were
    // drawn larger than the recoveries would be reading a difference that is
    // not in the data -- so the widest row sets the width budget.
    var scale = Math.min((availW - (NCOL - 1) * GAP) / NCOL / TW,
                         ((budgetH - (rows - 1) * GAP_Y) / rows - LABEL_H) / TH);
    // Never draw a tile larger than the pixels behind it: past 1:1 the atlas
    // is only being interpolated, which costs sharpness and buys no detail.
    scale = Math.min(scale, 1);
    drawW = Math.max(1, Math.floor(TW * scale));
    drawH = Math.max(1, Math.floor(TH * scale));

    var cssW = NCOL * drawW + (NCOL - 1) * GAP;
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

    var full = NCOL * drawW + (NCOL - 1) * GAP;
    ROWS.forEach(function (row, r) {
      // A row with fewer tiles is centred under the wider one rather than left
      // ragged, so the two rows read as one block.
      var rowW = row.length * drawW + (row.length - 1) * GAP;
      var x0 = Math.round((full - rowW) / 2);
      var y = r * (drawH + LABEL_H + GAP_Y);

      row.forEach(function (col, i) {
        var s = sourceFor(col);
        var x = x0 + i * (drawW + GAP);

        ctx.fillStyle = col.ours ? ACCENT : FAINT;
        ctx.fillText(col.label.toUpperCase(), x, y + LABEL_H - 5);

        if (!s) return;
        ctx.drawImage(s[0], s[1], s[2], TW, TH, x, y + LABEL_H, drawW, drawH);
        // The figure's whole point is a comparison against one panel, so that
        // panel is outlined rather than left to be found by reading labels.
        if (col.ours) {
          ctx.strokeStyle = ACCENT_DIM;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + LABEL_H + 0.5, drawW - 1, drawH - 1);
        }
      });
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
      var ne = ENC_ORDER.length, ns = M.frames.length;
      var ei = ENC_ORDER.indexOf(enc);
      [[scene, ENC_ORDER[(ei + 1) % ne]], [scene, ENC_ORDER[(ei + ne - 1) % ne]],
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
    ENC_ORDER.map(function (e) { return ENC_LABEL[M.encodings[e]] || M.encodings[e]; }),
    function () { return ENC_ORDER.indexOf(enc); },
    function (i) { select(scene, ENC_ORDER[i], nbi); });

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
     the powers of two they are rather than a bare 0-7 position.

     Each label is pinned to where the THUMB CENTRE actually lands, not to an
     even division of the track. A range input's thumb travels only
     (track - thumb) px, so evenly spaced labels drift away from the thumb
     towards both ends -- most visibly at 1 and 80. The CSS turns --i into
     calc(thumb/2 + (100% - thumb) * i/(n-1)). */
  var ticks = root.querySelector("[data-gal=ticks]");
  var last = M.nb.length - 1;
  M.nb.forEach(function (nb, i) {
    var el = document.createElement("span");
    el.textContent = nb;
    el.style.setProperty("--i", i);
    el.style.setProperty("--n", last);
    ticks.appendChild(el);
  });

  window.addEventListener("resize", layout);

  /* ---- start ------------------------------------------------------------ */

  function boot() {
    // Every frame-only strip named by a row, plus this cell's atlas.
    var strips = [];
    ROWS.forEach(function (row) {
      row.forEach(function (c) {
        if (c.strip && strips.indexOf(M[c.strip]) < 0) strips.push(M[c.strip]);
      });
    });
    Promise.all(strips.concat([sweepName(scene, enc)]).map(load))
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
