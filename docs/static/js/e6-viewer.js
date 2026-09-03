/* E6 posterior ensemble viewer.
   Fifteen retained truth-scaled B-modes are selected from one 4x4 WebP
   atlas, so moving the slider is an immediate canvas blit. */

(function () {
  "use strict";

  var root = document.getElementById("e6");
  if (!root) return;

  var manifest = window.E6_MANIFEST;
  if (!manifest) {
    root.classList.add("is-failed");
    return;
  }

  var base = root.dataset.assets || "static/e6/";
  var canvas = root.querySelector("[data-e6=sample]");
  var slider = root.querySelector("[data-e6=slider]");
  var readout = root.querySelector("[data-e6=readout]");
  var context = canvas.getContext("2d");
  var tileWidth = manifest.tile[0];
  var tileHeight = manifest.tile[1];
  var count = manifest.samples.count;
  var columns = manifest.samples.cols;
  var atlasIndices = manifest.samples.atlas_indices || null;
  var atlas = new Image();
  var ready = false;
  var started = false;

  canvas.width = tileWidth;
  canvas.height = tileHeight;
  slider.min = 1;
  slider.max = count;
  slider.step = 1;
  slider.value = 1;

  function draw(sample) {
    sample = Math.max(1, Math.min(count, sample | 0));
    slider.value = sample;
    readout.textContent = sample + " / " + count;
    slider.setAttribute(
      "aria-valuetext",
      "Posterior sample " + sample + " of " + count
    );
    canvas.setAttribute(
      "aria-label",
      "Beamformed posterior sample " + sample + " of " + count
    );
    if (!ready) return;

    var index = atlasIndices ? atlasIndices[sample - 1] : sample - 1;
    var sourceX = (index % columns) * tileWidth;
    var sourceY = Math.floor(index / columns) * tileHeight;
    context.clearRect(0, 0, tileWidth, tileHeight);
    context.drawImage(
      atlas,
      sourceX,
      sourceY,
      tileWidth,
      tileHeight,
      0,
      0,
      tileWidth,
      tileHeight
    );
  }

  slider.addEventListener("input", function () {
    draw(Number(slider.value));
  });

  function load() {
    if (started) return;
    started = true;
    atlas.decoding = "async";
    atlas.onload = function () {
      ready = true;
      root.classList.add("is-ready");
      slider.disabled = false;
      draw(Number(slider.value));
    };
    atlas.onerror = function () {
      root.classList.add("is-failed");
    };
    atlas.src = base + manifest.samples.atlas;
  }

  draw(1);

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        if (entries.some(function (entry) { return entry.isIntersecting; })) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(root);
  } else {
    load();
  }
})();
