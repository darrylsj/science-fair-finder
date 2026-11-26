# Science Fair Finder

A phone-friendly web page for the Greene Scholars Program (GSP) science fair.

- **Judges** open one link, type part of a scholar's name, a project number, or a word from the project title, and see the table lit up on a map of the gym.
- **The check-in desk** (`/admin.html`) picks a scholar and taps the table they set up at. Every judge's phone updates within a second or two.

It ships with four maps, redrawn from the GSP layout drawings (the Bellarmine originals are in `docs/source-maps/`).
The map supports pinch, drag and double-tap zoom, and on an iPad held sideways the list and map sit side by side.

| Fair | Venue | Tables | Notes |
|---|---|---|---|
| 2027 | Bellarmine gym | 46 | default; draft copy of the 2026 map until the 2027 drawing exists |
| 2026 | Bellarmine gym | 46 | the reference map |
| 2025 | Bellarmine gym | 36 | numbered in a snake |
| 2023 | Emmanuel Baptist FLC | 38 | the original drawing had no table numbers, so these are made up |

All scholars in the test data are **fake** (names like "Zora Dryrun").

## What is in this folder

| Path | What it is |
|---|---|
| `public/` | The website: judge page, check-in page, maps, fake rosters |
| `src/index.js` | The small server program that runs on Cloudflare and stores check-ins |
| `tools/build_layouts.py` | **Python** - edit this to change a map or add a new year |
| `tools/make_test_roster.py` | **Python** - makes the fake scholars |
| `wrangler.jsonc` | Settings Cloudflare reads when it deploys |

## Put it on the internet (Cloudflare, free plan)

1. Sign in at <https://dash.cloudflare.com> and go to **Workers & Pages**.
2. Choose **Create**, then **Import a repository**, and connect your GitHub account.
3. Pick the `science-fair-finder` repository and press **Deploy**. Leave the build settings as they are.
4. After a minute Cloudflare shows the address, like `https://science-fair-finder.YOURNAME.workers.dev`.

From then on, every change pushed to GitHub goes live by itself.

The site starts in **test mode** (yellow banner): codes are `judge-demo` and `admin-demo`, and uploading a real roster is switched off.

### Before using real scholar names

In Cloudflare open the Worker, then **Settings > Variables and Secrets**, and add two **secrets**:

- `JUDGE_CODE` - printed in the judge packet (something like `gsp-rocket-27`)
- `ADMIN_CODE` - the check-in desk password, shared only by the one or two people entering scholars

Once both exist the yellow banner disappears, the demo codes stop working, and roster upload turns on.

Judges do not type anything: on the check-in page open **Judge QR code**, enter the judge code, and print the poster.
The QR code holds a link like this (the part after `#` never leaves the phone):

```
https://YOUR-SITE/#code=gsp-rocket-27
```

## On fair day

1. Open `/admin.html`, enter the admin code, open **Roster tools** and upload the roster CSV
   (columns: `name`, `number`, `grade`, `category`, `title`, optional `table`).
2. As each scholar sets up: find their name, tap their table on the map.
3. Judges search by name. "Not here yet" turns into a table number by itself when the scholar is checked in.

## Change a map or add a year

```
python3 tools/build_layouts.py
python3 tools/make_test_roster.py
```

Open `tools/build_layouts.py`. For 2027, replace the body of `make_2027()` with its own table list (copy `make_2026()` as a start) and move the tables to match the new drawing
(positions are in feet from the top-left corner), add it to `LAYOUTS`, run the two commands, and push to GitHub.

## Try it on your own computer (optional)

```
npm install
npm run dev
```

Then open <http://localhost:8787>.

## Good to know

- **Cost.** The free Cloudflare plan allows 100,000 requests a day. A fair with 130 judges and 140 check-ins
  should stay well under that because phones hold one live connection and only re-download the list when
  something changes. If it ever gets close, the $5/month paid plan removes the worry.
- **Privacy.** Scholar names are only sent to someone who has entered a valid code, pages ask search engines
  not to index them, and no real roster is stored in this repository. Delete the roster after the fair
  (Roster tools > Delete this roster).
- **Next ideas.** QR "you are here" signs at aisle ends, then NFC tags - see the wayfinding notes in the Claude project.
