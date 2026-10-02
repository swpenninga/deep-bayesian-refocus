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

  function handOver() {
    button.hidden = true;
    video.controls = true;
  }

  button.addEventListener("click", function () {

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

  video.addEventListener("playing", function () {
    document.dispatchEvent(new Event("refocus:prefetch"));
  }, { once: true });
})();
