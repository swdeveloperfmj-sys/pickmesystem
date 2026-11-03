// Apply the saved appearance before styles load to avoid a light-mode flash.
(() => {
  let theme;
  try {
    theme = localStorage.getItem("ctms-theme");
  } catch {}
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  document.documentElement.dataset.theme = theme;
})();
