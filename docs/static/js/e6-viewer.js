(function () {
  "use strict";

  var root = document.getElementById("e6");
  if (!root) return;

  var M = window.E6_MANIFEST;
  if (!M || !M.modes || !M.modes.length) {
    root.classList.add("is-failed");
    return;
  }

  var BASE = root.dataset.assets || "static/e6/";
  var TW = M.tile[0], TH = M.tile[1];
  var COUNT = M.samples.count;
  var COLS = M.samples.cols;

  var canvas = root.querySelector("[data-e6=sample]");
  var context = canvas.getContext("2d");
  var slider = root.querySelector("[data-e6=slider]");
  var readout = root.querySelector("[data-e6=readout]");
  var measure = root.querySelector("[data-e6=measurement]");
  var measureLabel = root.querySelector("[data-e6=measurement-label]");
  var residual = root.querySelector("[data-e6=residual]");
  var spread = root.querySelector("[data-e6=spread]");

  canvas.width = TW;
  canvas.height = TH;
  slider.min = 1;
  slider.max = COUNT;
  slider.step = 1;

  var mode = Math.max(0, M.modes.findIndex(function (m) {
    return m.id === M.default_example;
  }));
  var sample = 1;
  var bundles = {};
  var syncChips;

  function names(m) {
    return [m.measurement, m.atlas, m.residual, m.spread];
  }

  var assets = window.RefocusAssets;
  var pending = {};
  function load(index, done) {
    var m = M.modes[index];
    if (bundles[m.id] && bundles[m.id] !== "failed") {
      if (done) done(bundles[m.id]);
      return;
    }

    if (!pending[m.id]) {
      pending[m.id] = Promise.all(names(m).map(function (name) {
        return assets.load(BASE + name, done ? "high" : "low");
      })).then(function (images) {
        bundles[m.id] = { measurement: images[0], atlas: images[1], residual: images[2], spread: images[3] };
        delete pending[m.id];
        return bundles[m.id];
      }, function () {
        bundles[m.id] = "failed";
        delete pending[m.id];
        return "failed";
      });
    } else if (done) {
      names(m).forEach(function (name) { assets.load(BASE + name).catch(function () {}); });
    }
    if (done) pending[m.id].then(done);
  }

  function drawSample() {
    var m = M.modes[mode];
    var bundle = bundles[m.id];
    slider.value = sample;
    root.style.setProperty(
      "--range-progress",
      (100 * (sample - 1) / Math.max(1, COUNT - 1)) + "%");
    readout.textContent = sample + " / " + COUNT;
    slider.setAttribute(
      "aria-valuetext", "Posterior sample " + sample + " of " + COUNT);
    canvas.setAttribute(
      "aria-label",
      "Beamformed posterior sample " + sample + " of " + COUNT
      + ", " + m.measurement_label);
    if (!bundle || bundle === "failed") return;

    var index = sample - 1;
    context.clearRect(0, 0, TW, TH);
    context.drawImage(
      bundle.atlas,
      (index % COLS) * TW, Math.floor(index / COLS) * TH, TW, TH,
      0, 0, TW, TH);
  }

  function paint() {
    var m = M.modes[mode];
    var bundle = bundles[m.id];
    if (bundle === "failed") {
      root.classList.remove("is-ready");
      root.classList.add("is-failed");
      return;
    }

    measure.src = BASE + m.measurement;
    residual.src = BASE + m.residual;
    spread.src = BASE + m.spread;
    measureLabel.textContent = m.measurement_label;
    measure.alt = "B-mode formed directly from the " + m.measurement_label;
    residual.alt = "Beamformed loss between the posterior mean and the "
      + "multistatic ground truth, " + m.measurement_label;
    spread.alt = "Beamformed posterior variance, " + m.measurement_label;
    root.classList.remove("is-failed");
    root.classList.add("is-ready");
    slider.disabled = false;
    drawSample();
  }

  function prefetchNeighbours() {
    var n = M.modes.length;
    [mode + 1, mode + 2].filter(function (i) { return i < n; }).forEach(function (i) {
      load(i, null);
    });
  }

  function select(index) {
    if (index === mode && bundles[M.modes[index].id] && bundles[M.modes[index].id] !== "failed") return;
    mode = index;
    if (syncChips) syncChips();
    if (refreshReadiness) refreshReadiness();
    var want = M.modes[mode].id;
    if (bundles[want] && bundles[want] !== "failed") {
      paint();
      prefetchNeighbours();
      return;
    }
    root.classList.remove("is-ready");
    load(mode, function () {
      if (M.modes[mode].id !== want) return;
      paint();
      prefetchNeighbours();
    });
  }

  function buttonGroup(host, labels, get, set) {
    var buttons = labels.map(function (text, i) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "e6-chip";
      button.textContent = text;
      button.addEventListener("click", function () { set(i); });
      host.appendChild(button);
      return button;
    });
    function sync() {
      buttons.forEach(function (button, i) {
        var on = i === get();
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    sync();
    return sync;
  }

  syncChips = buttonGroup(
    root.querySelector("[data-e6=mode]"),
    M.modes.map(function (m, i) { return m.label || String(i + 1); }),
    function () { return mode; },
    select);

  function exampleUrls(index) {
    return names(M.modes[index]).map(function (name) { return BASE + name; });
  }
  var refreshReadiness = assets.watch(root, function () {
    root.querySelectorAll("[data-e6=mode] button").forEach(function (button, i) {
      assets.mark(button, exampleUrls(i));
    });
    return exampleUrls(mode);
  });

  slider.addEventListener("input", function () {
    sample = Math.max(1, Math.min(COUNT, Number(slider.value) | 0));
    drawSample();
  });

  drawSample();

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    if (observer) observer.disconnect();
    select(mode);
  }
  document.addEventListener("refocus:prefetch", boot, { once: true });

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        if (entries.some(function (entry) { return entry.isIntersecting; })) {
          observer.disconnect();
          boot();
        }
      },
      { rootMargin: "300px" });
    observer.observe(root);
  } else {
    boot();
  }
})();
