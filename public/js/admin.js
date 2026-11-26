// The check-in desk: pick a scholar, tap the table they set up at.

(async () => {
  const { $ } = SFF;
  let eventId = await SFF.loadEvents($("#event"));
  let layout = null;
  let map = null;
  let students = [];
  let selectedId = null;
  let filter = "waiting";

  SFF.showDemoBanner();

  // ---------- signing in ----------

  async function trySignIn(code) {
    try {
      const result = await SFF.login(code);
      if (result.role !== "admin") throw new Error("That is a judge code. The check-in desk needs the admin code.");
      $("#gate").hidden = true;
      $("#app").hidden = false;
      await openEvent();
    } catch (error) {
      SFF.logout();
      $("#gate").hidden = false;
      $("#app").hidden = true;
      $("#gateError").textContent = code ? error.message : "";
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
      students = (await SFF.api(`/events/${eventId}/students`)).students;
    } catch (error) {
      if (error.status === 401) return trySignIn("");
      $("#status").textContent = "Offline - changes will not save";
      return;
    }
    const seated = students.filter((s) => s.table).length;
    $("#status").textContent = students.length
      ? `${seated} of ${students.length} checked in · ${students.length - seated} waiting`
      : "No roster yet - open Roster tools below";
    const counts = {};
    for (const s of students) if (s.table) counts[s.table] = (counts[s.table] || 0) + 1;
    map.counts(counts);
    renderList();
    renderAssign();
  }

  async function openEvent() {
    layout = await SFF.loadLayout(eventId);
    map = SFF.drawMap($("#map"), layout, { onTable: tableTapped });
    SFF.drawLegend($("#legend"), layout);
    $("#mapTitle").textContent = layout.venue;
    selectedId = null;
    await refresh();
  }

  // Sends a change to the server, then reloads the list.
  async function send(path, body, method = "POST") {
    try {
      const result = await SFF.api(`/events/${eventId}/${path}`, { method, body });
      await refresh();
      return result;
    } catch (error) {
      SFF.toast(error.message, 4000);
      return null;
    }
  }

  // ---------- drawing ----------

  function renderList() {
    const query = $("#q").value.trim();
    let rows = query ? SFF.search(students, query) : students;
    if (filter === "waiting") rows = rows.filter((s) => !s.table);
    if (filter === "seated") rows = rows.filter((s) => s.table);
    const MAX_ROWS = query ? 20 : 8; // keep the list short so the map stays close on a phone
    const list = $("#results");
    list.innerHTML = "";
    for (const s of rows.slice(0, MAX_ROWS)) {
      const li = document.createElement("li");
      if (s.id === selectedId) li.className = "sel";
      const who = document.createElement("div");
      who.className = "who";
      const name = document.createElement("b");
      name.textContent = s.name;
      const sub = document.createElement("span");
      sub.textContent = [s.grade && "Grade " + s.grade, s.section || s.category].filter(Boolean).join(" · ");
      who.append(name, sub);
      const chip = document.createElement("span");
      chip.className = "chip" + (s.table ? "" : " wait");
      chip.textContent = s.table ? "Table " + s.table : "Waiting";
      li.append(who, chip);
      li.addEventListener("click", () => select(s.id));
      list.appendChild(li);
    }
    $("#more").textContent =
      rows.length > MAX_ROWS ? `Showing ${MAX_ROWS} of ${rows.length}. Type a name to narrow it down.` : rows.length === 0 ? "Nobody in this list." : "";
  }

  function select(id) {
    selectedId = id;
    renderList();
    renderAssign();
    // Bring the map up under the dark "assign" bar so the next tap is a table.
    if (id) $("#mapCard").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderAssign() {
    const s = students.find((x) => x.id === selectedId);
    $("#assign").hidden = !s;
    if (!s) {
      map.highlight(null);
      map.suggest(null);
      return;
    }
    $("#assignName").textContent = s.name;
    $("#assignInfo").textContent =
      [s.grade && "Grade " + s.grade, s.section || s.category].filter(Boolean).join(" · ") +
      (s.table ? ` — now at table ${s.table}. Tap another table to move.` : " — tap their table on the map, or type the number.");
    $("#assignTable").value = s.table || "";
    $("#assignUndo").hidden = !s.table;
    map.highlight(s.table || null);
    map.suggest(s.table ? null : s.section);
  }

  // ---------- actions ----------

  async function checkIn(student, tableId) {
    const table = layout.tables.find((t) => t.id === String(tableId).trim());
    if (!table) return SFF.toast(`There is no table "${tableId}" on this map.`);
    const already = students.filter((s) => s.table === table.id && s.id !== student.id).length;
    const ok = await send("checkin", { id: student.id, table: table.id });
    if (!ok) return;
    SFF.toast(`${student.name} → table ${table.id}` + (already >= table.capacity ? ` (now ${already + 1} at a table for ${table.capacity})` : ""));
    select(null);
    $("#q").value = "";
    renderList();
  }

  function tableTapped(tableId) {
    const s = students.find((x) => x.id === selectedId);
    if (s) return checkIn(s, tableId);
    const here = students.filter((x) => x.table === tableId).map((x) => x.name);
    const table = layout.tables.find((t) => t.id === tableId);
    $("#tableInfo").textContent = `Table ${tableId} (${table.section}): ` + (here.length ? here.join(", ") : "empty");
  }

  $("#assignForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const s = students.find((x) => x.id === selectedId);
    if (s && $("#assignTable").value.trim()) checkIn(s, $("#assignTable").value);
  });
  $("#assignUndo").addEventListener("click", async () => {
    const s = students.find((x) => x.id === selectedId);
    if (s && (await send("checkin", { id: s.id, table: null }))) SFF.toast(`${s.name} is no longer checked in`);
  });
  $("#assignCancel").addEventListener("click", () => select(null));

  $("#q").addEventListener("input", renderList);
  $("#tabs").addEventListener("click", (e) => {
    if (!e.target.dataset.f) return;
    filter = e.target.dataset.f;
    for (const b of $("#tabs").children) b.classList.toggle("on", b === e.target);
    renderList();
  });
  $("#zoom").addEventListener("click", () => {
    const zoomed = $("#map").classList.toggle("zoom");
    $("#zoom").textContent = zoomed ? "Whole room" : "Zoom in";
  });
  $("#event").addEventListener("change", () => {
    eventId = $("#event").value;
    openEvent();
  });

  $("#addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { name: $("#addName").value, grade: $("#addGrade").value, category: $("#addCategory").value };
    if (await send("students", body)) {
      SFF.toast("Added " + body.name);
      e.target.reset();
    }
  });

  // ---------- roster tools ----------

  $("#seed").addEventListener("click", async () => {
    if (!confirm("Replace this fair's roster with the fake test roster?")) return;
    if (await send("seed", { simulate: false })) SFF.toast("Fake roster loaded - nobody checked in yet");
  });
  $("#simulate").addEventListener("click", async () => {
    if (!confirm("Replace this fair's roster with fake scholars, all seated at tables?")) return;
    if (await send("seed", { simulate: true })) SFF.toast("Fake roster loaded with everyone seated");
  });
  $("#reset").addEventListener("click", async () => {
    if (!confirm("Clear EVERY check-in for this fair? The roster stays.")) return;
    if (await send("reset", {})) SFF.toast("All check-ins cleared");
  });
  $("#clear").addEventListener("click", async () => {
    if (!confirm("Delete the whole roster for this fair? This cannot be undone.")) return;
    if (await send("clear", {})) SFF.toast("Roster deleted");
  });

  // Reads CSV text into a list of rows. Handles "quoted, values" too.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") (row.push(cell), (cell = ""));
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (cell || row.length) (row.push(cell), rows.push(row));
    return rows.filter((r) => r.some((v) => v.trim()));
  }

  function csvToStudents(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return [];
    const header = rows[0].map((h) => h.toLowerCase().trim());
    const col = (...names) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const iName = col("scholar name", "student name", "full name", "name");
    const iFirst = col("first");
    const iLast = col("last");
    const iGrade = col("grade");
    const iCategory = col("category", "type");
    const iTitle = col("title", "project");
    const iTable = col("table");
    const get = (r, i) => (i >= 0 && r[i] ? r[i].trim() : "");
    return rows.slice(1).map((r) => ({
      name: iFirst >= 0 && iLast >= 0 ? `${get(r, iFirst)} ${get(r, iLast)}`.trim() : get(r, iName),
      grade: get(r, iGrade).replace(/^grade\s*/i, ""),
      category: get(r, iCategory),
      title: get(r, iTitle),
      table: get(r, iTable),
    })).filter((s) => s.name);
  }

  $("#csvFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) $("#csvText").value = await file.text();
  });
  $("#csvGo").addEventListener("click", async () => {
    const rows = csvToStudents($("#csvText").value);
    if (rows.length === 0) return SFF.toast("Could not find any scholars. Is there a header row with a 'name' column?", 4500);
    if (!confirm(`Upload ${rows.length} scholars to ${layout.name}?`)) return;
    const result = await send("import", { rows, replace: $("#csvReplace").checked });
    if (result) {
      SFF.toast(`Uploaded ${result.added} scholars`);
      $("#csvText").value = "";
    }
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
