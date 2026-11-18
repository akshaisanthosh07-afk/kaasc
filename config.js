/* ============================================================
   CLUB CONFIGURATION — this is the only file you need to edit
   ============================================================ */
const CONFIG = {
  // Name shown across the site
  CLUB_NAME: "KAASC Keezhillam",

  // Short code used in member IDs (KAASC-0001). Keep it the same as ID_PREFIX in Code.gs
  ID_PREFIX: "KAASC",
  CLUB_TAGLINE: "Join our community of members",

  // Paste your Google Apps Script Web App URL here (see README.md, step 3).
  // Leave it empty to run in DEMO mode (data is kept only in this browser).
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwDgS3H3U3c3nLryzASjwQwz5SrOEZyX6wvuQjelNVvfnXSRp4WN_ukS95_WluKNz1i/exec",

  // Optional: link to your Google Sheet, shown as a button in the admin dashboard
  SHEET_URL: "https://docs.google.com/spreadsheets/d/1k3YcJZ8ZcghMXN4sTlR1lvsWYGVTRVUmTOIF22CeaMs/edit",

  // DEMO mode only (when SCRIPT_URL is empty). Not used in live mode:
  // the real admin key is ADMIN_KEY in Apps Script → Project Settings → Script Properties.
  // Left blank on purpose so the key is never visible in the public website code.
  DEMO_ADMIN_KEY: "",
};
