/* Shared image cache and readiness indicators for the interactive results. */
(function () {
  "use strict";
  var entries = Object.create(null);
  var listeners = [];
  var scheduled = false;

  function notify() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(function () {
      scheduled = false;
      listeners.forEach(function (listener) { listener(); });
    });
  }

  function load(url, priority) {
    var existing = entries[url];
    if (existing && existing.state !== "error") {
      if (priority !== "low") existing.image.fetchPriority = "high";
      return existing.promise;
    }
    var image = new Image();
    image.decoding = "async";
    image.fetchPriority = priority || "high";
    var entry = { image: image, state: "loading" };
    entries[url] = entry;
    entry.promise = new Promise(function (resolve, reject) {
      function fail() {
        entry.state = "error";
        notify();
        reject(new Error("Could not load " + url));
      }
      image.onerror = fail;
      image.onload = function () {
        var decoded = image.decode ? image.decode() : Promise.resolve();
        decoded.then(function () {
          entry.state = "ready";
          notify();
          resolve(image);
        }, fail);
      };
      image.src = url;
    });
    notify();
    return entry.promise;
  }

  function state(urls) {
    if (!urls.length) return "unloaded";
    if (urls.every(function (url) { return entries[url] && entries[url].state === "ready"; })) return "ready";
    if (urls.some(function (url) { return entries[url] && entries[url].state === "error"; })) return "error";
    if (urls.some(function (url) { return entries[url] && entries[url].state === "loading"; })) return "loading";
    return "unloaded";
  }

  function mark(button, urls) {
    var value = state(urls);
    if (!button.dataset.readinessLabel) {
      button.dataset.readinessLabel = button.getAttribute("aria-label") || button.textContent.trim();
      button.classList.add("has-readiness");
    }
    if (button.dataset.readiness === value) return;
    button.dataset.readiness = value;
    var label = { ready: "Ready to view", loading: "Loading", error: "Select to retry", unloaded: "Loads when selected" }[value];
    button.title = label;
    button.setAttribute("aria-label", button.dataset.readinessLabel + ", " + label.toLowerCase());
  }

  function watch(root, update) {
    var status = document.createElement("span");
    status.className = "readiness-status sr-only";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.appendChild(status);
    function refresh() {
      var selected = state(update());
      root.setAttribute("aria-busy", selected === "loading" ? "true" : "false");
      var message = selected === "loading" ? "Loading example…" :
        selected === "error" ? "Could not load this example. Select it to retry." : "";
      if (status.textContent !== message) status.textContent = message;
    }
    listeners.push(refresh);
    refresh();
    return refresh;
  }

  window.RefocusAssets = { load: load, state: state, mark: mark, watch: watch };
})();
