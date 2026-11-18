/**
 * Club Registration — Google Apps Script backend
 * ------------------------------------------------
 * Paste this whole file into Extensions → Apps Script of your Google Sheet.
 * Set your admin key in Project Settings → Script Properties:
 *     Property: ADMIN_KEY     Value: <your secret key>
 * Then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * See README.md for step-by-step instructions.
 */

const SHEET_NAME = 'Members';
const ID_PREFIX = 'KAASC';    // Member IDs look like KAASC-0001
const HEADERS = ['Member ID', 'Registered On', 'Name', 'Aadhaar', 'Phone', 'Date of Birth', 'Age'];

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
    if (body.action === 'register') return json(register(body.data || {}));
    if (body.action === 'list') return json(listMembers(body.key));
    if (body.action === 'delete') return json(deleteMember(body.key, body.id));
    return json({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
}

/* ---------- Actions ---------- */
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

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet();
    const last = sheet.getLastRow();

    // Prevent duplicate Aadhaar registrations
    if (last > 1) {
      const existing = sheet.getRange(2, 4, last - 1, 1).getValues();
      if (existing.some(function (r) { return String(r[0]).replace(/\D/g, '') === aadhaar; })) {
        return { ok: false, error: 'This Aadhaar number is already registered.' };
      }
    }

    const props = PropertiesService.getScriptProperties();
    const next = Number(props.getProperty('NEXT_ID') || last) + 1;
    props.setProperty('NEXT_ID', String(next));
    const memberId = ID_PREFIX + '-' + ('0000' + next).slice(-4);

    // Leading apostrophe keeps numbers/dates stored as plain text
    sheet.appendRow([memberId, new Date(), name, "'" + aadhaar, "'" + phone, "'" + dob, age]);
    return { ok: true, memberId: memberId };
  } finally {
    lock.releaseLock();
  }
}

/** Returns an error response if the admin key is wrong, otherwise null. */
function checkAdmin(key) {
  const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!adminKey) return { ok: false, error: 'Admin key is not set up yet. Add ADMIN_KEY in Script Properties.' };
  if (!key || String(key) !== adminKey) {
    Utilities.sleep(800); // slow down guessing
    return { ok: false, error: 'Invalid admin key.' };
  }
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

  const rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
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
        aadhaar: String(r[3]),
        phone: String(r[4]),
        dob: dob,
        age: calcAge(dob),
      };
    });
  return { ok: true, members: members };
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

/* Run this once from the editor to create the sheet and test permissions. */
function setup() {
  getSheet();
  Logger.log('Sheet ready. Now set ADMIN_KEY in Project Settings → Script Properties.');
}
