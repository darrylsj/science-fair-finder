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

  // Every word typed must appear in the scholar's name (or project title / table number).
  function search(students, query) {
    const words = normalize(query).split(" ").filter(Boolean);
    if (words.length === 0) return [];
    const scored = [];
    for (const s of students) {
      const name = normalize(s.name);
      const extra = normalize(s.title) + " table " + (s.table || "");
      let score = 0;
      let ok = true;
      for (const word of words) {
        if (name.split(" ").some((part) => part.startsWith(word))) score += 3;
        else if (name.includes(word)) score += 2;
        else if (extra.includes(word)) score += 1;
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
      g.addEventListener("click", () => options.onTable && options.onTable(t.id));
      svg.appendChild(g);
      groups[t.id] = { g, t, w, h };
    }

    const overlay = el("g", {});
    svg.appendChild(overlay);
    holder.innerHTML = "";
    holder.appendChild(svg);

    return {
      // Light up one table (or pass null to clear).
      highlight(tableId) {
        overlay.innerHTML = "";
        for (const id in groups) {
          groups[id].g.classList.toggle("hit", id === tableId);
          groups[id].g.classList.toggle("dim", Boolean(tableId) && id !== tableId);
        }
        const hit = groups[tableId];
        if (!hit) return;
        overlay.appendChild(el("circle", { class: "pulse", cx: hit.t.x, cy: hit.t.y, r: 7 }));
        // Scroll the map so the table is in view when zoomed in.
        const box = holder.getBoundingClientRect();
        const scale = svg.getBoundingClientRect().width / (W + 3);
        holder.scrollTo({ left: (hit.t.x + 1.5) * scale - box.width / 2, top: (hit.t.y + 1.5) * scale - box.height / 2, behavior: "smooth" });
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
