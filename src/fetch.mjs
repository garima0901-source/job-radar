// Daily: pull live roles, keep GTM / BD / partnerships / strategy roles an India-based
// candidate can actually get (remote-worldwide, remote-APAC/India, or visa-sponsored),
// posted in the last 30 days. Writes docs/jobs.json for the dashboard.
import fs from "node:fs";
import { ATS, get, pool, norm, stripHtml } from "./lib.mjs";

const MAX_AGE_DAYS = 30;
const NOW = Date.now();
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- role filters
const FAMILY = [
  ["Partnerships", /partnerships?\b|\bpartner (manager|management|success|marketing|sales|development|lead|operations|account|program|ecosystem|enablement|growth|acquisition|strategy)|\balliances?\b|\bchannel (manager|partner|sales|lead|account|development)|\becosystem\b|\baffiliate (manager|lead|partnership)|\breseller\b|\bhead of partners\b/],
  ["Business Development", /business development|\bbiz ?dev\b|\bbd (manager|lead|director|associate|executive)|\bnew business\b|market (development|expansion|entry|launch)|\bexpansion (manager|lead|associate)|\bcountry (manager|launch|lead)|\blaunch (manager|lead)|\bcity (manager|launcher|lead)|corporate development|\bcorp ?dev\b|\bm&a\b|commercial (manager|lead|director|strategy|partnerships|development)|\bstrategic accounts? manager/],
  ["GTM", /go[- ]to[- ]market|\bgtm\b|revenue (strategy|operations)|\brevops\b|sales strategy|commercial (excellence|operations)|\bgrowth (manager|lead|strategist|associate)|\bmarket(s)? lead\b/],
  ["Strategy", /\bstrateg(y|ic|ist)\b|\bbizops\b|business operations|strategy (&|and) (operations|ops)|\bchief of staff\b|founder'?s'? (associate|office)|founders? associate|special projects|\bventure (lead|associate|builder)\b|\bentrepreneur in residence\b/],
];
const TITLE_EXCLUDE = /engineer|developer|architect|scientist|designer|devops|\bsre\b|recruit|talent|\bpeople\b|\bhr\b|human resources|payroll|legal|counsel|lawyer|paralegal|accountant|accounting|bookkeep|\btax\b|audit|clinical|nurse|physician|doctor|teacher|tutor|content (strategist|writer)|\bseo\b|social media|brand strategist|creative|copywrit|media buyer|customer support|support (agent|specialist)|customer success|\bsdr\b|\bbdr\b|sales development|representative|\bcall ?cent|telesales|cold call|\bdriver\b|warehouse|technician|finance business partner|hr business partner|people partner|data (strateg|analyst)|security|cloud|infrastructure|product designer|ux|ui\b|design strateg|marketing strateg|performance marketing|growth strategist|strategic finance|finance (&|and) strategy|professional services|strategic accounts?|don.?t see|general application|open application|talent (pool|community)|spontaneous|future opportunit/;
// A region in the title, e.g. "BD Manager (Remote, Europe)", overrides a blank "worldwide" location field
const TITLE_REGION = /\b(europe|emea|eu|eea|dach|nordics?|benelux|uk|us|usa|north america|americas|latam|germany|france|spain|italy|netherlands|poland|canada|australia|anz)\b/;
const JUNIOR = /\bintern(ship)?\b|working student|werkstudent|\btrainee\b|graduate|\bjunior\b|\bjr\.?\b|entry[- ]level|apprentice|praktik|\bstage\b|alternance|\bthesis\b|student|\bassistant\b/;
const TOO_SENIOR = /\b(vp|svp|evp|avp)\b|vice[- ]president|\bchief (?!of staff)|\bc[terfm]o\b|\bcro\b|managing director|general manager|senior director|global head|\bpresident\b|\bfounder\b(?!'?s'? (associate|office))|\bco-?founder\b/;
const STRETCH = /\bdirector\b|\bhead of\b|\bhead,|\bprincipal\b/;

function classifyTitle(title) {
  const t = norm(title).replace(/ and /g, " & ");
  // "Chief of Staff to the CEO" / "Associate to the Founders" describe who you report to, not your level
  const raw = title.toLowerCase().replace(/\b(to|for) (the )?(ceo|cto|coo|cfo|cro|cco|founders?|co-?founders?|leadership team)\b.*/, "");
  if (TITLE_EXCLUDE.test(raw) || JUNIOR.test(raw) || TOO_SENIOR.test(raw)) return null;
  const fam = FAMILY.filter(([, re]) => re.test(raw) || re.test(t)).map(([f]) => f);
  if (!fam.length) return null;
  return { families: fam, level: STRETCH.test(raw) ? "Stretch (Head/Director)" : "Target (4–7 yrs)" };
}

