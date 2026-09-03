/* Synchronized, axes-free wide-harmonic guidance sweep.

   The two visible elements are real GIF images with the same source: one
   axes-free strip containing measurement | zeta 0.2 | ... | zeta 1.6.
   Selecting a zeta translates the right strip and never replaces its src, so
   both animations continue on the shared image-resource clock. */

(function () {
  "use strict";

  var root = document.getElementById("zeta-viewer");
  if (!root) return;

  var measurement = root.querySelector("[data-zeta=measurement]");
  var reconstruction = root.querySelector("[data-zeta=reconstruction]");
  var slider = root.querySelector("[data-zeta=slider]");
  var readout = root.querySelector("[data-zeta=readout]");
  var ticks = root.querySelector("[data-zeta=ticks]");
  var zetas = (root.dataset.zetas || "").split(",").filter(Boolean);
  var defaultIndex = Math.max(0, zetas.indexOf(root.dataset.defaultZeta));
  var started = false;
  var loaded = 0;

  if (!zetas.length) {
    root.classList.add("is-failed");
    return;
  }

  root.style.setProperty("--zeta-panels", zetas.length + 1);
  slider.min = 0;
  slider.max = zetas.length - 1;
  slider.step = 1;

  zetas.forEach(function (zeta, index) {
    var tick = document.createElement("span");
    tick.textContent = zeta;
    tick.style.setProperty("--i", index);
    tick.style.setProperty("--n", zetas.length - 1);
    ticks.appendChild(tick);
  });

  function setZeta(index) {
    index = Math.max(0, Math.min(zetas.length - 1, index | 0));
    var zeta = zetas[index];
    var panel = index + 1;
    slider.value = index;
    readout.innerHTML = "<i>&zeta;</i> = " + zeta;
    slider.setAttribute("aria-valuetext", "Guidance strength " + zeta);
    reconstruction.alt =
      "DPS and SeqDiff reconstruction at guidance strength " + zeta;
    reconstruction.style.transform =
      "translateX(" + (-100 * panel / (zetas.length + 1)) + "%)";
  }

  slider.addEventListener("input", function () {
    setZeta(Number(slider.value));
  });

  function load() {
    if (started) return;
    started = true;
    [measurement, reconstruction].forEach(function (image) {
      image.onload = function () {
        loaded += 1;
        if (loaded === 2) {
          root.classList.add("is-ready");
          slider.disabled = false;
        }
      };
      image.onerror = function () {
        root.classList.add("is-failed");
      };
    });
    /* Assign both copies in one task. They reference one cached image resource
       and begin together; later slider input never touches these values. */
    measurement.src = root.dataset.src;
    reconstruction.src = root.dataset.src;
  }

  setZeta(defaultIndex);

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
