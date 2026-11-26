# KAASC Keezhillam — Member Registration

A simple club registration website (HTML, CSS, JS) with an admin dashboard.
There's no database: every registration is saved straight into **Google Sheets** through a free Google Apps Script.

| File | What it is |
|---|---|
| `index.html` | Welcome page (share this link): club logo, **Member Registration** and **Admin Login** buttons |
| `register.html` | Registration form (Name, Aadhaar, Phone, Date of Birth) |
| `bg.jpeg` | Welcome background photo |
| `kassclogo.png` | Original club crest (full size) |
| `kassclogo-web.png` | Crest cropped and resized for the website (this is what the pages load) |
| `admin.html` | Admin dashboard: stats, search, sort, filter, CSV export |
| `config.js` | **The only file you need to edit** |
| `google-apps-script/Code.gs` | Backend code you paste into Google Sheets |

Until you connect Google Sheets the site runs in **demo mode**, where data is saved only in your browser. The admin key is set in `config.js` as `DEMO_ADMIN_KEY`.

---

## Connect Google Sheets (about 5 minutes)

### 1. Create the sheet
1. Go to <https://sheets.new> and name it, for example **KAASC Members**.
2. Copy the sheet's URL from the address bar. You'll paste it into `config.js` later as `SHEET_URL`.

### 2. Add the script
1. In the sheet, open **Extensions → Apps Script**.
2. Delete the code that's there, paste everything from `google-apps-script/Code.gs`, and click **Save**.
3. Pick `setup` in the function dropdown and click **Run**. Allow the permissions when asked.
   (If you see "Google hasn't verified this app", click *Advanced → Go to project*. It's your own script.)
   A **Members** tab with headers appears in your sheet, and a secret `AADHAAR_SECRET` is created
   under Script Properties (see "How Aadhaar numbers are protected" below).
4. Click **Project Settings** (gear icon) → **Script Properties** → **Add script property**:
   - Property: `ADMIN_KEY`
   - Value: your secret admin key. This is your dashboard password. Never write it in any file in this project.
   - Click **Save script properties**.

### 3. Deploy as a web app
1. Click **Deploy → New deployment**, click the gear icon, and choose **Web app**.
2. Set **Execute as:** *Me*, and **Who has access:** *Anyone*.
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

### 4. Update `config.js`
```js
SCRIPT_URL: "https://script.google.com/macros/s/XXXXXXXX/exec",
SHEET_URL:  "https://docs.google.com/spreadsheets/d/XXXXXXXX/edit",
```
That's it. New registrations now show up in the sheet, and `admin.html` reads them from there using your `ADMIN_KEY`.

> **If you change `Code.gs` later:** go to **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.

### Updating the script (for example, to switch on deleting members)
1. Open your sheet → **Extensions → Apps Script**.
2. Select all the code in the editor, delete it, paste the new `google-apps-script/Code.gs`, and click **Save**.
3. Pick `setup` in the function dropdown and click **Run**. It's safe to run every time you update.
   It creates `AADHAAR_SECRET` if it's missing and converts any old rows that still hold full Aadhaar numbers.
   Check the log at the bottom says how many rows it converted.
4. **Deploy → Manage deployments** → click the ✏️ pencil → **Version: New version** → **Deploy**.
   Don't choose "New deployment": that creates a different URL.

## Deleting a member
In the admin dashboard, tap the 🗑 bin icon on a member and confirm. Their row is **permanently removed** from the Google Sheet.
If you see "Delete isn't switched on yet", Apps Script is still running the old code. Follow "Updating the script" above.

---

## Hosting on Vercel

> **Connect Google Sheets first** (steps above, with `SCRIPT_URL` filled in `config.js`).
> If you deploy in demo mode, every registration is saved only on that member's own phone, and you will never see it.

This is a plain static site, so there's nothing to build. Vercel serves the files as they are.

**Option A: GitHub + Vercel (redeploys automatically when you push)**
1. Create a GitHub repository (**private** is best) and upload this folder.
2. On <https://vercel.com/new>, import the repository.
3. Set **Framework Preset:** *Other*. Leave **Build Command** and **Output Directory** empty, then click **Deploy**.

**Option B: Vercel CLI (deploy straight from this folder)**
```bash
npx vercel --prod
```
The first time, it asks you to log in and confirm the project settings. Accept the defaults.

Your link will look like `https://your-project.vercel.app`. Share that link: it opens the welcome page.
You can add your own domain later under **Project → Settings → Domains**.

What the Vercel files do:
- `vercel.json` adds security headers, hides the admin page from Google search, and caches the photo and logo so the site loads faster on repeat visits.
- `.vercelignore` keeps files that aren't part of the site out of the upload (`bg.html`, `bg_files/`, `google-apps-script/`, the full-size logo).
- `.gitignore` keeps the same junk files out of GitHub.

**After changing `config.js` or any page**, redeploy: push to GitHub (Option A) or run the command again (Option B).

To test locally, open the folder with any static server (for example `npx http-server`). Double-clicking `index.html` also works for a quick look.

## Privacy and security notes
- Aadhaar is sensitive personal data, so the full number is **never stored**. See below.
- The admin key is checked **on Google's server**, never in the website code, so viewing the page source doesn't reveal it.
- Keep the Google Sheet **private**. Don't share it with "Anyone with the link".
- The form checks Aadhaar with the official Verhoeff checksum, so typos are caught. It also blocks duplicate Aadhaar registrations and filters spam bots with a hidden honeypot field.

## How Aadhaar numbers are protected
The member types their full Aadhaar so it can be checked, but the sheet only keeps:
- **Aadhaar (last 4):** shown as `XXXX XXXX 1234` on the dashboard and in the CSV export.
- **Aadhaar Fingerprint:** a code made from the number and the secret `AADHAAR_SECRET` (HMAC-SHA256).
  The same number always gives the same code, so duplicate registrations are still blocked,
  but the code can't be turned back into the number.

Nobody, including the admin, can see a member's full Aadhaar after they register.

**Never delete or change `AADHAAR_SECRET`** in Script Properties. Without the same secret,
existing members can't be matched any more and the same Aadhaar could register twice.
Anyone with edit access to the Apps Script can read it, so keep that access to trusted people.

Other limits the script applies:
- The live "already registered?" check allows 60 lookups a minute across all visitors.
  Past that, the form just skips the early warning; pressing **Register** still blocks duplicates.
- After 5 wrong admin keys, admin login is locked for 15 minutes for everyone.
  To unlock straight away, run `unlockAdmin` from the Apps Script editor.

**After switching an existing sheet over**, old full numbers can still be found in places the script can't clean:
- **File → Version history** in the sheet. Google doesn't let you delete history, so anyone with
  edit access can still open older versions. Keep edit access to as few people as possible.
- CSV files downloaded before the change. Delete them.
