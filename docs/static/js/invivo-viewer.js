/* In-vivo cine grid.
   One card per recording, one animated WebP per card: the Nb-transmit
   measurements on the left half, the Bayesian REFoCUS chain on the right.
   They share a file because they have to play in step -- two animated images
   each start their own timeline when the browser first paints them, and
   nothing in HTML holds them together.

   Two chip groups. The first picks the transmit type, and the grid shows only
   the recordings of that type -- forty cards at once is a contact sheet rather
   than a comparison, and a reader is asking "what does this sequence look
   like", not "what do all eight look like at once". The second moves every
   visible card between transmit counts, densest first, so the reader opens on
   the easiest problem and takes transmits away.

   The shared image cache prefetches the next two modes and transmit counts.
   A readiness dot means every cine for that setting has loaded and decoded.
   The initial grid starts loading near the viewport or during the overview. */

(function () {
  "use strict";

  var root = document.getElementById("invivo-figure");
  if (!root) return;

  var manifest = window.INVIVO_MANIFEST;
  if (!manifest || !manifest.recordings || !manifest.recordings.length) {
    root.classList.add("is-failed");
    return;
  }

  var base = root.dataset.assets || "static/invivo/";
  var grid = root.querySelector("[data-iv=grid]");
  var chips = root.querySelector("[data-iv=nb]");
  var modeChips = root.querySelector("[data-iv=mode]");
  var counts = manifest.nb.slice();
  var modes = (manifest.modes || []).slice();
  var recorded = manifest.transmits_recorded || 80;
  var current = counts[0];
  var currentMode = manifest.default_mode ||
    (modes.length ? modes[0].mode : null);
  var cards = [];
  var assets = window.RefocusAssets;
  var started = false;

  function gridUrls(nb, mode) {
    return manifest.recordings.filter(function (record) { return record.mode === mode; })
      .map(function (record) { return record.nb[String(nb)]; })
      .filter(Boolean).map(function (name) { return base + name; });
  }

  function loadGrid(nb, mode, priority) {
    return Promise.all(gridUrls(nb, mode).map(function (url) { return assets.load(url, priority); }));
  }

  function prefetchNeighbours() {
    var ni = counts.indexOf(current);
    var mi = modes.map(function (mode) { return mode.mode; }).indexOf(currentMode);
    var neighbors = [];
    [ni + 1, ni + 2].filter(function (i) { return i < counts.length; })
      .forEach(function (i) { neighbors.push([counts[i], currentMode]); });
    [mi + 1, mi + 2].filter(function (i) { return i < modes.length; })
      .forEach(function (i) { neighbors.push([current, modes[i].mode]); });
    neighbors.forEach(function (pair) { loadGrid(pair[0], pair[1], "low").catch(function () {}); });
  }

  function ensure() {
    var nb = current, mode = currentMode;
    loadGrid(nb, mode).then(function () {
      if (nb !== current || mode !== currentMode) return;
      root.classList.remove("is-failed");
      cards.forEach(paint);
      prefetchNeighbours();
    }).catch(function () {
      if (nb === current && mode === currentMode) root.classList.add("is-failed");
    });
  }

  function build(record) {
    var card = document.createElement("figure");
    card.className = "iv-card";

    // The transmit type is the chip the reader just pressed, so the card
    // says only whose recording it is.
    var head = document.createElement("figcaption");
    head.className = "iv-card-head";
    head.textContent = record.subject;
    card.appendChild(head);

    /* Two labels over one image: the halves are exactly equal, so a plain
       two-column grid puts each over its own panel. */
    var labels = document.createElement("div");
    labels.className = "iv-labels";
    labels.innerHTML =
      '<span class="iv-panel-label">measurements</span>' +
      '<span class="iv-panel-label is-ours">Bayesian REFoCUS</span>';
    card.appendChild(labels);

    var frame = document.createElement("div");
    frame.className = "iv-frame";
    var img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.width = manifest.tile[0];
    img.height = manifest.tile[1];
    frame.appendChild(img);
    /* The comparison's whole point is one panel, so that panel is outlined
       rather than left to be found by reading labels -- the same accent rule
       the canvas panels above draw with strokeRect. */
    var outline = document.createElement("span");
    outline.className = "iv-ours-outline";
    outline.setAttribute("aria-hidden", "true");
    frame.appendChild(outline);
    card.appendChild(frame);
    grid.appendChild(card);

    var entry = { record: record, card: card, img: img };
    cards.push(entry);
    return entry;
  }

  function paint(entry) {
    var record = entry.record;
    if (currentMode && record.mode !== currentMode) {
      entry.card.hidden = true;
      return;
    }
    entry.card.hidden = false;
    var cine = record.nb[String(current)];
    entry.card.classList.toggle("is-absent", !cine);
    if (!cine) {
      entry.img.removeAttribute("src");
      entry.img.alt = "";
      return;
    }
    // Show the complete selected grid together after all its files have decoded.
    var loaded = assets.state(gridUrls(current, currentMode)) === "ready";
    entry.card.classList.toggle("is-loading", !loaded);
    if (loaded) {
      var url = base + cine;
      if (entry.img.getAttribute("src") !== url) entry.img.src = url;
    } else {
      entry.img.removeAttribute("src");
    }
    entry.img.alt =
      "Left, a B-mode of " + record.subject + ", " + record.label +
      ", from " + current + " of " + recorded + " transmits; right, the " +
      "Bayesian REFoCUS reconstruction of the same acquisition, both playing " +
      "as " + manifest.frames + "-frame cines";
  }

  function sync(group, values, currentValue) {
    group.forEach(function (button, index) {
      var on = values[index] === currentValue;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function select(nb, mode) {
    current = nb;
    currentMode = mode;
    cards.forEach(paint);
    sync(buttons, counts, current);
    sync(modeButtons, modes.map(function (m) { return m.mode; }), currentMode);
    if (refreshReadiness) refreshReadiness();
    if (started) ensure();
  }

  var buttons = counts.map(function (nb) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "iv-chip iv-chip-num";
    button.textContent = String(nb);
    button.setAttribute("aria-label", nb + " of " + recorded + " transmits");
    button.addEventListener("click", function () { select(nb, currentMode); });
    chips.appendChild(button);
    return button;
  });

  var modeButtons = modes.map(function (entry) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "iv-chip";
    button.textContent = entry.chip;
    button.setAttribute(
      "aria-label", entry.label + ", " + entry.count + " subject" +
      (entry.count === 1 ? "" : "s"));
    button.addEventListener("click", function () {
      select(current, entry.mode);
    });
    modeChips.appendChild(button);
    return button;
  });

  var refreshReadiness = assets.watch(root, function () {
    buttons.forEach(function (button, i) { assets.mark(button, gridUrls(counts[i], currentMode)); });
    modeButtons.forEach(function (button, i) { assets.mark(button, gridUrls(current, modes[i].mode)); });
    return gridUrls(current, currentMode);
  });

  function boot() {
    if (started) return;
    started = true;
    if (observer) observer.disconnect();
    ensure();
  }
  document.addEventListener("refocus:prefetch", boot, { once: true });

  manifest.recordings.forEach(build);
  select(current, currentMode);
  root.classList.add("is-ready");
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) boot();
    }, { rootMargin: "300px" });
    observer.observe(root);
  } else {
    boot();
  }
})();
