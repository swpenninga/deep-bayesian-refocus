/* Bayesian REFoCUS - reverse-diffusion trajectory viewer.

   One slider position = one stored snapshot of x0_hat, the sampler's running
   estimate of the complete multistatic data set. Both panels are drawn from
   WebP sprite atlases (see data/echonetlvh/videos/dps_trajectory_web.py in the
   research repo): every frame of a stream lives in one image, so moving the
   slider is a canvas blit and never a request.

   Left  - every 10th transmit of the 80-transmit data set, stacked back to
           front the way the channel-data panels in the paper are drawn.
   Right - the retrospectively focused B-mode of that same estimate. */

(function () {
  "use strict";

  var root = document.getElementById("dps");
  if (!root) return;

  var M = window.DPS_MANIFEST;
  if (!M) { root.classList.add("is-failed"); return; }

  var BASE = root.dataset.assets || "static/dps/";
  var N = M.n_frames;
  var TR = M.trajectory;

  var stackCv = root.querySelector("[data-dps=stack]");
  var bmodeCv = root.querySelector("[data-dps=bmode]");
  var sparkCv = root.querySelector("[data-dps=spark]");
  var slider = root.querySelector("[data-dps=slider]");
  var playBtn = root.querySelector("[data-dps=play]");
  var truthBox = root.querySelector("[data-dps=truth]");
  var bars = root.querySelectorAll("[data-dps=bar]");
  var readouts = {};
  root.querySelectorAll("[data-out]").forEach(function (el) {
    readouts[el.dataset.out] = el;
  });

  var sctx = stackCv.getContext("2d");
  var bctx = bmodeCv.getContext("2d");
  var kctx = sparkCv.getContext("2d");

  /* ---- stack geometry ---------------------------------------------------
     Mirrors eval/utils/make_sim_figure.py: a tight up-and-right offset per
     slice, back-to-front, each card outlined so the one in front of it reads
     as a separate plane. CARD_AR squashes the 512x80 slice to something that
     fits beside a B-mode without becoming a hairline. */
  var CARD_AR = 2.8;      // card height / card width
  var STEP_X = 0.30;      // per-slice offset, as a fraction of card width
  var STEP_Y = 0.075;     // ... and of card height
  var PAD = 26;
  var LABEL = 14;         // reserved above and below for the tx end labels

  var frame = N - 1;
  var playing = false;
  var showTruth = false;
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
    var names = M.bmode.atlases.concat([M.bmode.truth],
                                       M.slices.atlases, [M.slices.truth]);
    var done = 0;
    root.classList.add("is-loading");
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
    if (showTruth) return [images[M.bmode.truth], 0, 0];
    var cfg = M.bmode;
    var a = Math.floor(i / cfg.per_atlas), k = i % cfg.per_atlas;
    return [images[cfg.atlases[a]],
            (k % cfg.cols) * cfg.tile[0],
            Math.floor(k / cfg.cols) * cfg.tile[1]];
  }

  function sliceSrc(s, i) {
    var cfg = M.slices;
    if (showTruth) return [images[cfg.truth], s * cfg.tile[0], 0];
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

    fit(sparkCv, sparkCv.parentNode.clientWidth, 46);
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
      sctx.strokeStyle = "rgba(255,255,255,0.5)";
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

  function drawSpark() {
    var w = sparkCv.clientWidth, h = sparkCv.clientHeight;
    kctx.clearRect(0, 0, w, h);
    var y = TR.nmse_db, lo = Math.min.apply(null, y), hi = Math.max.apply(null, y);
    var px = function (i) { return (i / (N - 1)) * (w - 2) + 1; };
    var py = function (v) { return h - 4 - ((v - lo) / (hi - lo)) * (h - 10); };

    kctx.beginPath();
    kctx.moveTo(px(0), h);
    for (var i = 0; i < N; i++) kctx.lineTo(px(i), py(y[i]));
    kctx.lineTo(px(N - 1), h);
    kctx.closePath();
    kctx.fillStyle = "rgba(125,211,252,0.10)";
    kctx.fill();

    kctx.beginPath();
    for (i = 0; i < N; i++) {
      if (i === 0) kctx.moveTo(px(i), py(y[i])); else kctx.lineTo(px(i), py(y[i]));
    }
    kctx.strokeStyle = "#7dd3fc";
    kctx.lineWidth = 1.4;
    kctx.stroke();

    kctx.beginPath();
    kctx.arc(px(frame), py(y[frame]), 3.2, 0, 6.2832);
    kctx.fillStyle = showTruth ? "#6b7280" : "#e8e9ec";
    kctx.fill();
  }

  function fmt(v, d) { return (v >= 0 ? "" : "−") + Math.abs(v).toFixed(d); }

  function drawReadouts() {
    var t = showTruth;
    if (readouts.step) readouts.step.textContent = t ? "—" : TR.step[frame];
    if (readouts.t) readouts.t.textContent = t ? "—" : TR.t[frame].toFixed(2);
    if (readouts.nmse) readouts.nmse.textContent =
      t ? "—" : fmt(TR.nmse_db[frame], 1);
    if (readouts.corr) readouts.corr.textContent =
      t ? "—" : TR.complex_corr[frame].toFixed(3);
    if (readouts.psnr) readouts.psnr.textContent =
      t ? "—" : fmt(TR.psnr_db[frame], 1);
    root.classList.toggle("is-truth", t);
  }

  function draw() { drawBmode(); drawStack(); drawSpark(); drawReadouts(); }

  /* ---- interaction ----------------------------------------------------- */

  function setFrame(i, fromSlider) {
    frame = Math.max(0, Math.min(N - 1, i | 0));
    if (!fromSlider) slider.value = frame;
    draw();
  }

  slider.addEventListener("input", function () {
    if (showTruth) { truthBox.checked = false; showTruth = false; }
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
    if (showTruth) { truthBox.checked = false; showTruth = false; }
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

  truthBox.addEventListener("change", function () {
    showTruth = truthBox.checked;
    if (showTruth) stop();
    draw();
  });

  sparkCv.addEventListener("pointerdown", function (e) {
    sparkCv.setPointerCapture(e.pointerId);
    scrubSpark(e);
  });
  sparkCv.addEventListener("pointermove", function (e) {
    if (e.buttons) scrubSpark(e);
  });
  function scrubSpark(e) {
    stop();
    if (showTruth) { truthBox.checked = false; showTruth = false; }
    var r = sparkCv.getBoundingClientRect();
    setFrame(Math.round(((e.clientX - r.left) / r.width) * (N - 1)));
  }

  slider.addEventListener("pointerdown", stop);

  window.addEventListener("resize", layout);

  /* ---- start ----------------------------------------------------------- */

  function boot() {
    loadAll().then(function () {
      ready = true;
      root.classList.remove("is-loading");
      root.classList.add("is-ready");
      slider.disabled = false;
      playBtn.disabled = false;
      truthBox.disabled = false;
      layout();
    }).catch(function () {
      root.classList.remove("is-loading");
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
