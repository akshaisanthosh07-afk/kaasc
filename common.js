/* Shared helpers: validation, formatting and API calls */

const DEMO_MODE = !CONFIG.SCRIPT_URL || !CONFIG.SCRIPT_URL.startsWith("https://");
const DEMO_STORE_KEY = "club_demo_members";

/* ---------- Aadhaar validation (Verhoeff checksum) ---------- */
const VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];

function isValidAadhaar(num) {
  if (!/^[2-9]\d{11}$/.test(num)) return false;
  let c = 0;
  const digits = num.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  }
  return c === 0;
}

function isValidPhone(num) {
  return /^[6-9]\d{9}$/.test(num);
}

function calcAge(dobStr) {
  const dob = new Date(dobStr + "T00:00:00");
  if (isNaN(dob)) return NaN;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

/* ---------- Formatting ---------- */
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
const formatAadhaar = (d) => onlyDigits(d).slice(0, 12).replace(/(\d{4})(?=\d)/g, "$1 ");
const maskAadhaar = (d) => { d = onlyDigits(d); return d ? "XXXX XXXX " + d.slice(-4) : "—"; };
const formatPhone = (d) => { d = onlyDigits(d); return d.length === 10 ? `+91 ${d.slice(0,5)} ${d.slice(5)}` : d; };

function formatDate(str) {
  if (!str) return "—";
  const d = new Date(String(str).length === 10 ? str + "T00:00:00" : str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ---------- API ----------
   Requests are sent as text/plain so the browser makes a "simple" request
   (no CORS preflight), which Google Apps Script supports. */
async function callApi(payload) {
  if (DEMO_MODE) return demoApi(payload);
  const res = await fetch(CONFIG.SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Server error (" + res.status + ")");
  return res.json();
}

/* ---------- Demo backend (localStorage) ---------- */
function demoLoad() {
  try { return JSON.parse(localStorage.getItem(DEMO_STORE_KEY)) || []; } catch { return []; }
}
function demoSave(list) {
  try { localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(list)); } catch {}
}

async function demoApi({ action, data, key, id }) {
  await new Promise((r) => setTimeout(r, 600)); // simulate network
  const list = demoLoad();
  if (action === "register") {
    if (list.some((m) => m.aadhaar === data.aadhaar)) {
      return { ok: false, code: "DUPLICATE_AADHAAR", error: "Member already registered" };
    }
    const id = `${CONFIG.CLUB_NAME.toUpperCase().replace(/\s+/g, "")}-${String(list.length + 1).padStart(4, "0")}`;
    list.push({ id, timestamp: new Date().toISOString(), ...data, age: calcAge(data.dob) });
    demoSave(list);
    return { ok: true, memberId: id };
  }
  if (action === "list") {
    if (key !== CONFIG.DEMO_ADMIN_KEY) return { ok: false, error: "Invalid admin key." };
    return { ok: true, members: list };
  }
  if (action === "delete") {
    if (key !== CONFIG.DEMO_ADMIN_KEY) return { ok: false, error: "Invalid admin key." };
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) return { ok: false, error: "Member not found. It may already be deleted." };
    list.splice(i, 1);
    demoSave(list);
    return { ok: true };
  }
  return { ok: false, error: "Unknown action" };
}

/* ---------- Shared UI ---------- */
function applyBranding() {
  document.querySelectorAll("[data-club-name]").forEach((el) => (el.textContent = CONFIG.CLUB_NAME));
  document.querySelectorAll("[data-club-tagline]").forEach((el) => (el.textContent = CONFIG.CLUB_TAGLINE));
  document.querySelectorAll("[data-club-initial]").forEach((el) => (el.textContent = CONFIG.CLUB_NAME.charAt(0)));
  if (DEMO_MODE) document.querySelectorAll(".demo-banner").forEach((el) => (el.hidden = false));
}

function toast(message, type = "info") {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");
    document.body.appendChild(wrap);
  }
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = message;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3500);
}
