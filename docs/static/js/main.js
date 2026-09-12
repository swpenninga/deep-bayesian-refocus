/* Bayesian REFoCUS - project page */

// Copy the BibTeX block.
document.querySelectorAll("[data-copy]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var target = document.querySelector(btn.dataset.copy);
    if (!target) return;
    navigator.clipboard.writeText(target.textContent.trim()).then(function () {
      var original = btn.textContent;
      btn.textContent = "copied";
      setTimeout(function () { btn.textContent = original; }, 1500);
    });
  });
});

// Buffer the overview without starting playback. Until it starts, a quiet play
// arrow over the first frame stands in for the native controls, so touch
// browsers don't draw their own play button beneath it. The HTML keeps
// `controls` as the fallback if JavaScript is disabled.
(function () {
  var video = document.getElementById("teaser-video");
  var button = document.querySelector(".teaser-play");
  if (!video || !button) return;

  var connection = navigator.connection;
  var limited = connection && (connection.saveData ||
    /(^|-)2g$|^3g$/.test(connection.effectiveType));
  video.preload = limited ? "metadata" : "auto";
  video.controls = false;
  button.hidden = false;

  // From the first play on, the native controls handle pausing, seeking and
  // replaying; the arrow does not come back.
  function handOver() {
    button.hidden = true;
    video.controls = true;
  }

  button.addEventListener("click", function () {
    // Hand over first so the video can take focus and its controls stay
    // usable while buffering.
    handOver();
    video.focus();
    var playback = video.play();
    if (playback && playback.catch) {
      playback.catch(function () {
        video.controls = false;
        button.hidden = false;
      });
    }
  });
  video.addEventListener("play", handOver);
  // Start background result loading once playback actually begins. Neighbor
  // prefetching is always on.
  video.addEventListener("playing", function () {
    document.dispatchEvent(new Event("refocus:prefetch"));
  }, { once: true });
})();
