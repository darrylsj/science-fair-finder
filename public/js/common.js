// Shared helpers for the judge page and the admin page.
// Everything hangs off one global object called SFF (Science Fair Finder).

const SFF = (() => {
  const SVG = "http://www.w3.org/2000/svg";
  const CODE_KEY = "sff-access-code";
  const EVENT_KEY = "sff-event";

  // ---------- small utilities ----------

  function $(selector) {
    return document.querySelector(selector);
  }

  function el(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function remember(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // private browsing: fine, we just won't remember
    }
  }

  function recall(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  // "José  O'Neil" -> "jose o'neil" so searches are forgiving.
  function normalize(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  // Partial search. Every word typed must match the scholar somewhere:
  // the start of their project number, any part of their name, or any part of the project title.
  // "zor", "wood", "112", "solar ov" and "table 45" all work.
  function search(students, query) {
    let text = normalize(query).replace(/#/g, "");
    let tableWanted = null;
    const tableMatch = text.match(/\b(?:table|tbl)\s*(\w+)/);
    if (tableMatch) {
      tableWanted = tableMatch[1];
      text = text.replace(tableMatch[0], " ");
    }
    const words = text.split(" ").filter(Boolean);
    if (words.length === 0 && !tableWanted) return [];
    const scored = [];
    for (const s of students) {
      if (tableWanted && String(s.table || "") !== tableWanted) continue;
      const name = normalize(s.name);
      const title = normalize(s.title);
      const number = normalize(s.number);
      const digits = number.replace(/\D/g, "").replace(/^0+/, ""); // "hyp-0104" -> "104"
      let score = 0;
      let ok = true;
      for (const word of words) {
        if (number && number === word) score += 6;
        else if (digits && /^\d+$/.test(word) && digits === word.replace(/^0+/, "")) score += 5;
        else if (number && (number.startsWith(word) || number.replace(/[^a-z0-9]/g, "").startsWith(word.replace(/[^a-z0-9]/g, "")))) score += 4;
        else if (digits && /^\d+$/.test(word) && digits.startsWith(word.replace(/^0+/, ""))) score += 3.5;
        else if (name.split(" ").some((part) => part.startsWith(word))) score += 3;
        else if (name.includes(word)) score += 2;
        else if (title.includes(word)) score += 1;
        else {
          ok = false;
          break;
        }
      }
      if (ok) scored.push([score, s]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    return scored.map((pair) => pair[1]);
  }

  function toast(message, ms = 2600) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const box = document.createElement("div");
    box.className = "toast";
    box.textContent = message;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), ms);
  }

  // ---------- access code ----------

  // A link like https://site/#code=abc signs the judge in. The part after # never
  // leaves the phone, and we wipe it from the address bar right away.
  function codeFromLink() {
    const match = location.hash.match(/code=([^&]+)/);
    if (!match) return null;
    history.replaceState(null, "", location.pathname + location.search);
    return decodeURIComponent(match[1]);
  }

  let accessCode = null;

  async function api(path, options = {}) {
    const response = await fetch("/api" + path, {
      method: options.method || "GET",
      headers: {
        "x-access-code": accessCode || "",
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      // not JSON; leave empty
    }
    if (!response.ok) {
      const error = new Error(data.error || "Something went wrong (" + response.status + ")");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function login(code) {
    accessCode = code.trim();
    const result = await api("/login", { method: "POST", body: {} });
    remember(CODE_KEY, accessCode);
    return result; // { role, demo }
  }

  function logout() {
    accessCode = null;
    remember(CODE_KEY, null);
  }

  function savedCode() {
    return codeFromLink() || recall(CODE_KEY);
  }

  // ---------- events and layouts ----------

  async function loadEvents(selectNode) {
    const events = await (await fetch("/layouts/index.json")).json();
    const saved = recall(EVENT_KEY);
    const start = events.find((e) => e.id === saved) || events.find((e) => e.default) || events[0];
    selectNode.innerHTML = "";
    for (const event of events) {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = event.name;
      selectNode.appendChild(option);
    }
    selectNode.value = start.id;
    selectNode.addEventListener("change", () => remember(EVENT_KEY, selectNode.value));
    return start.id;
  }

  async function loadLayout(eventId) {
    return (await fetch(`/layouts/${eventId}.json`)).json();
  }

  // ---------- live updates ----------

  // Calls onChange(eventId) whenever the server says the roster changed.
  // Falls back to checking once a minute if the live connection is down.
  function live(onChange, onStatus) {
    let socket = null;
    let retryMs = 1000;
    let pingTimer = null;

    function connect() {
      if (socket && socket.readyState <= 1) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${scheme}//${location.host}/api/ws`);
      socket.onopen = () => {
        retryMs = 1000;
        onStatus(true);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => socket.readyState === 1 && socket.send("ping"), 30000);
      };
      socket.onmessage = (message) => {
        if (message.data === "pong") return;
        try {
          const data = JSON.parse(message.data);
          // Small random delay so 130 phones do not all ask at the same instant.
          if (data.type === "changed") setTimeout(() => onChange(data.event), Math.random() * 1200);
        } catch {
          // ignore anything unexpected
        }
      };
      socket.onclose = () => {
        onStatus(false);
        clearInterval(pingTimer);
        if (!document.hidden) setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 20000);
      };
      socket.onerror = () => socket.close();
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        connect();
        onChange(null); // screen just woke up: refresh in case we missed something
      }
    });
    setInterval(() => {
      if (!document.hidden && (!socket || socket.readyState !== 1)) onChange(null);
    }, 60000);
    connect();
  }

  // ---------- the map ----------

  function textColorFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const brightness = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
    return brightness > 150 ? "#14213d" : "#ffffff";
  }

  // Draws the room into `holder` and returns helpers to highlight tables.
  // options.onTable(tableId) is called when someone taps a table.
  function drawMap(holder, layout, options = {}) {
    const W = layout.width;
    const H = layout.height;
    const svg = el("svg", { viewBox: `-1.5 -1.5 ${W + 3} ${H + 3}`, role: "img", "aria-label": "Map of project tables" });
    svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff", stroke: "#2b2f36", "stroke-width": 0.35 }));

    for (const [x1, y1, x2, y2, color] of layout.lines || []) {
      svg.appendChild(el("line", { x1, y1, x2, y2, stroke: color, "stroke-width": 0.5, "stroke-linecap": "round", opacity: 0.8 }));
    }
    for (const door of layout.doors || []) {
      const x = door.side === "left" ? 0 : W;
      const sweep = door.side === "left" ? 1 : 0;
      const dx = door.side === "left" ? 3 : -3;
      svg.appendChild(el("path", {
        d: `M ${x} ${door.at - 3} A 3 3 0 0 ${sweep} ${x + dx} ${door.at} A 3 3 0 0 ${sweep} ${x} ${door.at + 3}`,
        fill: "none", stroke: "#8a93a3", "stroke-width": 0.25, "stroke-dasharray": "0.5 0.4",
      }));
      svg.appendChild(el("line", { x1: x, y1: door.at - 3, x2: x, y2: door.at + 3, stroke: "#ffffff", "stroke-width": 0.6 }));
    }
    for (const desk of layout.desks || []) {
      svg.appendChild(el("rect", { x: desk.x - desk.w / 2, y: desk.y - desk.h / 2, width: desk.w, height: desk.h, rx: 0.3, fill: "#e3e6ea", stroke: "#6b7280", "stroke-width": 0.15 }));
      if (desk.text) svg.appendChild(el("text", { x: desk.x, y: desk.y + desk.h / 2 + 2.3, "text-anchor": "middle", "font-size": 1.9, fill: "#14213d" }, desk.text));
    }
    for (const label of layout.labels || []) {
      svg.appendChild(el("text", { x: label.x, y: label.y, "text-anchor": "middle", "font-size": label.size || 2.6, "font-weight": 600, fill: label.color || "#14213d" }, label.text));
    }

    const groups = {};
    for (const t of layout.tables) {
      // Tables are drawn a little fatter than real life so the numbers are readable on a phone.
      const upright = t.h >= t.w;
      const w = upright ? Math.max(t.w, 5.6) : t.w;
      const h = upright ? t.h : Math.max(t.h, 5.2);
      const g = el("g", { class: "map-table", "data-id": t.id, tabindex: 0, role: "button" });
      g.appendChild(el("title", {}, `Table ${t.id} - ${t.section}`));
      g.appendChild(el("rect", { class: "body", x: t.x - w / 2, y: t.y - h / 2, width: w, height: h, rx: 0.8, fill: t.color }));
      g.appendChild(el("text", { x: t.x, y: t.y + 1.35, "text-anchor": "middle", "font-size": 3.7, fill: textColorFor(t.color) }, t.id));
      g.addEventListener("click", () => !justDragged && options.onTable && options.onTable(t.id));
      svg.appendChild(g);
      groups[t.id] = { g, t, w, h };
    }

    const overlay = el("g", {});
    svg.appendChild(overlay);
    holder.innerHTML = "";
    holder.appendChild(svg);

    // ----- pinch, drag and zoom -----
    // We zoom by changing which part of the room the picture shows (its "viewBox").
    const full = { x: -1.5, y: -1.5, w: W + 3, h: H + 3 };
    let view = { ...full };
    const MAX_ZOOM = 6;
    let justDragged = false; // so a drag or pinch is not mistaken for a tap on a table
    let animation = null;

    function setView(next) {
      const w = Math.min(full.w, Math.max(full.w / MAX_ZOOM, next.w));
      const h = (w * full.h) / full.w;
      view = {
        w,
        h,
        x: Math.min(full.x + full.w - w, Math.max(full.x, next.x)),
        y: Math.min(full.y + full.h - h, Math.max(full.y, next.y)),
      };
      svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
      const zoomed = view.w < full.w * 0.98;
      // Zoomed in: one finger moves the map. Whole room showing: one finger scrolls the page as usual.
      svg.style.touchAction = zoomed ? "none" : "pan-y";
      svg.style.cursor = zoomed ? "grab" : "";
      if (options.onZoom) options.onZoom(zoomed);
    }

    // Glide smoothly to a new view (used by the buttons and when a scholar is found).
    function glideTo(target) {
      cancelAnimationFrame(animation);
      const from = { ...view };
      const start = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - start) / 280);
        const e = 1 - Math.pow(1 - k, 3);
        setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e });
        if (k < 1) animation = requestAnimationFrame(step);
      };
      animation = requestAnimationFrame(step);
    }

    // Turn a spot on the screen into a spot in the room (feet).
    function roomPoint(clientX, clientY) {
      const box = svg.getBoundingClientRect();
      return { x: view.x + ((clientX - box.left) / box.width) * view.w, y: view.y + ((clientY - box.top) / box.height) * view.h };
    }

    // Zoom by `factor` while keeping the room spot under the finger/cursor in place.
    function zoomAt(factor, clientX, clientY, glide) {
      const anchor = roomPoint(clientX, clientY);
      const w = Math.min(full.w, Math.max(full.w / MAX_ZOOM, view.w / factor));
      const ratio = w / view.w;
      const target = { w, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio };
      glide ? glideTo(target) : setView(target);
    }

    function zoomCenter(factor) {
      const box = svg.getBoundingClientRect();
      zoomAt(factor, box.left + box.width / 2, box.top + box.height / 2, true);
    }

    const fingers = new Map(); // finger id -> where it is on screen
    let moved = 0;
    let lastTap = 0;

    svg.addEventListener("pointerdown", (e) => {
      cancelAnimationFrame(animation);
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 1) moved = 0;
    });
    svg.addEventListener("pointermove", (e) => {
      const before = fingers.get(e.pointerId);
      if (!before) return;
      const box = svg.getBoundingClientRect();
      if (fingers.size === 1) {
        // One finger (or the mouse): slide the map, but only when zoomed in.
        if (view.w >= full.w * 0.98) return;
        const dx = e.clientX - before.x;
        const dy = e.clientY - before.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 6 && !svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
        setView({ w: view.w, x: view.x - (dx / box.width) * view.w, y: view.y - (dy / box.height) * view.h });
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      } else if (fingers.size === 2) {
        // Two fingers: pinch to zoom, and the map follows the midpoint of the fingers.
        const [a0, b0] = [...fingers.values()];
        const gap0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
        const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a1, b1] = [...fingers.values()];
        const gap1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
        const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
        moved += 10;
        const anchor = roomPoint(mid0.x, mid0.y);
        const w = Math.min(full.w, Math.max(full.w / MAX_ZOOM, (view.w * gap0) / Math.max(gap1, 1)));
        setView({
          w,
          x: anchor.x - ((mid1.x - box.left) / box.width) * w,
          y: anchor.y - ((mid1.y - box.top) / box.height) * ((w * full.h) / full.w),
        });
      }
    });
    const lift = (e) => {
      if (!fingers.delete(e.pointerId)) return;
      if (fingers.size > 0) return;
      justDragged = moved > 6;
      setTimeout(() => (justDragged = false), 60);
      // Double-tap (or double-click) zooms in on that spot.
      if (!justDragged && e.type === "pointerup") {
        const now = Date.now();
        if (now - lastTap < 320) {
          zoomAt(2, e.clientX, e.clientY, true);
          lastTap = 0;
        } else lastTap = now;
      }
    };
    svg.addEventListener("pointerup", lift);
    svg.addEventListener("pointercancel", lift);
    // Trackpad pinch / Ctrl + scroll wheel on a computer.
    svg.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY, false);
    }, { passive: false });
    // Stops iPhone/iPad Safari from zooming the whole page when the pinch starts on the map.
    svg.addEventListener("gesturestart", (e) => e.preventDefault());
    setView(full);

    return {
      zoomIn: () => zoomCenter(1.6),
      zoomOut: () => zoomCenter(1 / 1.6),
      wholeRoom: () => glideTo(full),
      // Light up one table (or pass null to clear). zoom: true also glides the map to it.
      highlight(tableId, zoom) {
        overlay.innerHTML = "";
        for (const id in groups) {
          groups[id].g.classList.toggle("hit", id === tableId);
          groups[id].g.classList.toggle("dim", Boolean(tableId) && id !== tableId);
        }
        const hit = groups[tableId];
        if (!hit) return;
        overlay.appendChild(el("circle", { class: "pulse", cx: hit.t.x, cy: hit.t.y, r: 7 }));
        if (zoom) {
          // Phones get a closer look than tablets, where the whole room is already readable.
          const w = full.w / (svg.getBoundingClientRect().width < 520 ? 2.2 : 1.5);
          glideTo({ w, x: hit.t.x - w / 2, y: hit.t.y - (w * full.h) / full.w / 2 });
        }
      },
      // Dashed outline on tables in a scholar's grade area (admin page).
      suggest(sectionName) {
        for (const id in groups) groups[id].g.classList.toggle("suggest", Boolean(sectionName) && groups[id].t.section === sectionName);
      },
      // Little counters showing how many scholars are at each table (admin page).
      counts(countByTable) {
        svg.querySelectorAll(".count").forEach((n) => n.remove());
        for (const id in groups) {
          const n = countByTable[id] || 0;
          if (!n) continue;
          const { t, w, h } = groups[id];
          const badge = el("g", { class: "count", "pointer-events": "none" });
          badge.appendChild(el("circle", { class: "count-badge" + (n >= t.capacity ? " full" : ""), cx: t.x + w / 2, cy: t.y - h / 2, r: 1.7 }));
          badge.appendChild(el("text", { x: t.x + w / 2, y: t.y - h / 2 + 0.75, "text-anchor": "middle", "font-size": 2.1, "font-weight": 700, fill: "#fff" }, n));
          svg.insertBefore(badge, overlay);
        }
      },
    };
  }

  function drawLegend(holder, layout) {
    const colorsBySection = new Map(); // section name -> list of colors used for it
    for (const t of layout.tables) {
      if (!colorsBySection.has(t.section)) colorsBySection.set(t.section, []);
      if (!colorsBySection.get(t.section).includes(t.color)) colorsBySection.get(t.section).push(t.color);
    }
    holder.innerHTML = "";
    for (const [section, colors] of colorsBySection) {
      const item = document.createElement("span");
      for (const color of colors) {
        const swatch = document.createElement("i");
        swatch.style.background = color;
        item.appendChild(swatch);
      }
      item.appendChild(document.createTextNode(section));
      holder.appendChild(item);
    }
  }

  async function showDemoBanner() {
    const config = await (await fetch("/api/config")).json();
    const banner = $("#demo");
    if (config.demo && banner) {
      banner.hidden = false;
      banner.innerHTML = `<b>Test mode</b> - fake scholars only. Judge code <code>${config.demoJudgeCode}</code>, admin code <code>${config.demoAdminCode}</code>.`;
    }
    return config;
  }

  return { $, api, login, logout, savedCode, loadEvents, loadLayout, live, drawMap, drawLegend, search, toast, showDemoBanner };
})();
