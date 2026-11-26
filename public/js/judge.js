// The judge page: type a name, see the table.

(async () => {
  const { $ } = SFF;
  let eventId = await SFF.loadEvents($("#event"));
  let layout = null;
  let map = null;
  let students = [];
  let selectedId = null;
  let mine = []; // ids of scholars this judge has looked up, remembered on this phone
  const mineKey = () => "sff-mine-" + eventId;
  function loadMine() {
    try {
      mine = JSON.parse(localStorage.getItem(mineKey()) || "[]");
    } catch {
      mine = [];
    }
  }
  function saveMine() {
    try {
      localStorage.setItem(mineKey(), JSON.stringify(mine));
    } catch {
      // private browsing: the list just lasts until the page closes
    }
  }
  const wide = () => window.matchMedia("(min-width: 1000px)").matches; // iPad-style two-column layout

  SFF.showDemoBanner();

  // ---------- signing in ----------

  async function trySignIn(code) {
    try {
      await SFF.login(code);
      $("#gate").hidden = true;
      $("#app").hidden = false;
      await openEvent();
      return true;
    } catch (error) {
      SFF.logout();
      $("#gate").hidden = false;
      $("#app").hidden = true;
      $("#gateError").textContent = code ? error.message : "";
      return false;
    }
  }

  $("#gateForm").addEventListener("submit", (e) => {
    e.preventDefault();
    trySignIn($("#code").value);
  });
  $("#signout").addEventListener("click", (e) => {
    e.preventDefault();
    SFF.logout();
    location.reload();
  });

  // ---------- data ----------

  async function refresh() {
    try {
      const data = await SFF.api(`/events/${eventId}/students`);
      students = data.students;
      const seated = students.filter((s) => s.table).length;
      $("#status").textContent = students.length
        ? `${seated} of ${students.length} scholars checked in`
        : "No roster loaded for this fair yet";
      renderResults();
      renderFound();
      renderMine();
    } catch (error) {
      if (error.status === 401) trySignIn("");
      else $("#status").textContent = "Offline - showing the last list";
    }
  }

  async function openEvent() {
    layout = await SFF.loadLayout(eventId);
    map = SFF.drawMap($("#map"), layout, { onTable: showTable, onZoom: (zoomed) => ($("#zoomAll").disabled = !zoomed) });
    SFF.drawLegend($("#legend"), layout);
    $("#mapTitle").textContent = layout.venue;
    selectedId = null;
    $("#q").value = "";
    loadMine();
    await refresh();
  }

  // ---------- drawing ----------

  function renderResults() {
    const list = $("#results");
    const query = $("#q").value;
    const matches = SFF.search(students, query).slice(0, 8);
    list.innerHTML = "";
    $("#noMatch").hidden = !(query.trim() && matches.length === 0);
    $("#howTo").hidden = Boolean(query.trim());
    for (const s of matches) {
      const li = document.createElement("li");
      if (s.id === selectedId) li.className = "sel";
      const who = document.createElement("div");
      who.className = "who";
      const name = document.createElement("b");
      name.textContent = s.name;
      if (s.number) {
        const number = document.createElement("i");
        number.textContent = "#" + s.number;
        name.appendChild(number);
      }
      const sub = document.createElement("span");
      sub.textContent = [s.grade && "Grade " + s.grade, s.category].filter(Boolean).join(" · ");
      const project = document.createElement("em");
      project.textContent = s.title || "";
      who.append(name, sub, project);
      const chip = document.createElement("span");
      chip.className = "chip" + (s.table ? "" : " wait");
      chip.textContent = s.table ? "Table " + s.table : "Not here yet";
      li.append(who, chip);
      li.addEventListener("click", () => select(s.id, true));
      list.appendChild(li);
    }
    // Only one match? Show it straight away.
    if (matches.length === 1 && selectedId !== matches[0].id) select(matches[0].id, false);
  }

  // tapped = the judge tapped a row (as opposed to us auto-picking the only match while they type)
  function select(id, tapped) {
    selectedId = id;
    if (tapped && !mine.includes(id)) {
      mine.unshift(id);
      mine = mine.slice(0, 20);
      saveMine();
    }
    renderResults();
    renderFound(tapped);
    renderMine();
    if (tapped && document.activeElement) document.activeElement.blur(); // hide the phone keyboard
  }

  function renderFound(scroll) {
    const s = students.find((x) => x.id === selectedId);
    $("#found").hidden = !s;
    if (!s) {
      map && map.highlight(null);
      return;
    }
    const table = layout.tables.find((t) => t.id === s.table);
    $("#foundName").textContent = s.name + (s.number ? "  #" + s.number : "");
    $("#foundTitle").textContent = s.title || "";
    $("#foundBig").classList.toggle("wait", !s.table);
    if (s.table) {
      $("#foundBig").firstElementChild.textContent = "Table";
      $("#foundTable").textContent = s.table;
      $("#foundWhere").textContent = table ? table.section + " area" : "";
      map.highlight(s.table, scroll);
      // On a phone the map sits below the answer, so bring both into view.
      if (scroll && !wide()) $("#found").scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      $("#foundBig").firstElementChild.textContent = "";
      $("#foundTable").textContent = "Not checked in";
      $("#foundWhere").textContent = "This page updates by itself when they arrive.";
      map.highlight(null);
    }
  }

  // The judge's own short list, with live table numbers.
  function renderMine() {
    const box = $("#mine");
    box.innerHTML = "";
    const list = mine.map((id) => students.find((s) => s.id === id)).filter(Boolean);
    $("#mineCard").hidden = list.length === 0;
    for (const s of list) {
      const button = document.createElement("button");
      button.type = "button";
      if (s.id === selectedId) button.className = "on";
      const table = document.createElement("b");
      table.textContent = s.table || "…";
      if (!s.table) table.className = "wait";
      const remove = document.createElement("span");
      remove.className = "x";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + s.name);
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        mine = mine.filter((id) => id !== s.id);
        saveMine();
        renderMine();
      });
      button.append(document.createTextNode(s.name), table, remove);
      button.addEventListener("click", () => select(s.id, true));
      box.appendChild(button);
    }
  }

  function showTable(tableId) {
    const here = students.filter((s) => s.table === tableId).map((s) => s.name);
    const table = layout.tables.find((t) => t.id === tableId);
    $("#tableInfo").textContent = `Table ${tableId} (${table.section}): ` + (here.length ? here.join(", ") : "nobody checked in yet");
  }

  // ---------- wiring ----------

  $("#q").addEventListener("input", () => {
    selectedId = null;
    renderResults();
    renderFound();
  });
  $("#zoomIn").addEventListener("click", () => map.zoomIn());
  $("#zoomOut").addEventListener("click", () => map.zoomOut());
  $("#zoomAll").addEventListener("click", () => map.wholeRoom());
  $("#event").addEventListener("change", () => {
    eventId = $("#event").value;
    openEvent();
  });

  SFF.live(
    (changedEvent) => {
      if (!$("#app").hidden && (changedEvent === null || changedEvent === eventId)) refresh();
    },
    (isLive) => $("#dot").classList.toggle("live", isLive)
  );

  const saved = SFF.savedCode();
  if (saved) trySignIn(saved);
  else $("#gate").hidden = false;
})();
