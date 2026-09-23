# Job Radar

Daily list of GTM / Business Development / Partnerships / Strategy roles at European, UK, Nordic, Australian and NZ startups
that an India-based candidate can actually apply to: remote-worldwide, remote-APAC/India, or with visa sponsorship.

- `src/seeds.mjs` holds the company list. Add names here; the weekly discovery run finds their career boards.
- `src/discover.mjs` finds which ATS (Greenhouse, Lever, Ashby, Workable, Recruitee, Personio, SmartRecruiters) each company uses → `data/companies.json`.
- `src/fetch.mjs` pulls live roles, filters and classifies them → `docs/jobs.json`.
- `docs/index.html` is the dashboard, served by GitHub Pages.
- `.github/workflows/daily.yml` runs daily at 00:30 UTC (06:00 IST), with discovery every Monday.

Run locally: `node src/discover.mjs && node src/fetch.mjs && node serve.mjs` → http://localhost:8123
