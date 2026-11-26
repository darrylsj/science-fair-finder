// The check-in desk: pick a scholar, tap the table they set up at.

(async () => {
  const { $ } = SFF;
  let eventId = await SFF.loadEvents($("#event"));
  let layout = null;
  let map = null;
  let students = [];
  let selectedId = null;
  let filter = "waiting";
  const wide = () => window.matchMedia("(min-width: 1000px)").matches;
  const deskName = ""; // room to record who did each check-in later; today there is one shared password

  SFF.showDemoBanner().then((config) => {
    if (config.demo) $("#qrCode").value = config.demoJudgeCode;
  });
  // Printable posters: one QR code for judges (carries the judge code), one for visitors (no code).
  $("#qrGo").addEventListener("click", () => {
    const code = $("#qrCode").value.trim();
    if (!code) return SFF.toast("Type the judge code first.");
    window.open("/poster.html#code=" + encodeURIComponent(code), "_blank");
  });
  $("#qrPublic").addEventListener("click", () => window.open("/poster.html#public", "_blank"));

  // ---------- signing in ----------

  async function trySignIn(code) {
    try {
      const result = await SFF.login(code);
      if (result.role !== "admin") throw new Error("That is the judge code. The check-in desk has its own password.");
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
      ? `${seated} of ${students.length} checked in · ${students.length - seated} waiting · ${students.filter((x) => x.judged).length} judged`
      : "No roster yet - open Roster tools below";
    const counts = {};
    for (const s of students) if (s.table) counts[s.table] = (counts[s.table] || 0) + 1;
    map.counts(counts);
    renderList();
    renderAssign();
    renderRecent();
  }

  // The last few check-ins from every desk, newest first.
  function renderRecent() {
    const list = $("#recent");
    list.innerHTML = "";
    const latest = students.filter((s) => s.table && s.checkedInAt).sort((a, b) => b.checkedInAt - a.checkedInAt).slice(0, 6);
    for (const s of latest) {
      const li = document.createElement("li");
      const minutes = Math.max(0, Math.round((Date.now() - s.checkedInAt) / 60000));
      const when = minutes < 1 ? "just now" : minutes < 60 ? minutes + " min ago" : Math.round(minutes / 60) + " h ago";
      const what = document.createElement("div");
      what.textContent = `${s.name} → table ${s.table}`;
      const who = document.createElement("span");
      who.textContent = (s.by ? s.by + " · " : "") + when;
      li.append(what, who);
      li.addEventListener("click", () => select(s.id));
      list.appendChild(li);
    }
    if (latest.length === 0) list.innerHTML = '<li><span>Nobody yet.</span></li>';
  }

  async function openEvent() {
    layout = await SFF.loadLayout(eventId);
    map = SFF.drawMap($("#map"), layout, { onTable: tableTapped, onZoom: (zoomed) => ($("#zoomAll").disabled = !zoomed) });
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
      SFF.toast("Not saved: " + error.message, 5000);
      refresh(); // put the screen back to what the server really has
      return null;
    }
  }

  // ---------- drawing ----------

  function renderList() {
    const query = $("#q").value.trim();
    let rows = query ? SFF.search(students, query) : students;
    // The tabs only narrow the list when nothing is typed. A typed search always looks at everyone,
    // so a scholar who is already checked in can still be found and moved.
    if (!query && filter === "waiting") rows = rows.filter((s) => !s.table);
    if (!query && filter === "seated") rows = rows.filter((s) => s.table);
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
      if (s.number) {
        const number = document.createElement("i");
        number.textContent = "#" + s.number;
        name.appendChild(number);
      }
      const sub = document.createElement("span");
      sub.textContent = [s.grade && "Grade " + s.grade, s.section || s.category].filter(Boolean).join(" · ");
      who.append(name, sub, SFF.judgedDots(s)); // one dot per judge who has judged this entry
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
    // (Not needed on an iPad, where the map is always showing on the right.)
    if (id && !wide()) $("#mapCard").scrollIntoView({ behavior: "smooth", block: "center" });
    // With an iPad or laptop keyboard, jump straight to the table number box (and back to search when done).
    if (wide()) (id ? $("#assignTable") : $("#q")).focus();
    if (wide() && id) $("#assignTable").select();
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
    // Show it as done right away so the desk can move on to the next scholar; the save happens behind the scenes.
    student.table = table.id;
    student.checkedInAt = Date.now();
    student.by = deskName;
    SFF.toast(`${student.name} → table ${table.id}` + (already >= table.capacity ? ` (now ${already + 1} at a table for ${table.capacity})` : ""));
    $("#q").value = "";
    select(null);
    await send("checkin", { id: student.id, table: table.id, by: deskName }); // reloads the list, or shows the error
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
  // Enter in the search box picks the first scholar in the list.
  $("#q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // otherwise the same key press also "submits" the table box we are about to jump to
    const first = $("#results li");
    if (first) first.click();
  });
  $("#tabs").addEventListener("click", (e) => {
    if (!e.target.dataset.f) return;
    filter = e.target.dataset.f;
    for (const b of $("#tabs").children) b.classList.toggle("on", b === e.target);
    renderList();
  });
  $("#zoomIn").addEventListener("click", () => map.zoomIn());
  $("#zoomOut").addEventListener("click", () => map.zoomOut());
  $("#zoomAll").addEventListener("click", () => map.wholeRoom());
  $("#event").addEventListener("change", () => {
    eventId = $("#event").value;
    openEvent();
  });

  $("#addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { name: $("#addName").value, number: $("#addNumber").value, grade: $("#addGrade").value, category: $("#addCategory").value };
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
    const iNumber = col("project number", "project #", "project id", "number", "no.", "id");
    const iGrade = col("grade");
    const iCategory = col("category", "type");
    const iTitle = col("title", "project");
    const iTable = col("table");
    const iSection = col("section", "area");
    const get = (r, i) => (i >= 0 && r[i] ? r[i].trim() : "");
    return rows.slice(1).map((r) => ({
      name: iFirst >= 0 && iLast >= 0 ? `${get(r, iFirst)} ${get(r, iLast)}`.trim() : get(r, iName),
      number: get(r, iNumber).replace(/^#/, ""),
      grade: get(r, iGrade).replace(/^grade\s*/i, ""),
      category: get(r, iCategory),
      title: get(r, iTitle),
      table: get(r, iTable),
      section: get(r, iSection),
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
