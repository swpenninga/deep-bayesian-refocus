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
