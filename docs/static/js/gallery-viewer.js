(function () {
  "use strict";

  var root = document.getElementById("gallery");
  if (!root) return;

  var M = window.E2_MANIFEST;
  if (!M) { root.classList.add("is-failed"); return; }

  var BASE = root.dataset.assets || "static/gallery/";
  var TW = M.tile[0], TH = M.tile[1];

  var ROWS = [
    [{ key: "truth", strip: "truth", label: "multistatic data set" },
     { key: "dps", method: "dps", label: "Bayesian REFoCUS", ours: true },
     { key: "adjoint", method: "adjoint", label: "measurements" }]
  ];
  var NCOL = Math.max.apply(null, ROWS.map(function (r) { return r.length; }));

  var ENC_LABEL = {
    focused: "focused", diverging: "diverging", wide: "wide",
    pw: "plane wave", hadamard: "hadamard", random: "random"
  };

  var ENC_ORDER = ["focused", "wide", "pw", "diverging", "hadamard", "random"]
    .filter(function (e) { return M.encodings.indexOf(e) >= 0; })
    .concat(M.encodings.filter(function (e) {
      return ["focused", "wide", "pw", "diverging", "hadamard", "random"]
        .indexOf(e) < 0;
    }))
    .map(function (e) { return M.encodings.indexOf(e); });

  var SUP_A = 1190.1, SUP_B = 983.1, KEEP = 0.965;
  var _cr = M.crop, _src = M.source_shape;
  var _sx = TW / (_cr[3] - _cr[2]), _sy = TH / (_cr[1] - _cr[0]);
  var SUP_CX = (_src[1] / 2 - _cr[2]) * _sx;
  var SUP_CY = -_cr[0] * _sy;

  var SUP_RX = SUP_A * KEEP * _sx;
  var SUP_RY = SUP_B * KEEP * _sy;

  var TH_SHOWN = Math.min(TH, Math.ceil(SUP_CY + SUP_RY) + 1);
  var sX = 1, sY = 1;

  var GAP = 3;
  var GAP_Y = 12;

  var LABEL_H = 25;
  var FAINT = "#a4adb9", ACCENT = "#7dd3fc", ACCENT_DIM = "#426b85";
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  var OPEN_NB = 16;

  var OPEN_ENC = "pw";
  var scene = 0;
  var enc = Math.max(0, M.encodings.indexOf(OPEN_ENC));
  var nbi = M.nb.indexOf(OPEN_NB);
  if (nbi < 0) nbi = M.nb.length - 1;
  var ready = false;
  var rows = ROWS.length, drawW = 0, drawH = 0;

  var assets = window.RefocusAssets;
  var images = {};

  function load(name, priority) {
    return assets.load(BASE + name, priority).then(function (image) {
      images[name] = image;
      return image;
    });
  }

  function sweepName(s, e) { return M.sweeps[s * M.encodings.length + e]; }

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

  var displayRows = ROWS;
  var stage = root.querySelector("[data-gal=stage]");
  var controls = root.querySelector(".gal-controls");
  var cv = root.querySelector("[data-gal=sheet]");
  var ctx = cv.getContext("2d");

  function layout() {
    var stageStyle = getComputedStyle(stage);
    var availW = (stage.clientWidth || root.clientWidth)
      - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
    var ctlH = controls ? controls.getBoundingClientRect().height : 0;

    var budgetH = Math.max(200, window.innerHeight - ctlH - 150);

    var narrow = stage.clientWidth < 560;
    displayRows = narrow ? ROWS.reduce(function (all, row) {
      return all.concat(row.map(function (col) { return [col]; }));
    }, []) : ROWS;
    NCOL = Math.max.apply(null, displayRows.map(function (row) { return row.length; }));
    rows = displayRows.length;
    if (narrow) budgetH = Infinity;

    var scale = Math.min((availW - (NCOL - 1) * GAP) / NCOL / TW,
                         ((budgetH - (rows - 1) * GAP_Y) / rows - LABEL_H) / TH_SHOWN);

    scale = Math.min(scale, 1);
    drawW = Math.max(1, Math.floor(TW * scale));
    drawH = Math.max(1, Math.floor(TH_SHOWN * scale));
    sX = drawW / TW;
    sY = drawH / TH_SHOWN;

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

  function draw() {
    var cssW = parseFloat(cv.style.width), cssH = parseFloat(cv.style.height);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!ready) return;

    var fs = Math.max(10, Math.min(12, Math.round(drawW / 22)));
    ctx.font = fs + "px " + MONO;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.imageSmoothingQuality = "high";

    var full = NCOL * drawW + (NCOL - 1) * GAP;
    displayRows.forEach(function (row, r) {

      var rowW = row.length * drawW + (row.length - 1) * GAP;
      var x0 = Math.round((full - rowW) / 2);
      var y = r * (drawH + LABEL_H + GAP_Y);

      row.forEach(function (col, i) {
        var s = sourceFor(col);
        var x = x0 + i * (drawW + GAP);

        ctx.fillStyle = col.ours ? ACCENT : FAINT;
        ctx.fillText(col.label.toUpperCase(), x, y + LABEL_H - 5);

        if (!s) return;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x + SUP_CX * sX, y + LABEL_H + SUP_CY * sY,
                    SUP_RX * sX, SUP_RY * sY, 0, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(s[0], s[1], s[2], TW, TH_SHOWN, x, y + LABEL_H, drawW, drawH);
        ctx.restore();

        if (col.ours) {
          ctx.strokeStyle = ACCENT_DIM;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + LABEL_H + 0.5, drawW - 1, drawH - 1);
        }
      });
    });
  }

  var nbOut = root.querySelector("[data-gal=nbout]");
  var pctOut = root.querySelector("[data-gal=pct]");

  function readout() {
    var nb = M.nb[nbi];
    nbOut.textContent = nb;
    root.style.setProperty("--range-progress", (100 * nbi / Math.max(1, M.nb.length - 1)) + "%");
    root.querySelector("[data-gal=nb]").setAttribute("aria-valuetext", nb + " of " + M.n_tx_total + " transmits");
    pctOut.textContent = (100 * nb / M.n_tx_total).toFixed(
      nb * 100 % M.n_tx_total === 0 ? 0 : 1) + "% of a full acquisition";
  }

  function ensure() {
    var want = sweepName(scene, enc);
    load(want).then(function () {
      if (sweepName(scene, enc) !== want) return;
      root.classList.remove("is-busy", "is-failed");
      draw();
      var ne = ENC_ORDER.length, ns = M.frames.length;
      var ei = ENC_ORDER.indexOf(enc);
      [[scene, ei + 1 < ne ? ENC_ORDER[ei + 1] : null],
       [scene, ei + 2 < ne ? ENC_ORDER[ei + 2] : null],
       [scene + 1 < ns ? scene + 1 : null, enc],
       [scene + 2 < ns ? scene + 2 : null, enc]]
        .filter(function (c) { return c[0] !== null && c[1] !== null; })
        .forEach(function (c) { load(sweepName(c[0], c[1]), "low").catch(function () {}); });
    }).catch(function () {
      if (sweepName(scene, enc) === want) root.classList.add("is-failed");
    });
    if (!images[want]) root.classList.add("is-busy");
  }

  function select(s, e, n) {
    var moved = (s !== scene || e !== enc);
    scene = s; enc = e; nbi = n;
    readout();
    if (refreshReadiness) refreshReadiness();
    if (moved || !images[sweepName(scene, enc)]) ensure(); else draw();
  }

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

  function cellUrls(s, e) {
    return [BASE + M.truth, BASE + sweepName(s, e)];
  }
  var refreshReadiness = assets.watch(root, function () {
    root.querySelectorAll("[data-gal=scene] button").forEach(function (button, i) {
      assets.mark(button, cellUrls(i, enc));
    });
    root.querySelectorAll("[data-gal=enc] button").forEach(function (button, i) {
      assets.mark(button, cellUrls(scene, ENC_ORDER[i]));
    });
    return cellUrls(scene, enc);
  });

  var nbSlider = root.querySelector("[data-gal=nb]");
  nbSlider.max = M.nb.length - 1;
  nbSlider.value = nbi;
  nbSlider.addEventListener("input", function () {
    select(scene, enc, +nbSlider.value);
  });

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

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    if (io) io.disconnect();

    var strips = [];
    ROWS.forEach(function (row) {
      row.forEach(function (c) {
        if (c.strip && strips.indexOf(M[c.strip]) < 0) strips.push(M[c.strip]);
      });
    });
    Promise.all(strips.concat([sweepName(scene, enc)]).map(function (name) { return load(name); }))
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