// ---------------------------------------------------------------- geography
const EUROPE = ["united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "london", "manchester", "edinburgh", "bristol", "cambridge", "oxford", "leeds", "glasgow", "belfast",
  "ireland", "dublin", "cork", "germany", "deutschland", "berlin", "munich", "münchen", "hamburg", "frankfurt", "cologne", "köln", "stuttgart", "düsseldorf", "leipzig",
  "france", "paris", "lyon", "marseille", "toulouse", "bordeaux", "nantes", "lille", "netherlands", "amsterdam", "rotterdam", "utrecht", "the hague", "eindhoven",
  "belgium", "brussels", "antwerp", "ghent", "luxembourg", "switzerland", "zurich", "zürich", "geneva", "lausanne", "basel", "zug", "austria", "vienna", "wien", "graz", "linz",
  "sweden", "stockholm", "gothenburg", "malmö", "malmo", "norway", "oslo", "bergen", "trondheim", "denmark", "copenhagen", "aarhus", "finland", "helsinki", "espoo", "tampere", "iceland", "reykjavik",
  "spain", "madrid", "barcelona", "valencia", "malaga", "málaga", "portugal", "lisbon", "porto", "italy", "milan", "milano", "rome", "turin", "poland", "warsaw", "krakow", "kraków", "wroclaw", "wrocław",
  "czech", "prague", "brno", "slovakia", "bratislava", "hungary", "budapest", "romania", "bucharest", "cluj", "bulgaria", "sofia", "greece", "athens", "croatia", "zagreb", "slovenia", "ljubljana",
  "estonia", "tallinn", "latvia", "riga", "lithuania", "vilnius", "cyprus", "limassol", "nicosia", "malta", "serbia", "belgrade", "europe", "emea", "eu"];
