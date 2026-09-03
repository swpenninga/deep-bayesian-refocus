/* Bayesian REFoCUS - recovery gallery.

   One row of six B-modes of the same scene: the ground truth, the two things
   that go in, and the three decodes of the encoded acquisition. Three controls
   move through the E2 grid -- scene, transmit encoding, and the number of
   transmits Nb.

   Assets are WebP sprite atlases (see eval/visualizations/e2_gallery_web.py in
   the research repo). One atlas holds every Nb of every method for one
   (scene, encoding) pair, so dragging the Nb slider is a canvas blit and never
   a request; only scene and encoding fetch, and the neighbours of the current
   cell are prefetched so those rarely stall either.

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

  var scene = 0, enc = 0, nbi = M.nb.length - 1;   // open at full Nb: the
                                                   // agreement everyone expects,
                                                   // so the slider moves AWAY
                                                   // from it into the sparse
                                                   // regime that is the point.
  var ready = false;

  /* ---- asset loading ----------------------------------------------------
     Only the strips are required to boot. Sweep atlases are fetched per cell
     and memoized; 60 of them is ~17 MB, which is not a page load. */

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

  function stripTile(im, s) { return [im, s * TW, 0]; }

  function sourceFor(col) {
    if (col.strip) {
      var im = images[M[col.strip]];
      return im ? stripTile(im, scene) : null;
    }
    var sw = images[sweepName(scene, enc)];
    return sw ? sweepTile(sw, col.method) : null;
  }

  /* ---- DOM -------------------------------------------------------------- */

  var stage = root.querySelector("[data-gal=stage]");
  var canvases = [];

  /* The label goes ABOVE the image, not over it: these are column headers,
     and near-field speckle sits exactly where an overlaid tag would land. */
  COLUMNS.forEach(function (col) {
    var wrap = document.createElement("div");
    wrap.className = "gal-col" + (col.ours ? " is-ours" : "");
    var head = document.createElement("span");
    head.className = "gal-colhead";
    head.textContent = col.label;
    var fig = document.createElement("div");
    fig.className = "gal-panel";
    var cv = document.createElement("canvas");
    fig.appendChild(cv);
    wrap.appendChild(head);
    wrap.appendChild(fig);
    stage.appendChild(wrap);
    canvases.push(cv);
  });

  /* ---- canvas sizing ---------------------------------------------------- */

  function fit(cv, cssW, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.style.height = cssH + "px";
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function layout() {
    canvases.forEach(function (cv) {
      var w = cv.parentNode.clientWidth;
      fit(cv, w, Math.round(w * TH / TW));
    });
    draw();
  }

  /* ---- drawing ---------------------------------------------------------- */

  function draw() {
    COLUMNS.forEach(function (col, i) {
      var cv = canvases[i];
      var ctx = cv.getContext("2d");
      var w = cv.clientWidth, h = cv.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (!ready) return;
      var s = sourceFor(col);
      if (!s) return;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(s[0], s[1], s[2], TW, TH, 0, 0, w, h);
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
  function ensure(then) {
    var want = sweepName(scene, enc);
    load(want).then(function () {
      if (sweepName(scene, enc) !== want) return;   // moved on while loading
      root.classList.remove("is-busy");
      if (then) then();
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
