(() => {
  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after {
      animation-delay: -0.0001s !important;
      animation-duration: 0.0001s !important;
      animation-iteration-count: 1 !important;
      animation-fill-mode: forwards !important;
      transition-duration: 0.0001s !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
      /* A focused TextInput blinks; that is a one-pixel-column diff between two
         otherwise identical runs. */
      caret-color: transparent !important;
    }
  `;
  const attach = () => (document.head || document.documentElement).appendChild(style);
  if (document.head) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
})();