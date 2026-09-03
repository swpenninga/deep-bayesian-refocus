/* Synchronized wide-harmonic zeta sweep.

   The source GIF already contains the measurement and every reconstruction in
   one frame. Both visible canvases are cropped from that same HTMLImageElement
   during the same draw call. Moving the slider changes only a crop index: it
   never assigns src again, so playback cannot restart or drift. */

(function () {
  "use strict";

  var root = document.getElementById("zeta-viewer");
  if (!root) return;

  var source = root.querySelector("[data-zeta=source]");
  var measurement = root.querySelector("[data-zeta=measurement]");
  var reconstruction = root.querySelector("[data-zeta=reconstruction]");
  var slider = root.querySelector("[data-zeta=slider]");
  var readout = root.querySelector("[data-zeta=readout]");
  var ticks = root.querySelector("[data-zeta=ticks]");

  var zetas = (root.dataset.zetas || "").split(",").filter(Boolean);
  var panelCount = Number(root.dataset.panels);
  var panelBoundaries = (root.dataset.panelBoundaries || "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  var measurementPanel = Number(root.dataset.measurementPanel);
  var firstZetaPanel = Number(root.dataset.firstZetaPanel);
  var selected = 0;
  var ready = false;
  var started = false;
  var visible = false;
  var animationFrame = null;
  var previousTick = 0;
  var DRAW_INTERVAL_MS = 40;

  if (!zetas.length || !Number.isInteger(panelCount) || panelCount < 1 ||
      panelBoundaries.length !== panelCount + 1 ||
      panelBoundaries.some(function (value) { return !Number.isFinite(value); })) {
    root.classList.add("is-failed");
    return;
  }

  slider.min = 0;
  slider.max = zetas.length - 1;
  slider.step = 1;
  slider.value = selected;

  zetas.forEach(function (zeta, index) {
    var tick = document.createElement("span");
    tick.textContent = zeta;
    tick.style.setProperty("--i", index);
    tick.style.setProperty("--n", zetas.length - 1);
    ticks.appendChild(tick);
  });

  function panelBounds(index) {
    /* Constrained-layout leaves a larger outer margin and narrow, unequal
       gutters. These boundaries are measured midway between the axes in the
       exported GIF; equal-width tenths would leak a neighbor into each crop. */
    var left = panelBoundaries[index];
    var right = panelBoundaries[index + 1];
    return [left, right - left];
  }

  function drawPanel(canvas, panel) {
    var bounds = panelBounds(panel);
    var width = bounds[1];
    var height = source.naturalHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    var context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.drawImage(
      source,
      bounds[0], 0, width, height,
      0, 0, width, height
    );
  }

  function draw() {
    if (!ready) return;
    /* Deliberately adjacent: both crops observe the same decoded GIF frame. */
    drawPanel(measurement, measurementPanel);
    drawPanel(reconstruction, firstZetaPanel + selected);
  }

  function setZeta(index) {
    selected = Math.max(0, Math.min(zetas.length - 1, index | 0));
    var zeta = zetas[selected];
    slider.value = selected;
    readout.innerHTML = "<i>&zeta;</i> = " + zeta;
    slider.setAttribute("aria-valuetext", "Guidance strength " + zeta);
    reconstruction.setAttribute(
      "aria-label",
      "DPS and SeqDiff reconstruction at guidance strength " + zeta
    );
    draw();
  }

  slider.addEventListener("input", function () {
    setZeta(Number(slider.value));
  });

  function tick(timestamp) {
    animationFrame = null;
    if (!visible || !ready) return;
    if (timestamp - previousTick >= DRAW_INTERVAL_MS) {
      previousTick = timestamp;
      draw();
    }
    animationFrame = requestAnimationFrame(tick);
  }

  function animate() {
    if (ready && visible && animationFrame === null) {
      previousTick = 0;
      animationFrame = requestAnimationFrame(tick);
    }
  }

  function pause() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function load() {
    if (started) return;
    started = true;
    source.decoding = "async";
    source.onload = function () {
      ready = true;
      root.classList.add("is-ready");
      slider.disabled = false;
      setZeta(selected);
      animate();
    };
    source.onerror = function () {
      root.classList.add("is-failed");
    };
    source.src = root.dataset.src;
  }

  setZeta(selected);

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        visible = entries.some(function (entry) { return entry.isIntersecting; });
        if (visible) {
          load();
          animate();
        } else {
          pause();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(root);
  } else {
    visible = true;
    load();
  }
})();
