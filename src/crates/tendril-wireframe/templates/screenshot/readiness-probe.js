(() => {
  const w = window.__wireframe;
  if (w && w.version === 1) {
    return { ready: !!w.ready, reason: w.reason ?? null, hook: true,
             deterministic: w.deterministic !== false };
  }
  const paths = document.querySelectorAll("svg path").length;
  const signature = paths + ":" + document.documentElement.scrollHeight +
                    ":" + document.body.innerHTML.length;
  const previous = window.__wfProbeSignature;
  window.__wfProbeSignature = signature;
  const ready = previous === signature && paths > 0 && document.fonts.status === "loaded";
  return { ready, reason: ready ? null : `heuristic probe (paths=${paths})`,
           hook: false, deterministic: true };
})()