(function () {
  "use strict";

  var root = document.getElementById("noise");
  if (!root) return;

  var M = window.E3_MANIFEST;
  if (!M) { root.classList.add("is-failed"); return; }

  var BASE = root.dataset.assets || "static/noise/";
  var TW = M.tile[0], TH = M.tile[1];

  var COLS = [
    { key: "truth", strip: "truth", label: "multistatic data set" },
    { key: "dps", method: "dps", label: "Bayesian REFoCUS", ours: true },
    { key: "adjoint", method: "adjoint", label: "measurements" }
  ];

  var ENC_LABEL = { focused: "focused", hadamard: "hadamard" };

  var SUP_A = 1190.1, SUP_B = 983.1, KEEP = 0.965;
  var _cr = M.crop, _src = M.source_shape;
  var _sx = TW / (_cr[3] - _cr[2]), _sy = TH / (_cr[1] - _cr[0]);
  var SUP_CX = (_src[1] / 2 - _cr[2]) * _sx;
  var SUP_CY = -_cr[0] * _sy;

  var SUP_RX = SUP_A * KEEP * _sx;
  var SUP_RY = SUP_B * KEEP * _sy;

  var TH_SHOWN = Math.min(TH, Math.ceil(SUP_CY + SUP_RY) + 1);
  var sX = 1, sY = 1;

  var NBI = 0;

  var GAP = 3;
  var GAP_Y = 4;
  var LABEL_H = 25;

  var GUTTER = M.encodings.length > 1 ? 20 : 0;
  var FAINT = "#a4adb9", MUTED = "#9aa0a8";
  var ACCENT = "#7dd3fc", ACCENT_DIM = "#426b85";
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  var HEADLINE_SNR = 10;

  function snrLabel(v) { return v === null ? "clean" : String(v); }

  var scene = 0;
  var snri = Math.max(0, M.snr.indexOf(HEADLINE_SNR));
  var ready = false;
  var drawW = 0, drawH = 0;

  var assets = window.RefocusAssets;
  var images = {};

  function load(name, priority) {
    return assets.load(BASE + name, priority).then(function (image) {
      images[name] = image;
      return image;
    });
  }

  function sweepName(s) { return M.sweeps[s * M.nb.length + NBI]; }

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

    var budgetH = Math.max(200, window.innerHeight - ctlH - 150);

    if (narrow) budgetH = Infinity;
    var scale = Math.min(
      (availW - GUTTER - (ncol - 1) * GAP) / ncol / TW,
      (budgetH - LABEL_H - (nrow - 1) * GAP_Y) / nrow / TH_SHOWN);

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

  function draw() {
    var cssW = parseFloat(cv.style.width), cssH = parseFloat(cv.style.height);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!ready) return;

    var fs = Math.max(10, Math.min(12, Math.round(drawW / 22)));
    ctx.font = fs + "px " + MONO;
    ctx.textBaseline = "alphabetic";
    ctx.imageSmoothingQuality = "high";

    ctx.textAlign = "left";
    if (!narrow) COLS.forEach(function (col, c) {
      ctx.fillStyle = col.ours ? ACCENT : FAINT;
      ctx.fillText(col.label.toUpperCase(),
                   GUTTER + c * (drawW + GAP), LABEL_H - 5);
    });

    M.encodings.forEach(function (enc, r) {
      var rowY = LABEL_H + r * (drawH + GAP_Y);

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

        if (col.ours) {
          ctx.strokeStyle = ACCENT_DIM;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, drawW - 1, drawH - 1);
        }
      });
    });
  }

  var snrOut = root.querySelector("[data-noise=snrout]");

  function readout() {
    var snr = M.snr[snri];
    root.style.setProperty("--range-progress", (100 * snri / Math.max(1, M.snr.length - 1)) + "%");
    snrOut.textContent = snr === null ? "noiseless" : snr + " dB";
  }

  function ensure() {
    var want = sweepName(scene);
    load(want).then(function () {
      if (sweepName(scene) !== want) return;
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
