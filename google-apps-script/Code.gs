/**
 * Club Registration — Google Apps Script backend
 * ------------------------------------------------
 * Paste this whole file into Extensions → Apps Script of your Google Sheet.
 * Set your admin key in Project Settings → Script Properties:
 *     Property: ADMIN_KEY     Value: <your secret key>
 * Then run `setup` once from the editor, and
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * See README.md for step-by-step instructions.
 *
 * Aadhaar privacy: the full Aadhaar number is never stored. The sheet keeps
 *   - the last 4 digits (to tell members apart), and
 *   - a fingerprint (HMAC-SHA256 with the secret AADHAAR_SECRET script property),
 *     used only to block duplicate registrations. It can't be turned back into the number.
 * NEVER delete or change AADHAAR_SECRET once members are registered:
 * without it, existing members can no longer be matched and duplicates get through.
 */

const SHEET_NAME = 'Members';
const ID_PREFIX = 'KAASC';    // Member IDs look like KAASC-0001
const HEADERS = ['Member ID', 'Registered On', 'Name', 'Aadhaar (last 4)', 'Phone', 'Date of Birth', 'Age', 'Aadhaar Fingerprint'];
const COL_LAST4 = 4;
const COL_FINGERPRINT = 8;

// Live "already registered?" lookups allowed per minute (all visitors together)
const CHECK_LIMIT_PER_MINUTE = 60;
// Wrong admin keys allowed before admin login is locked, and for how long
const ADMIN_MAX_FAILS = 5;
const ADMIN_LOCK_SECONDS = 15 * 60;

/* ---------- Entry points ---------- */
function doGet() {
  return json({ ok: true, message: 'Club registration API is running.' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'Invalid request.' });
  }
  try {
    if (body.action === 'check') return json(checkAadhaar(body.aadhaar));
    if (body.action === 'register') return json(register(body.data || {}));
    if (body.action === 'list') return json(listMembers(body.key));
    if (body.action === 'delete') return json(deleteMember(body.key, body.id));
    return json({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    console.error(err && err.message); // never log request bodies: they contain Aadhaar numbers
    return json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
}

/* ---------- Actions ---------- */

/** Used by the form while the member types, so it can warn before they press Register. */
function checkAadhaar(aadhaar) {
  aadhaar = String(aadhaar || '').replace(/\D/g, '');
  if (!isValidAadhaar(aadhaar)) return { ok: false, error: 'Please enter a valid Aadhaar number.' };
  // Limit lookups so this can't be used to test lots of numbers.
  // The form treats this as "couldn't check"; the check on Register still blocks duplicates.
  if (!allowCheck()) return { ok: false, code: 'RATE_LIMITED', error: 'Too many checks. Please try again shortly.' };
  const fp = aadhaarFingerprint(aadhaar);
  if (!fp) return notSetUp();
  return { ok: true, registered: isAadhaarRegistered(getSheet(), aadhaar, fp) };
}

/** True if this Aadhaar is already in the sheet (matched by fingerprint). */
function isAadhaarRegistered(sheet, aadhaar, fp) {
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const rows = sheet.getRange(2, COL_LAST4, last - 1, COL_FINGERPRINT - COL_LAST4 + 1).getValues();
  const iFp = COL_FINGERPRINT - COL_LAST4;
  return rows.some(function (r) {
    if (String(r[iFp]) === fp) return true;
    // Old row that `setup` hasn't converted yet (still holds the full number)
    return String(r[0]).replace(/\D/g, '') === aadhaar;
  });
}

function register(data) {
  const name = String(data.name || '').trim().replace(/\s+/g, ' ');
  const aadhaar = String(data.aadhaar || '').replace(/\D/g, '');
  const phone = String(data.phone || '').replace(/\D/g, '');
  const dob = String(data.dob || '');

  // Server-side validation (never trust the browser alone)
  if (name.length < 3 || name.length > 80 || !/^[A-Za-z][A-Za-z .'-]*$/.test(name)) {
    return { ok: false, error: 'Please enter a valid name.' };
  }
  if (!isValidAadhaar(aadhaar)) return { ok: false, error: 'Please enter a valid Aadhaar number.' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'Please enter a valid 10-digit mobile number.' };
  const age = calcAge(dob);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(age) || age < 0 || age > 120) {
    return { ok: false, error: 'Please enter a valid date of birth.' };
  }

  // Refuse rather than store the number unprotected
  const fp = aadhaarFingerprint(aadhaar);
  if (!fp) return notSetUp();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet();
    const last = sheet.getLastRow();

    // Aadhaar must be unique: one membership per Aadhaar number.
    // Checked inside the lock, so two people submitting at once can't both get through.
    if (isAadhaarRegistered(sheet, aadhaar, fp)) {
      return { ok: false, code: 'DUPLICATE_AADHAAR', error: 'Member already registered' };
    }

    const props = PropertiesService.getScriptProperties();
    const next = Number(props.getProperty('NEXT_ID') || last) + 1;
    props.setProperty('NEXT_ID', String(next));
    const memberId = ID_PREFIX + '-' + ('0000' + next).slice(-4);

    // Leading apostrophe keeps numbers/dates stored as plain text
    sheet.appendRow([memberId, new Date(), name, "'" + aadhaar.slice(-4), "'" + phone, "'" + dob, age, "'" + fp]);
    return { ok: true, memberId: memberId };
  } finally {
    lock.releaseLock();
  }
}

/** Returns an error response if the admin key is wrong or login is locked, otherwise null. */
function checkAdmin(key) {
  const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!adminKey) return { ok: false, error: 'Admin key is not set up yet. Add ADMIN_KEY in Script Properties.' };

  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails') || 0);
  if (fails >= ADMIN_MAX_FAILS) {
    return { ok: false, code: 'LOCKED', error: 'Too many wrong admin keys. Admin login is locked for 15 minutes.' };
  }
  if (!key || String(key) !== adminKey) {
    cache.put('admin_fails', String(fails + 1), ADMIN_LOCK_SECONDS);
    Utilities.sleep(800); // slow down guessing
    return { ok: false, error: 'Invalid admin key.' };
  }
  if (fails) cache.remove('admin_fails');
  return null;
}

