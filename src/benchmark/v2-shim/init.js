// Benchmark-only browser init script for Tendril V2 under the v2shim IPC shim. Add it with
// Playwright's `context.addInitScript({ content })` so it runs before any app code.
//
// It emulates what the Tauri host injects into its webview: `window.__TAURI_INTERNALS__` (invoke,
// callbacks, metadata) and the event plugin's listener registry. `invoke()` goes to the shim over
// one WebSocket, where the app's real cmd_* handlers run; events the app's bridges emit arrive over
// SSE (/__shim/events) and are dispatched to the registered callbacks with Tauri's
// `{event, id, payload}` shape. Plugin commands other than event listen/unlisten (opener, dialog,
// notification) resolve to null here, so the benchmark can never open URLs or post notifications.
//
// Every invoke is recorded in `window.__SHIM_IPC__` as
// `{cmd, t, ms, ok, status, bytes, transport}` (t = performance.now() at the call, ms = round trip,
// status 200 on success and 422 on a command error, as the HTTP transport reports them).
(() => {
  if (window.__TAURI_INTERNALS__) return;

  const callbacks = new Map();
  const listeners = new Map(); // event name -> Map(eventId -> callback id)
  let nextEventId = 1;
  const log = (window.__SHIM_IPC__ = []);

  function transformCallback(cb, once = false) {
    const id = crypto.getRandomValues(new Uint32Array(1))[0];
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return cb && cb(data);
    });
    return id;
  }

  // --- transport ---------------------------------------------------------------------------------
  // A WebSocket rather than one fetch per call: Chromium caps HTTP/1.1 at six connections per origin
  // (one of them held by the SSE stream), which would serialize a burst of IPC calls that the real
  // host runs concurrently. The HTTP route stays as a fallback if the socket cannot open.
  const pending = new Map();
  let nextReq = 1;
  let socket = null;
  let socketReady = null;
  let socketFailed = false;

  class SocketUnavailable extends Error {
    constructor() {
      super('shim IPC socket failed to open');
    }
  }

  function openSocket() {
    if (socketReady) return socketReady;
    socketReady = new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/__shim/ws`);
      ws.onopen = () => {
        socket = ws;
        resolve(ws);
      };
      ws.onerror = () => reject(new SocketUnavailable());
      ws.onclose = () => {
        socket = null;
        socketReady = null;
        for (const p of pending.values()) p.reject({ message: 'shim IPC socket closed' });
        pending.clear();
      };
      ws.onmessage = (m) => {
        const r = JSON.parse(m.data);
        const p = pending.get(r.id);
        if (!p) return;
        pending.delete(r.id);
        if (!r.ok) return p.reject(r.error);
        if (typeof r.raw === 'string') {
          const bin = atob(r.raw);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          return p.resolve({ value: buf.buffer, bytes: buf.length });
        }
        p.resolve({ value: r.value, bytes: m.data.length });
      };
    });
    socketReady.catch(() => {
      socketFailed = true;
      socketReady = null;
    });
    return socketReady;
  }

  async function sendFrame(frame) {
    const ws = socket ?? (await openSocket());
    const id = nextReq++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, ...frame }));
    });
  }

  async function viaHttp(cmd, args) {
    const res = await fetch('/__shim/ipc/' + encodeURIComponent(cmd), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });
    if ((res.headers.get('content-type') || '').startsWith('application/octet-stream')) {
      const buf = await res.arrayBuffer();
      if (!res.ok) throw { message: `shim HTTP ${res.status}` };
      return { value: buf, bytes: buf.byteLength };
    }
    const text = await res.text();
    const value = text.length ? JSON.parse(text) : null;
    if (!res.ok) throw value;
    return { value, bytes: text.length };
  }

  async function invoke(cmd, args = {}, _options) {
    if (cmd === 'plugin:event|listen') {
      const eventId = nextEventId++;
      if (!listeners.has(args.event)) listeners.set(args.event, new Map());
      listeners.get(args.event).set(eventId, args.handler);
      // The real host's listen is an IPC round trip too; this one makes sure the shim forwards the
      // event, which matters only for names beyond the ones it subscribes up front.
      if (!socketFailed) await sendFrame({ listen: args.event }).catch(() => {});
      return eventId;
    }
    if (cmd === 'plugin:event|unlisten') {
      listeners.get(args.event)?.delete(args.eventId);
      return null;
    }
    if (cmd.startsWith('plugin:')) return null;

    const t0 = performance.now();
    let transport = socketFailed ? 'http' : 'ws';
    try {
      let r;
      if (transport === 'ws') {
        try {
          r = await sendFrame({ cmd, args: args ?? {} });
        } catch (e) {
          if (!(e instanceof SocketUnavailable)) throw e;
          transport = 'http';
        }
      }
      if (transport === 'http') r = await viaHttp(cmd, args);
      log.push({ cmd, t: t0, ms: performance.now() - t0, ok: true, status: 200, bytes: r.bytes, transport });
      return r.value;
    } catch (e) {
      log.push({ cmd, t: t0, ms: performance.now() - t0, ok: false, status: 422, bytes: 0, transport, error: typeof e === 'string' ? e.slice(0, 300) : JSON.stringify(e ?? null).slice(0, 300) });
      throw e;
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id) => callbacks.delete(id),
    runCallback: (id, data) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (p, proto = 'asset') => `${proto}://localhost/${encodeURIComponent(p)}`,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event, eventId) => listeners.get(event)?.delete(eventId),
  };
  // The host sets this flag too (`isTauri()` in @tauri-apps/api reads it).
  window.isTauri = true;

  const events = new EventSource('/__shim/events');
  events.onmessage = (m) => {
    const { event, payload } = JSON.parse(m.data);
    const hs = listeners.get(event);
    if (!hs) return;
    for (const [eventId, handlerId] of hs) callbacks.get(handlerId)?.({ event, id: eventId, payload });
  };
  window.__SHIM_EVENTS__ = events;

  // Connect early so the first invoke does not pay for the handshake.
  openSocket().catch(() => {});
})();
