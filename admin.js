/* Admin dashboard logic */
applyBranding();

const SESSION_KEY = "club_admin_key";
const state = { members: [], sortKey: "timestamp", sortDir: "desc", query: "", ageRange: "", expanded: new Set() };

const $ = (id) => document.getElementById(id);
const loginView = $("loginView");
const dashView = $("dashView");

if (CONFIG.SHEET_URL) {
  $("sheetBtn").href = CONFIG.SHEET_URL;
  $("sheetBtn").hidden = false;
}

/* ---------- Session (key kept only for this browser tab) ---------- */
const getKey = () => { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } };
const setKey = (k) => { try { k ? sessionStorage.setItem(SESSION_KEY, k) : sessionStorage.removeItem(SESSION_KEY); } catch {} };

/* ---------- Login ---------- */
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("adminKey").value.trim();
  const field = $("keyField");
  if (!key) {
    field.classList.add("is-invalid");
    $("key-msg").textContent = "Please enter the admin key.";
    return;
  }
  setLoginLoading(true);
  const ok = await loadMembers(key, true);
  setLoginLoading(false);
  if (ok) {
    setKey(key);
    showDashboard();
  }
});

$("adminKey").addEventListener("input", () => {
  $("keyField").classList.remove("is-invalid");
  $("key-msg").textContent = "";
});

function setLoginLoading(on) {
  const btn = $("loginBtn");
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  btn.querySelector(".btn-label").textContent = on ? "Checking…" : "Open dashboard";
}

function showDashboard() {
  loginView.hidden = true;
  dashView.hidden = false;
  render();
}

$("logoutBtn").addEventListener("click", () => {
  setKey(null);
  state.members = [];
  $("adminKey").value = "";
  dashView.hidden = true;
  loginView.hidden = false;
  $("adminKey").focus();
});

/* ---------- Data ---------- */
async function loadMembers(key, fromLogin = false) {
  try {
    const res = await callApi({ action: "list", key });
    if (!res.ok) throw new Error(res.error || "Could not load members.");
    state.members = (res.members || []).map((m) => ({
      ...m,
      // Only the last 4 digits are kept (an older script sent the full number: cut it here)
      aadhaarLast4: onlyDigits(m.aadhaarLast4 ?? m.aadhaar).slice(-4),
      phone: onlyDigits(m.phone),
      age: Number(m.age) || calcAge(m.dob),
    }));
    $("lastSync").textContent = `Last updated ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` +
      (DEMO_MODE ? " · demo data" : " · synced with Google Sheets");
    return true;
  } catch (err) {
    const msg = err.message === "Failed to fetch" ? "Network error. Check your connection." : err.message;
    if (fromLogin) {
      $("keyField").classList.add("is-invalid");
      $("key-msg").textContent = msg;
    } else {
      toast(msg, "error");
      if (/admin key/i.test(msg)) $("logoutBtn").click();
    }
    return false;
  }
}

$("refreshBtn").addEventListener("click", async () => {
  const btn = $("refreshBtn");
  btn.disabled = true;
  renderSkeleton();
  if (await loadMembers(getKey())) toast("Member list updated", "success");
  render();
  btn.disabled = false;
});

/* ---------- Filtering, sorting ---------- */
function visibleMembers() {
  const q = state.query.toLowerCase().trim();
  const qDigits = onlyDigits(q);
  let list = state.members.filter((m) => {
    if (state.ageRange) {
      const [min, max] = state.ageRange.split("-").map(Number);
      if (m.age < min || m.age > max) return false;
    }
    if (!q) return true;
    return (
      String(m.name).toLowerCase().includes(q) ||
      String(m.id).toLowerCase().includes(q) ||
      (qDigits && m.phone.includes(qDigits)) ||
      ((qDigits.length === 4 || qDigits.length === 12) && m.aadhaarLast4 === qDigits.slice(-4))
    );
  });
  const dir = state.sortDir === "asc" ? 1 : -1;
  const k = state.sortKey;
  list.sort((a, b) => {
    const x = a[k], y = b[k];
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y), "en", { numeric: true }) * dir;
  });
  return list;
}

