# DM Puram election tool

A phone-friendly, multi-user web app for the D.M. Puram gram panchayat Sarpanch election:
voter search, door-to-door canvassing, poll-day turnout marking and a live dashboard.
Telugu and English.

> **Privacy.** This repository is public. It holds only the app's code.
> The voter list, photos and everything your team records live in your private Supabase project,
> behind logins. Never commit the `data/` folder, the PDF or any export (`.gitignore` blocks them).
> Use the data only for lawful campaigning.

## What it does

| Who | Can do |
| --- | --- |
| **Admin** | Everything: add team logins, choose which hamlets each person covers, correct roll details, download CSV, see team activity. |
| **Area in-charge** | Work on voters in their hamlets and assign voters to workers. |
| **Worker** | Work on voters in their hamlets (or assigned to them): support level, contacted, phone, notes, transport, mark voted. They cannot change the printed roll details. |

- **Voters tab:** search by Telugu or English name (`laxmi`, `lakshmi` and `లక్ష్మి` all work), serial no., house no. or voter ID; filter by hamlet, support, status (not contacted, ours not voted yet, needs transport, …).
- **Voter page:** photo and roll details, support level (Ours sure / Likely ours / Undecided / Other side / Not known), contacted, phone with call button, notes, needs transport, lives outside, family members at the same house, change history.
- **Poll day tab:** number pad to type the serial from the voter slip and mark *Voted* in two taps; a list of our supporters who have not voted yet (to call or fetch); optional quick ✓ buttons in lists.
- **Dashboard:** totals, contact progress, support split, turnout and "ours who voted" by hamlet. Refreshes live on poll day.
- Every change is logged with who made it and when.

## The voter data

`scripts/extract/` turns the scanned roll PDF (2,127 voters, 81 pages, Telugu) into `voters.json`,
`hamlets.json` and one photo per voter, using Tesseract OCR:

- Serial, ward, hamlet, gender (exactly the official 1,070 men / 1,057 women), age, house no. and voter ID are read per card.
- Names are OCR'd Telugu and mostly right. Records the OCR was unsure about are marked **Check details**
  (filter: *Any status → Check details*). An admin can fix them on the voter page under *Correct roll details*.

The ready-made data is in the project files as `voter-data/dm-puram-voter-data.zip` (not in GitHub).

## Setup (about 30 minutes, free)

### 1. Supabase (database, logins, photos)
1. Create a free account at <https://supabase.com> and a **New project** (region: Mumbai / `ap-south-1`). Save the database password somewhere safe.
2. **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), **Run**.
3. **Authentication → Sign In / Providers → Email:** turn **off** "Confirm email" (team logins use usernames, not real emails). Also turn **off** "Allow new users to sign up", so only the admin can create logins.
4. **Edge Functions → Deploy a new function → Via editor**, name it `admin-users`, paste [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts), **Deploy**. (This lets you add team logins from inside the app.)
5. **Project Settings → API**: note the **Project URL**, the **anon / publishable** key and the **service_role / secret** key. The service_role key is a master key: never put it in the website or share it.

### 2. Load the voters (on your computer, needs Node.js 20.12+)
```bash
git clone https://github.com/Din8shh/DM-puram-elections.git
cd DM-puram-elections
npm install
# unzip dm-puram-voter-data.zip into a folder named data/  (data/voters.json, data/photos/…)
```
Create a file `.env` in that folder:
```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_USERNAME=dinesh
ADMIN_PASSWORD=choose-a-strong-password
```
Then run `npm run import`. It creates your admin login, the 10 hamlets, 2,127 voters and uploads the photos.
Running it again is safe: campaign data (support, notes, voted…) is never overwritten.

### 3. Website (Netlify)
1. Edit [`web/config.js`](web/config.js): set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the public anon key, **not** service_role). Commit and push.
2. At <https://app.netlify.com>: **Add new site → Import an existing project → GitHub → DM-puram-elections**. Netlify reads `netlify.toml` (publish folder `web`, no build). Deploy.
3. Open the site on your phone, sign in with the admin username/password, then go to **Team** to add in-charges and workers and tick their hamlets.
   Workers can "Add to Home screen" for an app-like icon.

### Before poll day
- Ask every worker to sign in once beforehand and test marking on a dummy (then *Undo voted*).
- Keep the Dashboard open on one phone for live turnout.

## Development
- Plain HTML/CSS/JS in `web/` (no build step). `npm run serve` serves it locally on port 8080.
- Database rules and triggers: `supabase/schema.sql` (row level security keeps each worker to their hamlets; a trigger stops non-admins changing roll details and logs every change).
- Re-extracting from the PDF: see the docstring in `scripts/extract/build_voters.py`; `extract.py` expects the page images from `pdfimages -j` in `raw/` and Tesseract `tel` + `eng` models in `scripts/extract/tessdata/`.