/** Permanently removes one member's row, found by Member ID. Admin only. */
function deleteMember(key, id) {
  const denied = checkAdmin(key);
  if (denied) return denied;
  id = String(id || '').trim();
  if (!id) return { ok: false, error: 'No member selected.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet();
    const last = sheet.getLastRow();
    if (last < 2) return { ok: false, error: 'Member not found. It may already be deleted.' };
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) {
        sheet.deleteRow(i + 2);
        return { ok: true };
      }
    }
    return { ok: false, error: 'Member not found. It may already be deleted.' };
  } finally {
    lock.releaseLock();
  }
}

function listMembers(key) {
  const denied = checkAdmin(key);
  if (denied) return denied;

  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, members: [] };

  const rows = sheet.getRange(2, 1, last - 1, 7).getValues();
  const members = rows
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      const dob = r[5] instanceof Date
        ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r[5]);
      return {
        id: String(r[0]),
        timestamp: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
        name: String(r[2]),
        aadhaarLast4: String(r[3]).replace(/\D/g, '').slice(-4), // only ever the last 4
        phone: String(r[4]),
        dob: dob,
        age: calcAge(dob),
      };
    });
  return { ok: true, members: members };
}

/* ---------- Aadhaar protection ---------- */

/** HMAC-SHA256 of the Aadhaar number with the secret key, as hex. Null if the secret is missing. */
function aadhaarFingerprint(aadhaar) {
  const secret = PropertiesService.getScriptProperties().getProperty('AADHAAR_SECRET');
  if (!secret) return null;
  const bytes = Utilities.computeHmacSha256Signature(aadhaar, secret);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function notSetUp() {
  return { ok: false, error: 'Registration is not set up yet. Please contact the club.' };
}

/** Counts live lookups per minute, for all visitors together. */
function allowCheck() {
  const cache = CacheService.getScriptCache();
  const k = 'checks_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), 120);
  return n <= CHECK_LIMIT_PER_MINUTE;
}

/** Creates AADHAAR_SECRET if it doesn't exist. Never replaces an existing one. */
function ensureAadhaarSecret() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('AADHAAR_SECRET')) return false;
  props.setProperty('AADHAAR_SECRET', Utilities.getUuid() + Utilities.getUuid());
  return true;
}

/**
 * Converts old rows that still hold the full Aadhaar number:
 * writes the fingerprint, then replaces the number with its last 4 digits.
 * Safe to run more than once.
 */
function migrateAadhaar() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet();
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#4f46e5').setFontColor('#ffffff');
    const last = sheet.getLastRow();
    if (last < 2) return 0;
    const range = sheet.getRange(2, COL_LAST4, last - 1, COL_FINGERPRINT - COL_LAST4 + 1);
    const rows = range.getValues();
    const iFp = COL_FINGERPRINT - COL_LAST4;
    let converted = 0;
    rows.forEach(function (r) {
      const digits = String(r[0]).replace(/\D/g, '');
      if (digits.length !== 12) return; // already converted (or empty)
      const fp = aadhaarFingerprint(digits);
      if (!fp) throw new Error('AADHAAR_SECRET is missing.');
      r[iFp] = "'" + fp;
      r[0] = "'" + digits.slice(-4);
      converted++;
    });
    if (converted) range.setValues(rows);
    return converted;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Helpers ---------- */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold').setBackground('#4f46e5').setFontColor('#ffffff');
    sheet.setColumnWidths(1, HEADERS.length, 150);
  }
  return sheet;
}

function calcAge(dobStr) {
  const p = String(dobStr).split('-').map(Number);
  if (p.length !== 3 || p.some(isNaN)) return NaN;
  const now = new Date();
  let age = now.getFullYear() - p[0];
  const m = now.getMonth() + 1 - p[1];
  if (m < 0 || (m === 0 && now.getDate() < p[2])) age--;
  return age;
}

const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
function isValidAadhaar(num) {
  if (!/^[2-9]\d{11}$/.test(num)) return false;
  let c = 0;
  const d = num.split('').reverse().map(Number);
  for (let i = 0; i < d.length; i++) c = VD[c][VP[i % 8][d[i]]];
  return c === 0;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Run these from the editor ---------- */

/**
 * Run once after pasting this code (safe to run again):
 * creates the sheet, creates AADHAAR_SECRET if missing, and converts old rows.
 */
function setup() {
  getSheet();
  const created = ensureAadhaarSecret();
  const converted = migrateAadhaar();
  Logger.log((created ? 'Created AADHAAR_SECRET (never delete or change it). ' : 'AADHAAR_SECRET already set. ') +
    'Converted ' + converted + ' old row(s) to last 4 digits + fingerprint.');
  if (!PropertiesService.getScriptProperties().getProperty('ADMIN_KEY')) {
    Logger.log('Now set ADMIN_KEY in Project Settings → Script Properties.');
  }
}

/** If admin login got locked by wrong keys, run this to unlock it straight away. */
function unlockAdmin() {
  CacheService.getScriptCache().remove('admin_fails');
  Logger.log('Admin login unlocked.');
}