$("searchInput").addEventListener("input", (e) => { state.query = e.target.value; render(); });
$("ageFilter").addEventListener("change", (e) => { state.ageRange = e.target.value; render(); });

document.querySelectorAll("th button[data-sort]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else { state.sortKey = key; state.sortDir = key === "timestamp" ? "desc" : "asc"; }
    document.querySelectorAll("th button").forEach((b) => b.classList.remove("asc", "desc"));
    btn.classList.add(state.sortDir);
    render();
  });
});

/* ---------- Rendering ---------- */
const AVATAR_COLORS = ["#4f46e5", "#0891b2", "#059669", "#db2777", "#ea580c", "#7c3aed", "#0d9488", "#2563eb"];
function avatarColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const initials = (name) => String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function renderStats() {
  const all = state.members;
  const now = new Date();
  const sameDay = (d) => d.toDateString() === now.toDateString();
  const sameMonth = (d) => d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  const dates = all.map((m) => new Date(m.timestamp)).filter((d) => !isNaN(d));
  $("statTotal").textContent = all.length;
  $("statMonth").textContent = dates.filter(sameMonth).length;
  $("statToday").textContent = dates.filter(sameDay).length;
  const ages = all.map((m) => m.age).filter((a) => !isNaN(a));
  $("statAge").textContent = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : "—";
}

function render() {
  renderStats();
  const list = visibleMembers();
  const tbody = $("tbody");
  $("resultCount").textContent = `${list.length} of ${state.members.length} members`;

  const empty = $("emptyState");
  if (!list.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
    const filtered = state.members.length > 0;
    $("emptyTitle").textContent = filtered ? "No matching members" : "No members yet";
    $("emptyText").textContent = filtered ? "Try a different search or filter." : "Registrations will appear here as soon as people sign up.";
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = list.map((m) => {
    const open = state.expanded.has(m.id);
    const ageText = isNaN(m.age) ? "" : `<span class="m-age">${m.age} yrs</span>`;
    // On phones the member cell is a button: tap to open/close the full details
    return `
      <tr class="${open ? "open" : ""}">
        <td>
          <button type="button" class="member-cell" data-toggle="${escapeHtml(m.id)}" aria-expanded="${open}">
            <span class="avatar" style="background:${avatarColor(m.name)}">${escapeHtml(initials(m.name))}</span>
            <span class="m-text">
              <strong>${escapeHtml(m.name)}</strong>
              <small>${escapeHtml(m.id)}</small>
              <small class="m-meta"><span class="m-phone">${escapeHtml(formatPhone(m.phone))}</span>${ageText}</small>
            </span>
            <svg class="m-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
        </td>
        <td class="m-only" data-label="Member ID">${escapeHtml(m.id)}</td>
        <td class="mono" data-label="Aadhaar">
          <span>${escapeHtml(maskAadhaar(m.aadhaarLast4))}</span>
        </td>
        <td class="mono" data-label="Phone"><a class="tel" href="tel:+91${escapeHtml(m.phone)}">${escapeHtml(formatPhone(m.phone))}</a></td>
        <td data-label="Date of birth">${escapeHtml(formatDate(m.dob))}</td>
        <td data-label="Age"><span class="badge">${isNaN(m.age) ? "—" : m.age}</span></td>
        <td data-label="Registered">${escapeHtml(formatDate(m.timestamp))}</td>
        <td class="td-actions">
          <button class="del-btn" data-del="${escapeHtml(m.id)}" aria-label="Delete ${escapeHtml(m.name)}" title="Delete member">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/></svg>
          </button>
        </td>
      </tr>`;
  }).join("");
}

function renderSkeleton() {
  $("emptyState").hidden = true;
  $("tbody").innerHTML = Array.from({ length: 5 }, () =>
    `<tr class="skeleton">${"<td><div></div></td>".repeat(7)}</tr>`).join("");
}

$("tbody").addEventListener("click", (e) => {
  const del = e.target.closest(".del-btn");
  if (del) return openDeleteDialog(del.dataset.del);
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const id = toggle.dataset.toggle;
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    const tr = toggle.closest("tr");
    tr.classList.toggle("open", state.expanded.has(id));
    toggle.setAttribute("aria-expanded", state.expanded.has(id));
  }
});

