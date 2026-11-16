// Brand switch for the specimen. Without this script both brand panels are shown, one under the other.
(function () {
  "use strict";
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".switch [role=tab]"));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".panel"));
  if (!tabs.length || !panels.length) return;

  function show(brand, animate) {
    tabs.forEach(function (t) {
      t.setAttribute("aria-selected", String(t.getAttribute("data-target") === brand));
      t.tabIndex = t.getAttribute("data-target") === brand ? 0 : -1;
    });
    panels.forEach(function (p) {
      var on = p.getAttribute("data-brand") === brand;
      p.hidden = !on;
      p.classList.remove("entering");
      if (on && animate) {
        void p.offsetWidth; // restart the one entrance animation
        p.classList.add("entering");
      }
    });
    try { history.replaceState(null, "", "#" + brand); } catch (e) { /* ignore */ }
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { show(t.getAttribute("data-target"), true); });
    t.addEventListener("keydown", function (e) {
      var n = null;
      if (e.key === "ArrowRight") n = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") n = tabs[(i + tabs.length - 1) % tabs.length];
      if (n) { e.preventDefault(); n.focus(); show(n.getAttribute("data-target"), true); }
    });
  });

  var start = (location.hash || "").replace("#", "");
  show(tabs.some(function (t) { return t.getAttribute("data-target") === start; }) ? start : tabs[0].getAttribute("data-target"), false);
})();
