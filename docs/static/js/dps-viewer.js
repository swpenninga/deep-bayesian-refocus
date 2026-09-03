/* Bayesian REFoCUS - reverse-diffusion trajectory viewer.

   One slider position = one stored snapshot of x0_hat, the sampler's running
   estimate of the complete multistatic data set. Both panels are drawn from
   WebP sprite atlases (see data/echonetlvh/videos/dps_trajectory_web.py in the
   research repo): every frame of a stream lives in one image, so moving the
   slider is a canvas blit and never a request.

   Left  - every 10th transmit of the 80-transmit data set, stacked back to
           front the way the channel-data panels in the paper are drawn.
   Right - the retrospectively focused B-mode of that same estimate.

   The exported trajectory stops at t = 0.5, half the sampler's schedule
   (`--max-frames 51`): by then the estimate is at a steady state, and the
   frames after it are slider travel that shows nothing. `n_frames_full` in
   the manifest records how long the run actually was. */

(function () {
  "use strict";

  var root = document.getElementById("dps");
  if (!root) return;

  var M = window.DPS_MANIFEST;
  if (!M) { root.classList.add("is-failed"); return; }

  var BASE = root.dataset.assets || "static/dps/";
  var N = M.n_frames;

  var stackCv = root.querySelector("[data-dps=stack]");
  var bmodeCv = root.querySelector("[data-dps=bmode]");
  var slider = root.querySelector("[data-dps=slider]");
  var playBtn = root.querySelector("[data-dps=play]");
  var bars = root.querySelectorAll("[data-dps=bar]");

  var sctx = stackCv.getContext("2d");
  var bctx = bmodeCv.getContext("2d");

  /* ---- stack geometry ---------------------------------------------------
     Mirrors eval/utils/make_sim_figure.py: a tight up-and-right offset per
     slice, back-to-front, each card outlined so the one in front of it reads
     as a separate plane. CARD_AR squashes the 512x80 slice to something that
     fits beside a B-mode without becoming a hairline. */
  var CARD_AR = 2.8;      // card height / card width
  // RdBu_r puts WHITE at zero, so the white outline the grey envelope panels
  // used disappears into the card. Outline dark instead, on the card itself;
  // the card/background contrast carries the outer edge either way.
  var STROKE = M.slices.domain === "rf"
    ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.5)";
  var STEP_X = 0.30;      // per-slice offset, as a fraction of card width
  var STEP_Y = 0.075;     // ... and of card height
  var PAD = 26;
  var LABEL = 14;         // reserved above and below for the tx end labels

  // Frame 0 is the sampler's initial draw, so the slider opens on pure noise
  // at the left end and runs right into the converged estimate.
  var frame = 0;
  var playing = false;
  var ready = false;
  var raf = null, lastTick = 0;
  var FPS = 14;

  /* ---- asset loading --------------------------------------------------- */

  var images = {};

  function load(name) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.decoding = "async";
      im.onload = function () { images[name] = im; res(im); };
      im.onerror = function () { rej(new Error(name)); };
      im.src = BASE + name;
    });
  }

  function loadAll() {
    var names = M.bmode.atlases.concat(M.slices.atlases);
    var done = 0;
    return Promise.all(names.map(function (n) {
      return load(n).then(function (im) {
        done += 1;
        var pct = (100 * done / names.length).toFixed(1) + "%";
        bars.forEach(function (b) { b.style.width = pct; });
        return im;
      });
    }));
  }

  /* ---- atlas addressing ------------------------------------------------ */

  function bmodeSrc(i) {
    var cfg = M.bmode;
    var a = Math.floor(i / cfg.per_atlas), k = i % cfg.per_atlas;
    return [images[cfg.atlases[a]],
            (k % cfg.cols) * cfg.tile[0],
            Math.floor(k / cfg.cols) * cfg.tile[1]];
  }

  function sliceSrc(s, i) {
    var cfg = M.slices;
    return [images[cfg.atlases[s]],
            (i % cfg.cols) * cfg.tile[0],
            Math.floor(i / cfg.cols) * cfg.tile[1]];
  }

  /* ---- canvas sizing --------------------------------------------------- */

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
    var bw = bmodeCv.parentNode.clientWidth;
    var bh = Math.round(bw * M.bmode.tile[1] / M.bmode.tile[0]);
    fit(bmodeCv, bw, bh);

    // Side by side the two panels share a baseline; stacked on a narrow screen
    // the B-mode height would leave the slices swimming in black, so the stack
    // box falls back to its own natural aspect.
    var sw = stackCv.parentNode.clientWidth;
    var twoCol = window.matchMedia("(min-width: 821px)").matches;
    var sh = twoCol ? bh : Math.round(Math.min(bh, sw * 1.45 + 40));
    fit(stackCv, sw, sh);

    draw();
  }

  /* ---- drawing --------------------------------------------------------- */

  function drawBmode() {
    var w = bmodeCv.clientWidth, h = bmodeCv.clientHeight;
    bctx.clearRect(0, 0, w, h);
    if (!ready) return;
    var s = bmodeSrc(frame);
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(s[0], s[1], s[2], M.bmode.tile[0], M.bmode.tile[1],
                   0, 0, w, h);
  }

  function drawStack() {
    var w = stackCv.clientWidth, h = stackCv.clientHeight;
    sctx.clearRect(0, 0, w, h);
    if (!ready) return;

    var n = M.slices.tx.length;
    var availW = w - 2 * PAD, availH = h - 2 * PAD - 2 * LABEL;
    var spanX = 1 + (n - 1) * STEP_X;
    var spanY = (1 + (n - 1) * STEP_Y) * CARD_AR;
    var cardW = Math.min(availW / spanX, availH / spanY);
    var cardH = cardW * CARD_AR;
    var dx = cardW * STEP_X, dy = cardH * STEP_Y;

    var x0 = PAD + (availW - cardW * spanX) / 2;
    var y0 = PAD + LABEL + (availH - cardH * (1 + (n - 1) * STEP_Y)) / 2;

    sctx.imageSmoothingQuality = "high";
    // Back (upper right) to front, so each card hides the outline of the one
    // behind it exactly where it overlaps.
    for (var i = n - 1; i >= 0; i--) {
      var x = x0 + i * dx;
      var y = y0 + (n - 1 - i) * dy;
      var s = sliceSrc(i, frame);
      sctx.drawImage(s[0], s[1], s[2], M.slices.tile[0], M.slices.tile[1],
                     x, y, cardW, cardH);
      sctx.strokeStyle = STROKE;
      sctx.lineWidth = 1;
      sctx.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);
    }

    sctx.fillStyle = "rgba(154,160,168,0.9)";
    sctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    sctx.textAlign = "left";
    sctx.fillText("tx 0", x0, y0 + (n - 1) * dy + cardH + 13);
    sctx.textAlign = "right";
    sctx.fillText("tx " + M.slices.tx[n - 1], x0 + cardW * spanX, y0 - 5);
  }

  function draw() { drawBmode(); drawStack(); }

  /* ---- interaction ----------------------------------------------------- */

  function setFrame(i, fromSlider) {
    frame = Math.max(0, Math.min(N - 1, i | 0));
    if (!fromSlider) slider.value = frame;
    draw();
  }

  slider.addEventListener("input", function () {
    setFrame(+slider.value, true);
  });

  function tick(ts) {
    if (!playing) return;
    if (ts - lastTick >= 1000 / FPS) {
      lastTick = ts;
      if (frame >= N - 1) { stop(); return; }
      setFrame(frame + 1);
    }
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (frame >= N - 1) setFrame(0);
    playing = true;
    playBtn.classList.add("is-playing");
    playBtn.setAttribute("aria-label", "Pause");
    lastTick = 0;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    playing = false;
    playBtn.classList.remove("is-playing");
    playBtn.setAttribute("aria-label", "Play");
    if (raf) cancelAnimationFrame(raf);
  }

  playBtn.addEventListener("click", function () {
    if (playing) stop(); else play();
  });


  slider.addEventListener("pointerdown", stop);

  window.addEventListener("resize", layout);

  /* ---- start ----------------------------------------------------------- */

  function boot() {
    loadAll().then(function () {
      ready = true;
      root.classList.add("is-ready");
      slider.disabled = false;
      playBtn.disabled = false;
      layout();
    }).catch(function () {
      root.classList.add("is-failed");
    });
  }

  slider.max = N - 1;
  slider.value = frame;
  layout();

  // 5 MB of atlases is not worth fetching for a reader who never scrolls this
  // far, so the viewer arms itself the first time it comes into view.
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
