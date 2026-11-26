// The judge page: type a name, see the table.

(async () => {
  const { $ } = SFF;
  let eventId = await SFF.loadEvents($("#event"));
  let layout = null;
  let map = null;
  let students = [];
  let selectedId = null;

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
    } catch (error) {
      if (error.status === 401) trySignIn("");
      else $("#status").textContent = "Offline - showing the last list";
    }
  }

  async function openEvent() {
    layout = await SFF.loadLayout(eventId);
    map = SFF.drawMap($("#map"), layout, { onTable: showTable });
    SFF.drawLegend($("#legend"), layout);
    $("#mapTitle").textContent = layout.venue;
    selectedId = null;
    $("#q").value = "";
    $("#map").classList.remove("zoom");
    $("#zoom").textContent = "Zoom in";
    await refresh();
  }

  // ---------- drawing ----------

  function renderResults() {
    const list = $("#results");
    const query = $("#q").value;
    const matches = SFF.search(students, query).slice(0, 8);
    list.innerHTML = "";
    $("#noMatch").hidden = !(query.trim() && matches.length === 0);
    for (const s of matches) {
      const li = document.createElement("li");
      if (s.id === selectedId) li.className = "sel";
      const who = document.createElement("div");
      who.className = "who";
      const name = document.createElement("b");
      name.textContent = s.name;
      const sub = document.createElement("span");
      sub.textContent = [s.grade && "Grade " + s.grade, s.category].filter(Boolean).join(" · ");
      who.append(name, sub);
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
    renderResults();
    renderFound(tapped);
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
    $("#foundName").textContent = s.name;
    $("#foundTitle").textContent = s.title || "";
    $("#foundBig").classList.toggle("wait", !s.table);
    if (s.table) {
      $("#foundBig").firstElementChild.textContent = "Table";
      $("#foundTable").textContent = s.table;
      $("#foundWhere").textContent = table ? table.section + " area" : "";
      $("#map").classList.add("zoom");
      $("#zoom").textContent = "Whole room";
      map.highlight(s.table);
      if (scroll) $("#found").scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      $("#foundBig").firstElementChild.textContent = "";
      $("#foundTable").textContent = "Not checked in";
      $("#foundWhere").textContent = "This page updates by itself when they arrive.";
      map.highlight(null);
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
  $("#zoom").addEventListener("click", () => {
    const zoomed = $("#map").classList.toggle("zoom");
    $("#zoom").textContent = zoomed ? "Whole room" : "Zoom in";
  });
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
