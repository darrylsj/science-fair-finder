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

  // Makes a list row behave like a button for keyboards and screen readers.
  function asButton(row, onPress) {
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.addEventListener("click", onPress);
    row.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onPress();
    });
  }

  // A short message at the bottom of the screen. Pass action = { label, onPress } to add a button (like Undo).
  function toast(message, ms = 2600, action) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const box = document.createElement("div");
    box.className = "toast";
    box.setAttribute("role", "status"); // read out by screen readers
    box.appendChild(document.createTextNode(message));
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        box.remove();
        action.onPress();
      });
      box.appendChild(button);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), ms);
  }

  // ---------- working without a connection ----------

  // Saves the pages on the phone so the finder still opens if the gym Wi-Fi drops (see /sw.js).
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  // The last scholar list this phone downloaded, kept so it can be shown while offline.
  function saveRoster(key, students) {
    remember("sff-roster-" + key, JSON.stringify({ at: Date.now(), students }));
  }
  function savedRoster(key) {
    try {
      return JSON.parse(recall("sff-roster-" + key) || "null");
    } catch {
      return null;
    }
  }
  function forgetRosters() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("sff-roster-")).forEach((k) => localStorage.removeItem(k));
    } catch {
      // private browsing: nothing was saved
    }
  }
  function clock(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

  // A random id for this phone or tablet, so "judged" marks belong to one judge without any sign-up.
  let deviceId = recall("sff-device");
  if (!deviceId) {
    deviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    remember("sff-device", deviceId);
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch("/api" + path, {
      method: options.method || "GET",
      headers: {
        "x-access-code": accessCode || "",
        "x-device-id": deviceId,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    } catch {
      throw new Error("No connection"); // no status code = the phone could not reach the server
    }
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
    forgetRosters();
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
      // Phones get just the year so the header stays on one line.
      option.textContent = window.innerWidth < 600 ? event.id : event.name;
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

    window.addEventListener("online", () => {
      connect();
      onChange(null);
    });
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

  // Phones held upright get the room turned a quarter turn, so the long wall runs down
  // the screen and every table is about 50% bigger. Turn the phone sideways for the poster view.
  function portraitPhone() {
    return window.innerWidth < 600 && window.innerHeight > window.innerWidth;
  }

  // Returns a copy of a layout turned a quarter turn clockwise.
  // A spot (x, y) moves to (room height - y, x): the old left wall becomes the top wall.
  function turnLayout(layout) {
    const H = layout.height;
    const spot = (x, y) => [Math.round((H - y) * 10) / 10, x];
    return {
      ...layout,
      turned: true,
      width: layout.height,
      height: layout.width,
      tables: layout.tables.map((t) => {
        const [x, y] = spot(t.x, t.y);
        return { ...t, x, y, w: t.h, h: t.w };
      }),
      labels: (layout.labels || []).map((label) => {
        const [x, y] = spot(label.x, label.y);
        return { ...label, x, y };
      }),
      desks: (layout.desks || []).map((desk) => {
        const [x, y] = spot(desk.x, desk.y);
        return { ...desk, x, y, w: desk.h, h: desk.w };
      }),
      doors: (layout.doors || []).map((door) => ({ side: door.side === "left" ? "top" : "bottom", at: H - door.at })),
      lines: (layout.lines || []).map(([x1, y1, x2, y2, color]) => [...spot(x1, y1), ...spot(x2, y2), color]),
    };
  }

  // Draws the room into `holder` and returns helpers to highlight tables.
  // options.turn: true draws the quarter-turned phone version.
  // options.onTable(tableId) is called when someone taps a table.
  function drawMap(holder, originalLayout, options = {}) {
    const layout = options.turn ? turnLayout(originalLayout) : originalLayout;
    const W = layout.width;
    const H = layout.height;
    const svg = el("svg", { viewBox: `-1.5 -1.5 ${W + 3} ${H + 3}`, role: "group", "aria-label": "Map of project tables" });
    svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff", stroke: "#2b2f36", "stroke-width": 0.35 }));

    for (const [x1, y1, x2, y2, color] of layout.lines || []) {
      svg.appendChild(el("line", { x1, y1, x2, y2, stroke: color, "stroke-width": 0.5, "stroke-linecap": "round", opacity: 0.8 }));
    }
    for (const door of layout.doors || []) {
      // A dotted half-circle on the wall, with a gap in the wall line.
      const along = door.side === "top" || door.side === "bottom"; // door sits on a horizontal wall
      const wall = door.side === "left" || door.side === "top" ? 0 : along ? H : W;
      const into = wall === 0 ? 3 : -3; // which way the door swings into the room
      const sweep = (door.side === "left" || door.side === "bottom") ? 1 : 0;
      const a = door.at - 3;
      const b = door.at + 3;
      const d = along
        ? `M ${a} ${wall} A 3 3 0 0 ${sweep} ${door.at} ${wall + into} A 3 3 0 0 ${sweep} ${b} ${wall}`
        : `M ${wall} ${a} A 3 3 0 0 ${sweep} ${wall + into} ${door.at} A 3 3 0 0 ${sweep} ${wall} ${b}`;
      svg.appendChild(el("path", { d, fill: "none", stroke: "#8a93a3", "stroke-width": 0.25, "stroke-dasharray": "0.5 0.4" }));
      svg.appendChild(el("line", along ? { x1: a, y1: wall, x2: b, y2: wall, stroke: "#ffffff", "stroke-width": 0.6 } : { x1: wall, y1: a, x2: wall, y2: b, stroke: "#ffffff", "stroke-width": 0.6 }));
    }
    for (const desk of layout.desks || []) {
      svg.appendChild(el("rect", { x: desk.x - desk.w / 2, y: desk.y - desk.h / 2, width: desk.w, height: desk.h, rx: 0.3, fill: "#e3e6ea", stroke: "#6b7280", "stroke-width": 0.15 }));
      if (!desk.text) continue;
      if (layout.turned) {
        // Turned map: write the name down the side of the desk.
        const x = desk.x - desk.w / 2 - 2.6;
        svg.appendChild(el("text", { x, y: desk.y, "text-anchor": "middle", "font-size": 1.9, fill: "#14213d", transform: `rotate(90 ${x} ${desk.y})` }, desk.text));
      } else {
        svg.appendChild(el("text", { x: desk.x, y: desk.y + desk.h / 2 + 2.3, "text-anchor": "middle", "font-size": 1.9, fill: "#14213d" }, desk.text));
      }
    }
    for (const label of layout.labels || []) {
      const attrs = { x: label.x, y: label.y, "text-anchor": "middle", "font-size": label.size || 2.6, "font-weight": 600, fill: label.color || "#14213d" };
      if (layout.turned) attrs.transform = `rotate(90 ${label.x} ${label.y})`; // area names read down the page
      svg.appendChild(el("text", attrs, label.text));
    }

    const groups = {};
    for (const t of layout.tables) {
      // Tables are drawn a little fatter than real life so the numbers are readable on a phone.
      const upright = t.h >= t.w;
      const w = upright ? Math.max(t.w, 5.6) : t.w;
      const h = upright ? t.h : Math.max(t.h, 5.2);
      const g = el("g", { class: "map-table", "data-id": t.id, tabindex: 0, role: "button", "aria-label": `Table ${t.id}, ${t.section}` });
      g.appendChild(el("title", {}, `Table ${t.id} - ${t.section}`));
      g.appendChild(el("rect", { class: "body", x: t.x - w / 2, y: t.y - h / 2, width: w, height: h, rx: 0.8, fill: t.color }));
      g.appendChild(el("text", { x: t.x, y: t.y + 1.35, "text-anchor": "middle", "font-size": 3.7, fill: textColorFor(t.color) }, t.id));
      g.addEventListener("click", (e) => {
        if (justDragged) return;
        // On a phone showing the whole room, tables are too small to hit reliably.
        // So the first tap zooms in on that spot; the next tap picks the table.
        const shown = g.getBoundingClientRect();
        const smallest = Math.min(shown.width, shown.height);
        if (smallest < 30 && e.clientX) return zoomAt(Math.min(3.2, 40 / smallest), e.clientX, e.clientY, true);
        if (options.onTable) options.onTable(t.id);
      });
      // Keyboard and switch-control users: Enter or Space picks the table.
      g.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (options.onTable) options.onTable(t.id);
      });
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
          const w = full.w / (layout.turned ? 1.6 : svg.getBoundingClientRect().width < 520 ? 2.2 : 1.5);
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

  // A row of small dots: one per judge who has judged this entry. Yours is the solid green one.
  function judgedDots(student) {
    const row = document.createElement("span");
    row.className = "dots";
    const count = student.judged || 0;
    if (!count) return row;
    row.title = count === 1 ? "Judged by 1 judge" : `Judged by ${count} judges`;
    for (let i = 0; i < Math.min(count, 6); i++) {
      const dot = document.createElement("i");
      if (i === 0 && student.mine) dot.className = "mine";
      row.appendChild(dot);
    }
    if (count > 6) row.appendChild(document.createTextNode("+" + (count - 6)));
    return row;
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
    let config = { demo: false };
    try {
      config = await (await fetch("/api/config")).json();
    } catch {
      return config; // offline: skip the banner
    }
    const banner = $("#demo");
    if (config.demo && banner) {
      banner.hidden = false;
      banner.innerHTML = `<b>Test mode</b> - fake scholars only. Judge code <code>${config.demoJudgeCode}</code>, check-in password <code>${config.demoAdminCode}</code>.`;
    }
    return config;
  }

  return { $, api, asButton, clock, forgetRosters, judgedDots, portraitPhone, savedRoster, saveRoster, login, logout, savedCode, loadEvents, loadLayout, live, drawMap, drawLegend, search, toast, showDemoBanner };
})();
