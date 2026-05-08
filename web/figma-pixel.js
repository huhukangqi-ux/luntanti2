(function () {
  "use strict";

  function setRoute(route) {
    var pages = document.querySelectorAll(".fp-page");
    pages.forEach(function (p) {
      p.classList.toggle("fp-page--active", p.getAttribute("data-fp-page") === route);
    });

    document.querySelectorAll(".fp-pill[data-fp-route]").forEach(function (btn) {
      var on = btn.getAttribute("data-fp-route") === route;
      btn.classList.toggle("fp-pill--active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });

    document.body.classList.toggle("fp-route-nexus", route === "nexus");

    try {
      document.dispatchEvent(new CustomEvent("fp-route", { detail: { route: route } }));
    } catch (_e) {}
  }

  var canvas = document.querySelector(".fp-canvas");
  if (canvas) {
    canvas.addEventListener("click", function (e) {
      var routeBtn = e.target.closest("[data-fp-route]");
      if (!routeBtn) return;
      var route = routeBtn.getAttribute("data-fp-route");
      if (route) setRoute(route);
    });
  }

  var chips = document.querySelectorAll(".fp-nexus-chip[data-fp-filter]");
  var cards = document.querySelectorAll(".fp-skill-card[data-fp-tags]");

  function applyNexusFilter(cat) {
    chips.forEach(function (c) {
      c.classList.toggle("fp-nexus-chip--on", c.getAttribute("data-fp-filter") === cat);
    });

    cards.forEach(function (card) {
      var tags = (card.getAttribute("data-fp-tags") || "").split(/\s*,\s*/);
      var show = cat === "全部" || tags.indexOf(cat) >= 0;
      card.hidden = !show;
    });
  }

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var cat = chip.getAttribute("data-fp-filter") || "全部";
      applyNexusFilter(cat);
    });
  });

  setRoute("forge");
})();
