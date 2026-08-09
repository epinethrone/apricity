(function () {
  try {
    var panes = { "--rooms-w": [200, 600, 300], "--drawers-w": [280, 900, 480] };
    for (var v in panes) {
      var bounds = panes[v], px = bounds[2];
      var raw = localStorage.getItem("mempalace-pane" + v);
      var parsed = raw == null ? NaN : parseInt(raw, 10);
      if (isFinite(parsed)) px = Math.min(bounds[1], Math.max(bounds[0], parsed));
      document.documentElement.style.setProperty(v, px + "px");
    }
  } catch (error) {}
  try {
    var mode = localStorage.getItem("mempalace-theme");
    if (mode === "light" || mode === "dark") {
      document.documentElement.dataset.theme = mode;
    }
  } catch (error) {}
})();