const ANZ = ["australia", "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "hobart", "new zealand", "auckland", "wellington", "christchurch", "anz"];
const INDIA = /\bindia\b|bangalore|bengaluru|mumbai|new delhi|\bdelhi\b|gurgaon|gurugram|hyderabad|\bpune\b|chennai|noida|kolkata|ahmedabad/;
const APAC = /\bapac\b|\basia\b|asia[- ]pacific|\bapj\b|\bsouth asia\b/;
const wordRe = (list) => new RegExp(`(^|[^a-z])(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})([^a-z]|$)`);
const EUROPE_RE = wordRe(EUROPE);
const ANZ_RE = wordRe(ANZ);
const US_ONLY = /\b(us|usa|u\.s\.|united states|canada|north america|americas|latam|na)\b|new york|san francisco|\bnyc\b|remote[- ,(]*(us|usa|united states)/;

function region(loc, hqCountry) {
  const l = (loc || "").toLowerCase();
  if (ANZ_RE.test(l)) return "ANZ";
  if (EUROPE_RE.test(l)) return "Europe/UK";
  if (!l.trim() || /^remote$/.test(l.trim())) return hqCountry === "Australia" || hqCountry === "New_Zealand" ? "ANZ" : hqCountry ? "Europe/UK" : "";
  return "";
}

// ---------------------------------------------------------------- eligibility signals (ad text)
const WORLDWIDE_LOC = /anywhere|worldwide|world ?wide|\bglobal(ly)?\b|international|any location|all locations|any country|all countries|all time ?zones|distributed/;
const WORLDWIDE_TXT = /(work|working|remote|hire|hiring|based|live|join us) (from )?anywhere( in the world)?|from anywhere in the world|regardless of (your )?(location|where you live)|location[- ]independent|open to (candidates|applicants|talent) (from )?(all over the world|worldwide|globally|anywhere|any country)|we hire (globally|worldwide|anywhere|in any country)|(remote|hire)[- ]anywhere|anywhere in the world|work from any country|fully remote,? (globally|worldwide)/;
const RESTRICTED_TXT = /(must|need to|required to|should|have to) (currently )?(be )?(based|located|resid(e|ing)|living|live) (in|within) (the )?(?!india|asia|apac|any)|(only|exclusively) (accept|consider|hire|hiring) (candidates|applicants) (based |located |residing )?(in|from) (?!india|asia|apac)|\b(us|uk|eu|eea|u\.s\.)[- ]based (candidates )?only|this (role|position) is (only )?open to (candidates|residents) (based )?in (?!india|asia|apac)/;
const SPONSOR_POS = /visa sponsorship (is )?(available|provided|offered|possible|support)|sponsor(ship)? (for )?(your |a |the )?(work )?(visa|permit)|we (can|will|do|are able to|are happy to|'ll) (offer |provide )?(visa )?sponsor|(offer|provide|including|incl\.?|with) (visa )?sponsorship|relocation (support|package|assistance|bonus|budget|allowance|help)|relocation (is )?(offered|provided|available|covered|supported)|(help|support) (you )?(with )?(your )?relocat|blue card|skilled worker visa|global talent visa|visa (support|assistance|processing|and relocation)|support (with |for )?(your )?(visa|work permit)|work permit (support|assistance)|immigration (support|assistance)|we sponsor|sponsorship (available|provided|offered|is available)|open to sponsoring/;
const SPONSOR_NEG = /(not|unable to|cannot|can't|can not|won'?t|will not|do not|don'?t|are not able to|aren'?t able to|no|without)( currently)? (offer(ing)? |provide |provid(e|ing) )?(any )?(visa |work permit |immigration )?sponsor|sponsorship (is |will )?(not|unavailable)|not (able|in a position) to (offer |provide )?(visa )?sponsor|no visa|must (already )?(have|hold|possess) (the |a |an )?(full |existing |valid |current |legal )?(right|authori[sz]ation|eligibility|permission|permit|visa) to (work|live)|must (already )?(be )?(legally )?(authori[sz]ed|eligible|entitled|permitted) to work|existing right to work|valid (work|working) (permit|visa|authori[sz]ation) (is )?(required|needed|mandatory)|(eu|eea|us|uk|swiss|australian|nz) (citizens?|residents?|passport|work permit)(ship)? (only|required|is required)|relocation (is |will )?not (be )?(offered|provided|available|possible|supported)|no relocation|not offer relocation|without (the need for )?(visa )?sponsorship|(citizens?|permanent residents?) (or|and) (permanent )?(residents?|citizens?|visa holders?) only|right to work in (the )?(uk|australia|new zealand|germany|eu|netherlands|ireland) (is )?(required|essential|needed)|security clearance|sc clearance/;

const snippet = (text, re) => {
  const m = re.exec(text);
  if (!m) return "";
  const s = Math.max(0, m.index - 90), e = Math.min(text.length, m.index + m[0].length + 90);
  return (s ? "…" : "") + text.slice(s, e).trim() + (e < text.length ? "…" : "");
};

// ---------------------------------------------------------------- sponsor registers
async function loadRegisters() {
  const reg = { UK: new Set(), NL: new Set() };
  try {
    const { data: page } = await get("https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers", { type: "text" });
    const csvUrl = page?.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"]+\.csv/)?.[0];
    if (csvUrl) {
      const { data: csv } = await get(csvUrl, { type: "text", timeout: 90000 });
      for (const line of (csv || "").split("\n").slice(1)) {
        const name = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : line.split(",")[0];
        if (name) reg.UK.add(companyKey(name));
      }
    }
  } catch {}
  try {
    const { data: html } = await get("https://ind.nl/en/public-register-recognised-sponsors/public-register-regular-labour-and-highly-skilled-migrants", { type: "text", timeout: 60000 });
    for (const m of (html || "").matchAll(/<th scope="row">([^<]+)<\/th>/g)) reg.NL.add(companyKey(m[1]));
  } catch {}
  console.log(`Sponsor registers: UK ${reg.UK.size}, NL ${reg.NL.size}`);
  return reg;
}
const SUFFIX = /\b(ltd|limited|plc|llp|llc|inc|gmbh|ag|sa|sas|sarl|bv|b v|nv|ab|as|asa|aps|oy|oyj|srl|spa|pty|holdings?|group|uk|europe|international|technologies|technology|tech|services|operations|trading as .*|t a .*)\b/g;
const companyKey = (n) => norm(n).replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
function onRegister(set, company) {
  const k = companyKey(company);
  if (!k || !set.size) return false;
  if (set.has(k)) return true;
  if (k.length < 5) return false;
  for (const r of set) if (r.startsWith(k + " ")) return true;
  return false;
}

// ---------------------------------------------------------------- sources
async function fromCompanies() {
  const companies = JSON.parse(fs.readFileSync("data/companies.json", "utf8"));
  const out = [];
  await pool(companies, 16, async (c) => {
    const res = await ATS[c.ats].load(c.slug);
    for (const raw of res.jobs) {
      const j = ATS[c.ats].map(raw);
      if (!classifyTitle(j.title || "")) continue; // cheap pre-filter before detail calls
      if (j._detail) {
        const { data } = await get(j._detail);
        const secs = data?.jobAd?.sections || {};
        j.text = stripHtml(Object.values(secs).map((s) => s?.text || "").join(" "));
      }
      out.push({ ...j, company: c.name, hq: c.country, source: c.ats });
    }
  });
  console.log(`Company boards: ${companies.length} companies → ${out.length} title matches`);
  return out;
}

const HIMALAYAS_Q = ["partnerships", "partner manager", "business development", "go to market", "gtm", "strategy", "strategic", "alliances", "channel", "chief of staff", "bizops", "business operations", "ecosystem", "expansion", "corporate development", "founders associate", "commercial"];
async function fromHimalayas() {
  const out = [];
  const seen = new Set();
  for (const q of HIMALAYAS_Q) {
    for (const scope of ["worldwide=true", "country=India"]) {
      for (let page = 1; page <= 8; page++) {
        const { data } = await get(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&${scope}&sort=recent&page=${page}`);
        const jobs = data?.jobs || [];
        let old = 0;
        for (const j of jobs) {
          if (seen.has(j.guid)) continue;
          seen.add(j.guid);
          const posted = new Date(j.pubDate * 1000);
          if (NOW - posted > MAX_AGE_DAYS * 864e5) { old++; continue; }
          const r = j.locationRestrictions || [];
          if (r.length === 1 && r[0] === "India") continue; // India-only → almost always an India-HQ company
          out.push({
            title: j.title, company: j.companyName, hq: "", source: "himalayas", url: j.applicationLink || `https://himalayas.app/companies/${j.companySlug}/jobs`,
            location: r.length ? "Remote · " + r.join(", ") : "Remote · Worldwide", posted: posted.toISOString(),
            text: stripHtml(j.description || j.excerpt), boardWorldwide: r.length === 0, boardIndia: r.includes("India"),
          });
        }
        if (jobs.length < 20 || old === jobs.length) break;
      }
    }
  }
  console.log(`Himalayas: ${out.length}`);
  return out;
}

async function fromOtherBoards() {
  const out = [];
  const push = (o) => out.push({ hq: "", text: "", ...o });
  const rok = (await get("https://remoteok.com/api")).data || [];
  for (const j of rok.slice(1)) push({ title: j.position, company: j.company, url: j.url, location: j.location || "Remote", posted: j.date, text: stripHtml(j.description), source: "remoteok" });
  const rem = (await get("https://remotive.com/api/remote-jobs")).data?.jobs || [];
  for (const j of rem) push({ title: j.title, company: j.company_name, url: j.url, location: "Remote · " + (j.candidate_required_location || ""), posted: j.publication_date, text: stripHtml(j.description), source: "remotive" });
  for (const ind of ["business", "marketing", "management", "consulting"]) {
    const jb = (await get(`https://jobicy.com/api/v2/remote-jobs?count=100&industry=${ind}`)).data?.jobs || [];
    for (const j of jb) push({ title: stripHtml(j.jobTitle), company: j.companyName, url: j.url, location: "Remote · " + (j.jobGeo || ""), posted: j.pubDate, text: stripHtml(j.jobDescription), source: "jobicy" });
  }
  const wn = (await get("https://www.workingnomads.com/api/exposed_jobs/")).data || [];
  for (const j of wn) push({ title: j.title, company: j.company_name, url: j.url, location: "Remote · " + (j.location || ""), posted: j.pub_date, text: stripHtml(j.description), source: "workingnomads" });
  for (const cat of ["remote-sales-and-marketing-jobs", "remote-management-and-finance-jobs", "all-other-remote-jobs", "remote-business-jobs"]) {
    const { data: xml } = await get(`https://weworkremotely.com/categories/${cat}.rss`, { type: "text" });
    for (const m of (xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const tag = (t) => stripHtml((m[1].match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1] || "");
      const [company, ...rest] = tag("title").split(": ");
      push({ title: rest.join(": "), company, url: tag("link") || tag("guid"), location: "Remote · " + tag("region"), posted: new Date(tag("pubDate")).toISOString(), text: tag("description"), source: "weworkremotely" });
    }
  }
  console.log(`Other remote boards: ${out.length}`);
  return out;
}

// ---------------------------------------------------------------- main
const reg = await loadRegisters();
const [a, b, c] = await Promise.all([fromCompanies(), fromHimalayas(), fromOtherBoards()]);
const raw = [...a, ...b, ...c];

const seenPath = "data/seen.json";
const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, "utf8")) : {};
const jobs = [];
const dedupe = new Set();
const stats = {};
const bump = (k) => (stats[k] = (stats[k] || 0) + 1);

