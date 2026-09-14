// agent-lite.js — minimal agent protocol for WebViewer standalone demo

(function () {
  let selecting = false;
  let hoveredElement = null;
  const markers = new Map();

  function postMessage(data) {
    window.parent.postMessage(data, "*");
  }

  function getXPath(element) {
    if (element.id) return `//*[@id="${element.id}"]`;
    if (element === document.body) return "/html/body";

    let ix = 0;
    const siblings = element.parentNode?.childNodes || [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        const tagName = element.tagName.toLowerCase();
        return `${getXPath(element.parentNode)}/${tagName}[${ix + 1}]`;
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) ix++;
    }
    return "";
  }

  function getSelector(element) {
    if (element.id) return `#${element.id}`;
    const path = [];
    let current = element;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.className) {
        selector += "." + current.className.trim().split(/\s+/).join(".");
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(" > ");
  }

  function startSelection() {
    selecting = true;
    document.body.style.cursor = "crosshair";
  }

  function stopSelection() {
    selecting = false;
    document.body.style.cursor = "";
    if (hoveredElement) {
      hoveredElement.classList.remove("element-outline");
      hoveredElement = null;
    }
  }

  function handleMouseMove(e) {
    if (!selecting) return;
    if (hoveredElement) {
      hoveredElement.classList.remove("element-outline");
    }
    hoveredElement = e.target;
    hoveredElement.classList.add("element-outline");
  }

  function handleClick(e) {
    if (!selecting) return;
    e.preventDefault();
    e.stopPropagation();

    const element = e.target;
    const xpath = getXPath(element);
    const selector = getSelector(element);
    const tag = element.tagName.toLowerCase();
    const text = element.textContent?.trim().slice(0, 100) || "";

    stopSelection();

    postMessage({
      __proxy: true,
      type: "selected",
      xpath,
      selector,
      meta: { tag, text },
      debug: null,
    });
  }

  function handleKeyDown(e) {
    if (e.key === "Escape" && selecting) {
      stopSelection();
      postMessage({
        __proxy: true,
        type: "select-cancelled",
      });
    }
  }

  function setMarkers(markerList) {
    // Clear existing markers
    markers.forEach((pin) => pin.remove());
    markers.clear();

    // Draw new markers
    markerList.forEach((marker) => {
      const pin = document.createElement("div");
      pin.className = "marker-pin";
      pin.textContent = marker.number;
      pin.dataset.markerId = marker.id;

      // Position at element location (simplified — no actual element lookup)
      pin.style.position = "absolute";
      pin.style.top = `${100 + marker.number * 40}px`;
      pin.style.left = "20px";

      pin.addEventListener("click", () => {
        postMessage({
          __proxy: true,
          type: "marker-click",
          id: marker.id,
        });
      });

      document.body.appendChild(pin);
      markers.set(marker.id, pin);
    });
  }

  function handleCapture() {
    postMessage({
      __proxy: true,
      type: "capture-error",
      message: "Screenshot capture requires the Tendril proxy.",
    });
  }

  // Message handler
  window.addEventListener("message", (e) => {
    const data = e.data;
    if (!data || typeof data !== "object") return;

    const cmd = data.__proxyCmd;
    if (!cmd) return;

    switch (cmd) {
      case "select-start":
        startSelection();
        break;
      case "select-stop":
        stopSelection();
        break;
      case "markers-set":
        setMarkers(data.markers || []);
        break;
      case "capture":
        handleCapture();
        break;
    }
  });

  // Event listeners
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown);

  // Mirror console
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  ["log", "warn", "error"].forEach((level) => {
    console[level] = function (...args) {
      originalConsole[level].apply(console, args);
      postMessage({
        __proxy: true,
        type: "console",
        level,
        text: args.map((a) => String(a)).join(" "),
      });
    };
  });

  // Report location on load
  postMessage({
    __proxy: true,
    type: "location",
    url: window.location.href,
  });
})();
