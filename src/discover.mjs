// Weekly: work out which ATS (and slug) each seed company uses.
// Output: data/companies.json  [{ name, country, ats, slug, jobs }]
import fs from "node:fs";
import { SEEDS, BLOCK } from "./seeds.mjs";
import { ATS, pool, norm } from "./lib.mjs";

const ORDER = ["greenhouse", "ashby", "lever", "workable", "recruitee", "personio", "smartrecruiters"];

function candidates(name, explicit) {
  const n = norm(name);
  const set = new Set(explicit ? explicit.split(",") : []);
  set.add(n.replace(/ /g, ""));
  set.add(n.replace(/ /g, "-"));
  return [...set].filter(Boolean);
}

// Guard against generic slugs matching an unrelated company:
// the company's name must appear in the board's company name or in a job ad.
function verified(name, res, ats) {
  const key = norm(name).split(" ").filter((w) => w.length >= 3)[0] || norm(name);
  if (res.companyName && norm(res.companyName).includes(key)) return true;
  const sample = res.jobs.slice(0, 5).map((j) => {
    const m = ATS[ats].map(j);
    return norm(m.text + " " + m.url);
  }).join(" ");
  return sample.includes(key);
}

const seen = new Set();
const entries = [];
for (const [country, list] of Object.entries(SEEDS)) {
  for (const raw of list) {
    const [name, slugs] = raw.split("|");
    if (BLOCK.has(name) || seen.has(norm(name))) continue;
    seen.add(norm(name));
    entries.push({ name, country, slugs: candidates(name, slugs) });
  }
}
console.log(`Discovering ATS for ${entries.length} companies…`);

let done = 0;
const results = await pool(entries, 24, async (e) => {
  let best = null;
  for (const ats of ORDER) {
    for (const slug of e.slugs) {
      const res = await ATS[ats].load(slug);
      if (!res.exists || !res.jobs.length) continue;
      if (!verified(e.name, res, ats)) continue;
      if (!best || res.jobs.length > best.jobs) best = { name: e.name, country: e.country, ats, slug, jobs: res.jobs.length };
    }
    if (best) break; // first ATS with a verified board wins
  }
  if (++done % 50 === 0) console.log(`  ${done}/${entries.length}`);
  return best;
});

const found = results.filter(Boolean);
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/companies.json", JSON.stringify(found, null, 1));
const byAts = found.reduce((a, r) => ((a[r.ats] = (a[r.ats] || 0) + 1), a), {});
console.log(`Resolved ${found.length}/${entries.length} companies`, byAts);