for (const j of raw) {
  const tc = classifyTitle(j.title || "");
  if (!tc) { bump("title/level mismatch"); continue; }
  const posted = j.posted ? new Date(j.posted) : null;
  if (posted && !isNaN(posted) && NOW - posted > MAX_AGE_DAYS * 864e5) { bump("older than 30 days"); continue; }

  const loc = (j.location || "").toLowerCase();
  const text = (j.text || "").toLowerCase();
  if (SPONSOR_NEG.test(text)) { bump("says no sponsorship / right-to-work required"); continue; }

  const isRemote = /remote|anywhere|worldwide|distributed|home[- ]?based|work from home|wfh/.test(loc) || j.source === "himalayas" || ["remoteok", "remotive", "jobicy", "workingnomads", "weworkremotely"].includes(j.source);
  const locIndia = INDIA.test(loc), locApac = APAC.test(loc);
  const locUS = US_ONLY.test(loc.replace(/remote/g, " "));
  const reg_ = region(j.location, j.hq);
  const restricted = RESTRICTED_TXT.test(text);

  let tier = null, evidence = "";
  const titleRegion = TITLE_REGION.test(j.title.toLowerCase().replace(/\bnew business\b/, ""));
  const locWorldwide = (WORLDWIDE_LOC.test(loc) || j.boardWorldwide) && !titleRegion;
  const multiRegion = /emea|europe|\beu\b/.test(loc) || (loc.match(/·/g) || []).length >= 3;
  if (isRemote && locWorldwide && !restricted && !(locUS && !/worldwide|anywhere|global/.test(loc))) {
    tier = "Remote · Worldwide"; evidence = "Location: " + j.location;
  } else if (isRemote && !restricted && !locUS && !titleRegion && !region(j.location, "") && WORLDWIDE_TXT.test(text)) {
    tier = "Remote · Worldwide"; evidence = snippet(text, WORLDWIDE_TXT);
  } else if (isRemote && !locUS && (locIndia || locApac || j.boardIndia)) {
    tier = "Remote · APAC/India"; evidence = "Location: " + j.location;
  } else if (!isRemote && locIndia && j.hq) {
    tier = "India office (non-Indian startup)"; evidence = "Location: " + j.location;
  } else if (reg_ && SPONSOR_POS.test(text)) {
    tier = "Visa sponsorship / relocation"; evidence = snippet(text, SPONSOR_POS);
  } else if (reg_ && !isRemote && !multiRegion && /united kingdom|\buk\b|england|scotland|london|manchester|edinburgh|bristol|cambridge|oxford|leeds|glasgow|belfast/.test(loc || (j.hq === "UK" ? "uk" : "")) && onRegister(reg.UK, j.company)) {
    tier = "Licensed UK visa sponsor"; evidence = "Company appears on the UK Home Office Register of Licensed Sponsors (ad is silent on visas — ask)";
  } else if (reg_ && !isRemote && !multiRegion && /netherlands|amsterdam|rotterdam|utrecht|the hague|eindhoven/.test(loc || (j.hq === "Netherlands" ? "netherlands" : "")) && onRegister(reg.NL, j.company)) {
    tier = "Recognised NL visa sponsor"; evidence = "Company appears on the IND public register of recognised sponsors (ad is silent on visas — ask)";
  }
  if (!tier) { bump(isRemote ? "remote but restricted to a non-India country" : "on-site, no sponsorship signal"); continue; }

  const key = norm(j.company) + "|" + norm(j.title);
  if (dedupe.has(key)) { bump("duplicate"); continue; }
  dedupe.add(key);

  const id = key.slice(0, 120);
  seen[id] ||= TODAY;
  jobs.push({
    id, title: j.title.trim(), company: (j.company || "").trim(), hq: (j.hq || "").replace(/_/g, " "), region: reg_ || (tier.startsWith("Remote") ? "Remote" : ""),
    location: j.location, tier, families: tc.families, level: tc.level,
    posted: posted && !isNaN(posted) ? posted.toISOString().slice(0, 10) : null, firstSeen: seen[id],
    url: j.url, source: j.source, evidence: evidence.slice(0, 320),
  });
  bump("KEPT");
}

// prune seen map to ~60 days
for (const [k, d] of Object.entries(seen)) if (NOW - new Date(d) > 60 * 864e5) delete seen[k];
fs.writeFileSync(seenPath, JSON.stringify(seen));
jobs.sort((x, y) => (y.firstSeen + (y.posted || "")).localeCompare(x.firstSeen + (x.posted || "")));
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/jobs.json", JSON.stringify({ generatedAt: new Date().toISOString(), maxAgeDays: MAX_AGE_DAYS, stats, jobs }));
console.log(stats);
console.log(`Wrote ${jobs.length} roles`);
