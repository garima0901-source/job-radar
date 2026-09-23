export const UA = "Mozilla/5.0 (compatible; jobradar/1.0; personal job search)";

export async function get(url, { type = "json", timeout = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ctrl.signal });
    if (!res.ok) return { status: res.status, data: null };
    const data = type === "json" ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(t);
  }
}

// Run async fn over items with limited concurrency.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

export const norm = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const stripHtml = (s) =>
  (s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ---------- ATS adapters: each returns { exists, jobs:[raw], companyName? } ----------
export const ATS = {
  greenhouse: {
    url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`,
    async load(s) {
      const { data } = await get(this.url(s), { timeout: 40000 });
      if (!data || !Array.isArray(data.jobs)) return { exists: false, jobs: [] };
      return { exists: true, jobs: data.jobs, companyName: data.jobs[0]?.company_name };
    },
    map: (j) => ({
      title: j.title,
      location: j.location?.name || "",
      posted: j.first_published || j.updated_at,
      url: j.absolute_url,
      text: stripHtml(j.content),
    }),
  },
  lever: {
    async load(s) {
      for (const host of ["api.lever.co", "api.eu.lever.co"]) {
        const { data } = await get(`https://${host}/v0/postings/${s}?mode=json`, { timeout: 40000 });
        if (Array.isArray(data) && data.length) return { exists: true, jobs: data };
      }
      return { exists: false, jobs: [] };
    },
    map: (j) => ({
      title: j.text,
      location: [j.categories?.location, ...(j.categories?.allLocations || []), j.workplaceType].filter(Boolean).join(" · "),
      posted: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      url: j.hostedUrl,
      text: [j.descriptionPlain, ...(j.lists || []).map((l) => l.text + " " + stripHtml(l.content)), j.additionalPlain].join(" "),
    }),
  },
  ashby: {
    async load(s) {
      const { data } = await get(`https://api.ashbyhq.com/posting-api/job-board/${s}`, { timeout: 40000 });
      if (!data || !Array.isArray(data.jobs)) return { exists: false, jobs: [] };
      return { exists: true, jobs: data.jobs.filter((j) => j.isListed !== false) };
    },
    map: (j) => ({
      title: j.title,
      location: [j.location, ...(j.secondaryLocations || []).map((l) => l.location), j.isRemote ? "Remote" : "", j.workplaceType]
        .filter(Boolean).join(" · "),
      posted: j.publishedAt,
      url: j.jobUrl,
      text: j.descriptionPlain || stripHtml(j.descriptionHtml),
    }),
  },
  workable: {
    async load(s) {
      const { data } = await get(`https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`, { timeout: 40000 });
      if (!data || !Array.isArray(data.jobs)) return { exists: false, jobs: [] };
      return { exists: true, jobs: data.jobs, companyName: data.name };
    },
    map: (j) => ({
      title: j.title,
      location: [
        ...(j.locations || []).map((l) => [l.city, l.country].filter(Boolean).join(", ")),
        j.city, j.country, j.telecommuting ? "Remote" : "",
      ].filter(Boolean).join(" · "),
      posted: j.published_on || j.created_at,
      url: j.url || j.shortlink,
      text: stripHtml(j.description),
    }),
  },
  recruitee: {
    async load(s) {
      const { data } = await get(`https://${s}.recruitee.com/api/offers/`, { timeout: 40000 });
      if (!data || !Array.isArray(data.offers)) return { exists: false, jobs: [] };
      return { exists: true, jobs: data.offers, companyName: data.offers[0]?.company_name };
    },
    map: (j) => ({
      title: j.title,
      location: [j.location, j.country, j.remote ? "Remote" : "", ...(j.locations || []).map((l) => l.name)].filter(Boolean).join(" · "),
      posted: j.published_at || j.created_at,
      url: j.careers_url,
      text: stripHtml((j.description || "") + " " + (j.requirements || "")),
    }),
  },
  smartrecruiters: {
    async load(s) {
      const { data } = await get(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`, { timeout: 40000 });
      if (!data || !Array.isArray(data.content) || !data.content.length) return { exists: false, jobs: [] };
      return { exists: true, jobs: data.content, companyName: data.content[0]?.company?.name, slug: s };
    },
    map: (j) => ({
      title: j.name,
      location: [j.location?.city, j.location?.country?.toUpperCase?.(), j.location?.remote ? "Remote" : ""].filter(Boolean).join(" · "),
      posted: j.releasedDate,
      url: `https://jobs.smartrecruiters.com/${j.company?.identifier}/${j.id}`,
      text: "",
      _detail: `https://api.smartrecruiters.com/v1/companies/${j.company?.identifier}/postings/${j.id}`,
    }),
  },
  personio: {
    async load(s) {
      for (const tld of ["de", "com"]) {
        const { data } = await get(`https://${s}.jobs.personio.${tld}/xml`, { type: "text", timeout: 40000 });
        if (data && data.includes("<position>")) {
          const jobs = [...data.matchAll(/<position>([\s\S]*?)<\/position>/g)].map((m) => ({ xml: m[1], tld, slug: s }));
          return { exists: true, jobs };
        }
      }
      return { exists: false, jobs: [] };
    },
    map: (j) => {
      const tag = (t) => (j.xml.match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1] || "";
      const id = tag("id");
      return {
        title: stripHtml(tag("name")),
        location: [tag("office"), ...[...j.xml.matchAll(/<additionalOffice>([\s\S]*?)<\/additionalOffice>/g)].map((m) => m[1])].join(" · "),
        posted: tag("createdAt"),
        url: `https://${j.slug}.jobs.personio.${j.tld}/job/${id}`,
        text: stripHtml([...j.xml.matchAll(/<value>([\s\S]*?)<\/value>/g)].map((m) => m[1]).join(" ")),
      };
    },
  },
};