/* ---------- Phone view: grid (small tiles) or list (compact rows) ---------- */
const VIEW_KEY = "club_admin_view";
function setView(view) {
  if (view !== "grid" && view !== "list") view = "grid";
  const panel = $("membersPanel");
  panel.classList.toggle("view-grid", view === "grid");
  panel.classList.toggle("view-list", view === "list");
  document.querySelectorAll(".view-btn").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
  try { localStorage.setItem(VIEW_KEY, view); } catch {} // just a convenience; fine if storage is blocked
}
document.querySelectorAll(".view-btn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
setView((() => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } })());

/* ---------- Delete member ---------- */
const deleteDialog = $("deleteDialog");
let pendingDeleteId = null;

function openDeleteDialog(id) {
  const m = state.members.find((x) => x.id === id);
  if (!m) return;
  pendingDeleteId = id;
  $("delAvatar").textContent = initials(m.name);
  $("delAvatar").style.background = avatarColor(m.name);
  $("delName").textContent = m.name;
  $("delId").textContent = `${m.id} · ${formatPhone(m.phone)}`;
  $("delError").textContent = "";
  setDeleteLoading(false);
  deleteDialog.showModal();
  $("delCancel").focus(); // safe default: Enter cancels
}

function setDeleteLoading(on) {
  const btn = $("delConfirm");
  btn.disabled = on;
  $("delCancel").disabled = on;
  btn.classList.toggle("loading", on);
  btn.querySelector(".btn-label").textContent = on ? "Deleting…" : "Delete member";
}

// Tap outside the sheet closes it (unless a delete is in progress)
deleteDialog.addEventListener("click", (e) => {
  if (e.target === deleteDialog && !$("delConfirm").disabled) deleteDialog.close();
});
deleteDialog.addEventListener("cancel", (e) => {
  if ($("delConfirm").disabled) e.preventDefault();
});

$("delConfirm").addEventListener("click", async () => {
  const id = pendingDeleteId;
  const m = state.members.find((x) => x.id === id);
  if (!m) return deleteDialog.close();
  $("delError").textContent = "";
  setDeleteLoading(true);
  try {
    const res = await callApi({ action: "delete", key: getKey(), id });
    if (!res.ok) throw new Error(res.error || "Could not delete member.");
    state.members = state.members.filter((x) => x.id !== id);
    deleteDialog.close();
    render();
    toast(`${m.name} was deleted`, "success");
  } catch (err) {
    setDeleteLoading(false);
    let msg = err.message === "Failed to fetch" ? "Network error. Check your connection." : err.message;
    // The Google Script on the server is still the old version without delete
    if (/unknown action/i.test(msg)) msg = "Delete isn't switched on yet. Update the Google Apps Script code (see README).";
    if (/not found/i.test(msg)) { deleteDialog.close(); toast(msg, "error"); $("refreshBtn").click(); }
    else if (/admin key/i.test(msg)) { deleteDialog.close(); toast(msg, "error"); $("logoutBtn").click(); }
    else $("delError").textContent = msg; // dialog stays open; show the error inside it
  }
});

/* ---------- CSV export ---------- */
$("exportBtn").addEventListener("click", () => {
  const list = visibleMembers();
  if (!list.length) return toast("Nothing to export", "error");
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Member ID", "Name", "Aadhaar (last 4)", "Phone", "Date of Birth", "Age", "Registered On"],
    ...list.map((m) => [m.id, m.name, maskAadhaar(m.aadhaarLast4), "'" + m.phone, m.dob, m.age, new Date(m.timestamp).toLocaleString("en-IN")]),
  ];
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${CONFIG.ID_PREFIX}-members-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---------- Auto-login if this tab already has a key ---------- */
(async () => {
  const key = getKey();
  if (!key) return $("adminKey").focus();
  loginView.hidden = true;
  dashView.hidden = false;
  renderSkeleton();
  if (await loadMembers(key)) render();
})();
