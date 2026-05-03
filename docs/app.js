/* Skiptrace dashboard.
 *
 * Two modes:
 *   1. Links-only (default, no backend) — generates pre-filled URLs into
 *      ~15 free people-search sites, opens them on demand.
 *   2. Backend mode — calls a Flask backend (Render/Fly.io/etc.) that
 *      actually scrapes the sites and returns merged phones, addresses,
 *      emails, and relatives, displayed inline on this page.
 *
 * Browser-side enrichment in both modes:
 *   - libphonenumber-js (validity, line type, region, E.164)
 *   - US Census Geocoder (CORS-enabled, address standardization + lat/lon)
 */

(() => {
  "use strict";

  const HISTORY_KEY = "skiptrace.history.v2";
  const BACKEND_URL_KEY = "skiptrace.backendUrl.v1";
  const MAX_HISTORY = 200;

  // -- backend URL state -----------------------------------------------------

  function getBackendUrl() {
    try { return (localStorage.getItem(BACKEND_URL_KEY) || "").trim(); }
    catch { return ""; }
  }
  function setBackendUrl(url) {
    const clean = (url || "").trim().replace(/\/+$/, "");
    try {
      if (clean) localStorage.setItem(BACKEND_URL_KEY, clean);
      else localStorage.removeItem(BACKEND_URL_KEY);
    } catch { /* quota */ }
  }

  async function apiHealth(url) {
    if (!url) return { ok: false, error: "no backend url set" };
    try {
      const r = await fetch(url + "/healthz", { mode: "cors" });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const j = await r.json();
      return { ok: true, ...j };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  async function apiSkiptrace(url, query) {
    const r = await fetch(url + "/api/skiptrace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      mode: "cors",
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // -- source URL builders (links-only fallback) -----------------------------

  const slug = s => (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const digitsOnly = s => {
    const d = (s || "").replace(/\D/g, "");
    return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  };
  const csz = q => [q.city, q.state, q.zip].filter(Boolean).join(" ");
  const cszSlug = q => slug([q.city, q.state].filter(Boolean).join(" "));

  const SOURCES = [
    { key: "truepeoplesearch", label: "TruePeopleSearch", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.truepeoplesearch.com/results?phoneno=${d}`;
        if (q.address) {
          const p = new URLSearchParams({ streetaddress: q.address });
          if (csz(q)) p.set("citystatezip", csz(q));
          return `https://www.truepeoplesearch.com/results?${p}`;
        }
        if (q.name) {
          const p = new URLSearchParams({ name: q.name });
          if (csz(q)) p.set("citystatezip", csz(q));
          return `https://www.truepeoplesearch.com/results?${p}`;
        }
        return null;
    }},
    { key: "fastpeoplesearch", label: "FastPeopleSearch", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.fastpeoplesearch.com/${d}`;
        if (q.address) {
          const a = slug(q.address); const c = cszSlug(q);
          return c ? `https://www.fastpeoplesearch.com/address/${a}_${c}` : `https://www.fastpeoplesearch.com/address/${a}`;
        }
        if (q.name) {
          const n = slug(q.name); const c = cszSlug(q);
          return c ? `https://www.fastpeoplesearch.com/name/${n}_${c}` : `https://www.fastpeoplesearch.com/name/${n}`;
        }
        return null;
    }},
    { key: "thatsthem", label: "ThatsThem", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://thatsthem.com/phone/${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
        if (q.email) return `https://thatsthem.com/email/${encodeURIComponent(q.email)}`;
        if (q.address) return `https://thatsthem.com/address/${encodeURIComponent(q.address.trim().replace(/\s+/g, "-"))}`;
        if (q.name) {
          const n = q.name.trim().replace(/\s+/g, "-");
          const c = [q.city, q.state].filter(Boolean).join(" ").replace(/\s+/g, "-");
          return c ? `https://thatsthem.com/name/${n}/${c}` : `https://thatsthem.com/name/${n}`;
        }
        return null;
    }},
    { key: "usphonebook", label: "USPhoneBook", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.usphonebook.com/${d}`;
        if (q.name) {
          const n = slug(q.name); const c = cszSlug(q);
          return c ? `https://www.usphonebook.com/${n}/${c}` : `https://www.usphonebook.com/${n}`;
        }
        return null;
    }},
    { key: "spokeo", label: "Spokeo", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.spokeo.com/${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
        if (q.email) return `https://www.spokeo.com/email-search?q=${encodeURIComponent(q.email)}`;
        if (q.address) {
          const p = new URLSearchParams({ q: [q.address, csz(q)].filter(Boolean).join(", ") });
          return `https://www.spokeo.com/address-search?${p}`;
        }
        if (q.name) {
          const p = new URLSearchParams({ q: [q.name, csz(q)].filter(Boolean).join(", ") });
          return `https://www.spokeo.com/search?${p}`;
        }
        return null;
    }},
    { key: "whitepages", label: "Whitepages", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.whitepages.com/phone/1-${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
        if (q.address) {
          const a = q.address.trim().replace(/\s+/g, "-");
          const c = [q.city, q.state].filter(Boolean).join("-").replace(/\s+/g, "-");
          return c ? `https://www.whitepages.com/address/${a}/${c}` : `https://www.whitepages.com/address/${a}`;
        }
        if (q.name) {
          const n = q.name.trim().replace(/\s+/g, "-");
          const c = [q.city, q.state].filter(Boolean).join("-").replace(/\s+/g, "-");
          return c ? `https://www.whitepages.com/name/${n}/${c}` : `https://www.whitepages.com/name/${n}`;
        }
        return null;
    }},
    { key: "radaris", label: "Radaris", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://radaris.com/p/phone/${d}/`;
        if (q.name) {
          const parts = q.name.trim().split(/\s+/);
          const p = new URLSearchParams({ ff: parts[0] || "", fl: parts.slice(1).join("+") || "" });
          if (q.state) p.set("fs", q.state);
          if (q.city) p.set("fc", q.city);
          return `https://radaris.com/ng/search?${p}`;
        }
        return null;
    }},
    { key: "411", label: "411.com", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.411.com/phone/1-${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
        if (q.name) {
          const n = q.name.trim().replace(/\s+/g, "-");
          const c = [q.city, q.state].filter(Boolean).join("-").replace(/\s+/g, "-");
          return c ? `https://www.411.com/name/${n}/${c}` : `https://www.411.com/name/${n}`;
        }
        return null;
    }},
    { key: "anywho", label: "AnyWho", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.anywho.com/phone/${d}`;
        if (q.name) {
          const parts = q.name.trim().split(/\s+/);
          const p = new URLSearchParams({ first_name: parts[0] || "", last_name: parts.slice(1).join(" ") || "" });
          if (q.city) p.set("city", q.city);
          if (q.state) p.set("state_code", q.state);
          return `https://www.anywho.com/people?${p}`;
        }
        return null;
    }},
    { key: "beenverified", label: "BeenVerified", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.beenverified.com/app/search/phone?phone=${d}`;
        if (q.email) return `https://www.beenverified.com/app/search/email?email=${encodeURIComponent(q.email)}`;
        if (q.address) {
          const p = new URLSearchParams({ address: q.address });
          if (q.city) p.set("city", q.city);
          if (q.state) p.set("state", q.state);
          return `https://www.beenverified.com/app/search/property?${p}`;
        }
        if (q.name) {
          const parts = q.name.trim().split(/\s+/);
          const p = new URLSearchParams({ fname: parts[0] || "", ln: parts.slice(1).join(" ") || "" });
          if (q.state) p.set("state", q.state);
          return `https://www.beenverified.com/app/search/person?${p}`;
        }
        return null;
    }},
    { key: "peoplefinders", label: "PeopleFinders", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.peoplefinders.com/reverse-phone/${d}`;
        if (q.name) {
          const n = q.name.trim().replace(/\s+/g, "-");
          const c = [q.city, q.state].filter(Boolean).join("-").replace(/\s+/g, "-");
          return c ? `https://www.peoplefinders.com/people/${n}/${c}` : `https://www.peoplefinders.com/people/${n}`;
        }
        return null;
    }},
    { key: "searchpeoplefree", label: "SearchPeopleFREE", build(q) {
        const d = digitsOnly(q.phone);
        if (d.length === 10) return `https://www.searchpeoplefree.com/phone/${d}`;
        if (q.name) {
          const n = slug(q.name); const c = cszSlug(q);
          return c ? `https://www.searchpeoplefree.com/find/${n}/${c}` : `https://www.searchpeoplefree.com/find/${n}`;
        }
        return null;
    }},
    { key: "google", label: "Google", build(q) {
        const parts = [];
        if (q.name) parts.push(`"${q.name}"`);
        if (q.phone) parts.push(`"${q.phone}"`);
        if (q.address) parts.push(`"${q.address}"`);
        if (q.email) parts.push(`"${q.email}"`);
        if (csz(q)) parts.push(csz(q));
        if (!parts.length) return null;
        return `https://www.google.com/search?q=${encodeURIComponent(parts.join(" "))}`;
    }},
    { key: "facebook", label: "Facebook", build(q) {
        if (q.name) return `https://www.facebook.com/search/people/?q=${encodeURIComponent([q.name, q.city, q.state].filter(Boolean).join(" "))}`;
        if (q.email) return `https://www.facebook.com/search/people/?q=${encodeURIComponent(q.email)}`;
        if (q.phone) return `https://www.facebook.com/search/people/?q=${encodeURIComponent(q.phone)}`;
        return null;
    }},
    { key: "linkedin", label: "LinkedIn", build(q) {
        if (q.name) {
          const p = new URLSearchParams({ keywords: [q.name, q.city, q.state].filter(Boolean).join(" ") });
          return `https://www.linkedin.com/search/results/people/?${p}`;
        }
        return null;
    }},
  ];

  function buildLinks(query) {
    const out = [];
    for (const src of SOURCES) {
      try { const url = src.build(query); if (url) out.push({ key: src.key, label: src.label, url }); }
      catch { /* skip */ }
    }
    return out;
  }

  // -- enrichment ------------------------------------------------------------

  function enrichPhone(raw) {
    if (!raw || !window.libphonenumber) return null;
    try {
      const parsed = window.libphonenumber.parsePhoneNumberFromString(raw, "US");
      if (!parsed) return { input: raw, error: "could not parse" };
      return {
        input: raw,
        valid: parsed.isValid(),
        possible: parsed.isPossible(),
        e164: parsed.number,
        national: parsed.formatNational(),
        international: parsed.formatInternational(),
        country: parsed.country || "US",
        type: parsed.getType() || "unknown",
      };
    } catch (e) {
      return { input: raw, error: String(e) };
    }
  }

  async function enrichAddress(addr) {
    const oneLine = [addr.address || addr.line, addr.city, addr.state, addr.zip].filter(Boolean).join(", ");
    if (!oneLine.trim()) return null;
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(oneLine)}&benchmark=Public_AR_Current&format=json`;
    try {
      const r = await fetch(url);
      if (!r.ok) return { error: `census HTTP ${r.status}` };
      const j = await r.json();
      const m = (j.result?.addressMatches || [])[0];
      if (!m) return { error: "no match" };
      return { standardized: m.matchedAddress, lat: m.coordinates?.y, lon: m.coordinates?.x };
    } catch (e) {
      return { error: String(e) };
    }
  }

  // -- DOM helpers -----------------------------------------------------------

  const $ = sel => document.querySelector(sel);
  const escape = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

  // -- main app --------------------------------------------------------------

  const singleForm = $("#single-form");
  const resultEl = $("#result");
  const banner = $("#backend-banner");
  const modeLabel = $("#mode-label");
  const modeWrap = $("#mode-label-wrap");

  // Settings dialog
  const modal = $("#settings-modal");
  const settingsForm = $("#settings-form");
  const settingsStatus = $("#backend-status");

  function openSettings() {
    settingsForm.elements.backendUrl.value = getBackendUrl();
    settingsStatus.textContent = "";
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
  }
  function closeSettings() {
    if (typeof modal.close === "function") modal.close();
    else modal.removeAttribute("open");
  }

  $("#settings-link").addEventListener("click", e => { e.preventDefault(); openSettings(); });
  $("#settings-inline")?.addEventListener("click", e => { e.preventDefault(); openSettings(); });
  $("#settings-cancel").addEventListener("click", closeSettings);
  $("#settings-save").addEventListener("click", async () => {
    const url = settingsForm.elements.backendUrl.value.trim();
    if (url && !/^https?:\/\//.test(url)) {
      settingsStatus.innerHTML = `<span class="error">URL must start with http:// or https://</span>`;
      return;
    }
    setBackendUrl(url);
    closeSettings();
    refreshMode();
  });
  $("#settings-clear").addEventListener("click", () => {
    setBackendUrl("");
    settingsForm.elements.backendUrl.value = "";
    settingsStatus.textContent = "";
    refreshMode();
  });
  $("#settings-test").addEventListener("click", async () => {
    const url = settingsForm.elements.backendUrl.value.trim().replace(/\/+$/, "");
    settingsStatus.innerHTML = `<em>Testing ${escape(url)}…</em>`;
    const h = await apiHealth(url);
    if (h.ok) {
      settingsStatus.innerHTML = `<span class="good">✓ Connected.</span> Sources: ${escape((h.sources || []).join(", "))}. cloudscraper: ${h.cloudscraper ? "yes" : "no"}.`;
    } else {
      settingsStatus.innerHTML = `<span class="error">✗ ${escape(h.error)}</span>`;
    }
  });

  async function refreshMode() {
    const url = getBackendUrl();
    if (!url) {
      modeLabel.textContent = "Links-only mode";
      modeWrap.hidden = false;
      banner.hidden = true;
      return;
    }
    modeLabel.textContent = "Backend mode (live scrape)";
    modeWrap.hidden = false;
    banner.hidden = false;
    banner.className = "banner muted";
    banner.innerHTML = `<span>Backend: <code>${escape(url)}</code> — pinging…</span>`;
    const h = await apiHealth(url);
    if (h.ok) {
      banner.className = "banner good";
      banner.innerHTML = `<span>✓ Backend connected — <code>${escape(url)}</code>. Phones &amp; relatives will appear inline.</span>`;
    } else {
      banner.className = "banner bad";
      banner.innerHTML = `<span>✗ Backend unreachable: ${escape(h.error)}. Falling back to links-only. <a href="#" id="banner-settings">Open Settings</a>.</span>`;
      $("#banner-settings")?.addEventListener("click", e => { e.preventDefault(); openSettings(); });
    }
  }

  // -- single search ---------------------------------------------------------

  singleForm.addEventListener("submit", async e => {
    e.preventDefault();
    await doLookup(formToQuery(singleForm));
  });

  async function doLookup(query) {
    if (!hasInput(query)) {
      showError(resultEl, "Enter at least one of: name, address, phone, email.");
      return;
    }
    const backend = getBackendUrl();
    const links = buildLinks(query);
    if (backend) {
      showResult(resultEl, `<em>Scraping free skip-trace sites via backend… (this can take 10–30 seconds — sites are slow)</em>`);
      try {
        const j = await apiSkiptrace(backend, query);
        const r = j.result;
        // Browser-side enrichment for whatever phones/addresses came back.
        r._enriched = await enrichResult(query, r);
        showResult(resultEl, renderLiveResult(query, r, links));
        saveHistory({
          ts: new Date().toISOString(),
          query,
          mode: "live",
          result: r,
          links,
        });
        renderHistory();
      } catch (err) {
        showError(resultEl, "Backend error: " + err.message + " — falling back to links-only.");
        renderLinksOnly(query, links);
      }
    } else {
      renderLinksOnly(query, links);
    }
  }

  async function renderLinksOnly(query, links) {
    const phoneInfo = enrichPhone(query.phone);
    showResult(resultEl, renderLinksOnlyHTML(query, links, phoneInfo, null, "Geocoding…"));
    const addrInfo = await enrichAddress(query);
    showResult(resultEl, renderLinksOnlyHTML(query, links, phoneInfo, addrInfo, null));
    saveHistory({
      ts: new Date().toISOString(),
      query, mode: "links", links, phoneInfo, addrInfo,
    });
    renderHistory();
  }

  async function enrichResult(query, r) {
    const phones = await Promise.all((r.phones || []).slice(0, 10).map(async p => {
      const e = enrichPhone(p.number);
      return { ...p, enrichment: e };
    }));
    const addresses = await Promise.all((r.addresses || []).slice(0, 5).map(async a => {
      const e = await enrichAddress({ line: a.line });
      return { ...a, enrichment: e };
    }));
    return { phones, addresses };
  }

  $("#open-all").addEventListener("click", () => {
    const query = formToQuery(singleForm);
    if (!hasInput(query)) return;
    const links = buildLinks(query);
    if (!links.length) return;
    if (!confirm(`Open ${links.length} tabs?`)) return;
    links.forEach(l => window.open(l.url, "_blank", "noopener"));
  });

  // -- live-result rendering -------------------------------------------------

  function renderLiveResult(query, r, links) {
    const phones = r._enriched?.phones || r.phones || [];
    const addresses = r._enriched?.addresses || r.addresses || [];
    const emails = r.emails || [];
    const relatives = r.relatives || [];
    const sources = r.sources || [];
    const detailUrls = r.detail_urls || [];

    const okCount = sources.filter(s => s.status === "ok").length;
    const totalCount = sources.length;

    const phonesHtml = phones.length
      ? `<ul class="big-list">${phones.map(renderPhoneRow).join("")}</ul>`
      : '<p class="muted small">No phones returned. The sites probably blocked the scrape — try the quick links below to view them in your browser.</p>';

    const addressHtml = addresses.length
      ? `<ul class="big-list">${addresses.map(renderAddressRow).join("")}</ul>`
      : '<p class="muted small">No addresses returned.</p>';

    const emailHtml = emails.length
      ? `<ul class="big-list">${emails.map(e => `<li>📧 <a href="mailto:${escape(e.email)}">${escape(e.email)}</a> ${sourcePills(e.sources)}</li>`).join("")}</ul>`
      : '<p class="muted small">No emails returned.</p>';

    const relsHtml = relatives.length
      ? `<ul class="big-list">${relatives.map(r => renderRelativeRow(r, query)).join("")}</ul>`
      : '<p class="muted small">No relatives returned.</p>';

    const sourcesHtml = sources.map(s => {
      const cls = { ok: "good", no_results: "muted", blocked: "bad", error: "bad", skipped: "muted" }[s.status] || "muted";
      const cache = s.from_cache ? '<span class="tag">cached</span>' : "";
      return `
        <div class="src-card">
          <div class="src-head">
            <a class="src-name" href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.label)} ↗</a>
            <span class="pill ${cls}">${escape(s.status)}</span>
          </div>
          <div class="src-meta">${s.result_count} hit${s.result_count === 1 ? "" : "s"} · ${s.elapsed_ms}ms ${cache}</div>
          ${s.error ? `<div class="error small">${escape(s.error)}</div>` : ""}
        </div>
      `;
    }).join("");

    const linksHtml = links.map(l =>
      `<a class="link" href="${escape(l.url)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`
    ).join("");

    const detailHtml = detailUrls.map(u =>
      `<a class="link small" href="${escape(u)}" target="_blank" rel="noopener">${escape(prettyHost(u))} detail ↗</a>`
    ).join("");

    return `
      <div class="result-head">
        <h3>${escape(r.name || query.name || "Unknown")}</h3>
        <span class="pill ${okCount ? 'good' : 'muted'}">${okCount}/${totalCount} sources · confidence ${r.confidence ?? 0}</span>
      </div>

      <section class="block">
        <h4>📞 Phones</h4>
        ${phonesHtml}
      </section>

      <section class="block">
        <h4>👨‍👩‍👧 Relatives &amp; associates</h4>
        ${relsHtml}
      </section>

      <section class="block">
        <h4>🏠 Addresses</h4>
        ${addressHtml}
      </section>

      <section class="block">
        <h4>✉ Emails</h4>
        ${emailHtml}
      </section>

      <details class="block">
        <summary><strong>Sources (${totalCount})</strong></summary>
        <div class="source-grid">${sourcesHtml}</div>
        ${detailHtml ? `<div class="links" style="margin-top:8px">${detailHtml}</div>` : ""}
      </details>

      <details class="block">
        <summary><strong>Open at source manually</strong></summary>
        <div class="links">${linksHtml}</div>
      </details>
    `;
  }

  function renderPhoneRow(p) {
    const e = p.enrichment || {};
    const num = p.number || "";
    const tel = "tel:" + num.replace(/[^\d+]/g, "");
    const sms = "sms:" + num.replace(/[^\d+]/g, "");
    const meta = [
      e.type && e.type !== "unknown" ? e.type : "",
      e.country && e.country !== "US" ? e.country : "",
      e.location || "",
    ].filter(Boolean).map(escape).join(" · ");
    return `
      <li class="phone-row">
        <div>
          <strong class="big">${escape(num)}</strong>
          ${e.valid ? '<span class="pill good">valid</span>' : (e.valid === false ? '<span class="pill bad">invalid</span>' : "")}
        </div>
        <div class="muted small">${meta || ""}</div>
        <div class="row-actions">
          <a class="link small" href="${tel}">Call</a>
          <a class="link small" href="${sms}">Text</a>
          ${sourcePills(p.sources)}
        </div>
      </li>
    `;
  }

  function renderAddressRow(a) {
    const e = a.enrichment || {};
    const map = (e.lat && e.lon) ? `<a class="link small" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${e.lat},${e.lon}">Map ↗</a>` : "";
    return `
      <li class="address-row">
        <div><strong>${escape(a.line)}</strong> ${sourcePills(a.sources)}</div>
        ${e.standardized ? `<div class="muted small">→ ${escape(e.standardized)} ${map}</div>` : ""}
      </li>
    `;
  }

  function renderRelativeRow(rel, parentQuery) {
    const name = rel.name || "Unknown";
    const lookupQuery = JSON.stringify({ name, state: parentQuery.state, city: parentQuery.city });
    return `
      <li class="rel-row">
        <span>👤 <strong>${escape(name)}</strong> ${sourcePills(rel.sources)}</span>
        <button class="link small" data-rel='${escape(lookupQuery)}'>Look up phones →</button>
      </li>
    `;
  }

  resultEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-rel]");
    if (!btn) return;
    let q;
    try { q = JSON.parse(btn.dataset.rel.replace(/&quot;/g, '"').replace(/&amp;/g, '&')); }
    catch { return; }
    Object.entries(q).forEach(([k, v]) => {
      const el = singleForm.elements[k];
      if (el) el.value = v || "";
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    doLookup(q);
  });

  function sourcePills(srcs) {
    return (srcs || []).map(s => `<span class="pill src">${escape(s)}</span>`).join(" ");
  }

  function prettyHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return url; }
  }

  // -- links-only rendering (no backend) -------------------------------------

  function renderLinksOnlyHTML(query, links, phoneInfo, addrInfo, statusMsg) {
    const linksHtml = links.map(l =>
      `<a class="link" href="${escape(l.url)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`
    ).join("");

    const phoneBlock = phoneInfo
      ? phoneInfo.error
        ? `<div class="muted small">${escape(phoneInfo.input)} — ${escape(phoneInfo.error)}</div>`
        : `
          <div><strong class="big">${escape(phoneInfo.national)}</strong> <span class="pill ${phoneInfo.valid ? 'good' : 'bad'}">${phoneInfo.valid ? 'valid' : 'invalid'}</span></div>
          <div class="muted small">type: ${escape(phoneInfo.type)} · country: ${escape(phoneInfo.country)} · E.164: ${escape(phoneInfo.e164)}</div>
        `
      : '<div class="muted small">No phone provided.</div>';

    const addrBlock = addrInfo
      ? addrInfo.error
        ? `<div class="muted small">${escape(addrInfo.error)}</div>`
        : `
          <div><strong>${escape(addrInfo.standardized || "")}</strong></div>
          <div class="muted small">lat ${addrInfo.lat}, lon ${addrInfo.lon}
            ${addrInfo.lat ? ` · <a class="link small" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${addrInfo.lat},${addrInfo.lon}">map ↗</a>` : ""}
          </div>
        `
      : statusMsg
        ? `<div class="muted small">${escape(statusMsg)}</div>`
        : '<div class="muted small">No address provided.</div>';

    return `
      <div class="result-head">
        <h3>${escape(query.name || query.phone || query.address || query.email || "Lookup")}</h3>
        <span class="pill">${links.length} link${links.length === 1 ? "" : "s"}</span>
      </div>
      <p class="muted small">No backend configured — showing search-link launcher only. <a href="#" id="open-settings-from-result">Connect a backend</a> to see real phones and relatives inline.</p>
      <div class="cols">
        <section>
          <h4>Open at free skip-trace sites</h4>
          <div class="links">${linksHtml || '<span class="muted small">No matching link templates.</span>'}</div>
        </section>
        <section>
          <h4>Phone enrichment</h4>${phoneBlock}
          <h4>Address enrichment</h4>${addrBlock}
        </section>
      </div>
    `;
  }

  resultEl.addEventListener("click", e => {
    const a = e.target.closest("#open-settings-from-result");
    if (a) { e.preventDefault(); openSettings(); }
  });

  // -- batch -----------------------------------------------------------------

  const batchForm = $("#batch-form");
  const batchFile = $("#batch-file");
  const batchResultEl = $("#batch-result");
  const batchExportBtn = $("#batch-export");
  let lastBatch = null;

  batchForm.addEventListener("submit", async e => {
    e.preventDefault();
    const file = batchFile.files[0];
    if (!file) return;
    showResult(batchResultEl, "<em>Reading CSV…</em>");
    let text;
    try { text = await file.text(); }
    catch (err) { showError(batchResultEl, "Failed to read file: " + err.message); return; }
    const rows = parseCSV(text);
    if (!rows.length) { showError(batchResultEl, "CSV is empty or missing a header row."); return; }
    const enriched = rows.map(row => {
      const q = normalizeQuery(row);
      return { query: q, links: buildLinks(q), phoneInfo: enrichPhone(q.phone) };
    });
    lastBatch = enriched;
    batchExportBtn.disabled = false;
    renderBatch(enriched);
  });

  batchExportBtn.addEventListener("click", () => {
    if (!lastBatch) return;
    downloadCSV("skiptrace-batch.csv", batchToCSV(lastBatch));
  });

  function renderBatch(rows) {
    const sourceKeys = SOURCES.map(s => s.key);
    const headers = ["Query", "Phone (national)", "Phone valid", "Phone type", ...SOURCES.map(s => s.label)];
    const trs = rows.map(r => {
      const cells = [
        describeQuery(r.query),
        r.phoneInfo ? escape(r.phoneInfo.national || r.phoneInfo.input || "") : "",
        r.phoneInfo ? (r.phoneInfo.valid ? "✓" : "✗") : "",
        r.phoneInfo ? escape(r.phoneInfo.type || "") : "",
      ];
      const linkMap = Object.fromEntries(r.links.map(l => [l.key, l.url]));
      for (const k of sourceKeys) {
        const url = linkMap[k];
        cells.push(url
          ? `<a class="link small" target="_blank" rel="noopener" href="${escape(url)}">open ↗</a>`
          : '<span class="muted small">—</span>');
      }
      return `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
    }).join("");
    showResult(batchResultEl, `
      <h3>${rows.length} row${rows.length === 1 ? "" : "s"}</h3>
      <p class="muted small">Batch mode is links-only (running 4-site live scrape per row would take 30+ min on the free backend tier — use single lookup for live data).</p>
      <div class="table-wrap"><table>
        <thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join("")}</tr></thead>
        <tbody>${trs}</tbody>
      </table></div>
    `);
  }

  function batchToCSV(rows) {
    const sourceKeys = SOURCES.map(s => s.key);
    const cols = ["name","address","city","state","zip","phone","email",
                  "phone_national","phone_valid","phone_type","phone_country",
                  ...sourceKeys.map(k => `url_${k}`)];
    const lines = [cols.join(",")];
    for (const r of rows) {
      const linkMap = Object.fromEntries(r.links.map(l => [l.key, l.url]));
      const row = [
        r.query.name, r.query.address, r.query.city, r.query.state,
        r.query.zip, r.query.phone, r.query.email,
        r.phoneInfo?.national, r.phoneInfo?.valid, r.phoneInfo?.type, r.phoneInfo?.country,
        ...sourceKeys.map(k => linkMap[k] || ""),
      ];
      lines.push(row.map(csvCell).join(","));
    }
    return lines.join("\n");
  }

  // -- history ---------------------------------------------------------------

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch { return []; }
  }
  function saveHistory(entry) {
    const list = loadHistory();
    list.unshift(entry);
    if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }
    catch { /* quota — drop silently */ }
  }

  function renderHistory() {
    const tbody = $("#history-table tbody");
    const list = loadHistory();
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No searches yet.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((h, i) => {
      const topPhone = h.mode === "live"
        ? ((h.result?.phones || [])[0]?.number || "")
        : (h.phoneInfo?.national || h.query.phone || "");
      const addr = h.mode === "live"
        ? ((h.result?.addresses || [])[0]?.line || "")
        : (h.addrInfo?.standardized || h.query.address || "");
      return `
        <tr>
          <td>${escape(new Date(h.ts).toLocaleString())}</td>
          <td>${describeQuery(h.query)} <span class="pill ${h.mode === 'live' ? 'good' : ''}">${escape(h.mode || "")}</span></td>
          <td>${escape(topPhone) || '<span class="muted small">—</span>'}</td>
          <td>${escape(addr) || '<span class="muted small">—</span>'}</td>
          <td>
            <button class="ghost small" data-rerun="${i}">Re-run</button>
            <button class="danger small" data-del="${i}">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  $("#history-table tbody").addEventListener("click", e => {
    const open = e.target.closest("[data-rerun]");
    const del = e.target.closest("[data-del]");
    const list = loadHistory();
    if (open) {
      const h = list[+open.dataset.rerun];
      if (!h) return;
      Object.entries(h.query).forEach(([k, v]) => {
        const el = singleForm.elements[k];
        if (el) el.value = v || "";
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      doLookup(h.query);
    }
    if (del) {
      list.splice(+del.dataset.del, 1);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      renderHistory();
    }
  });

  $("#clear-history").addEventListener("click", () => {
    if (confirm("Clear all history?")) {
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
    }
  });

  $("#export-link").addEventListener("click", e => {
    e.preventDefault();
    const list = loadHistory();
    if (!list.length) { alert("No history to export."); return; }
    downloadCSV("skiptrace-history.csv", historyToCSV(list));
  });

  function historyToCSV(list) {
    const cols = ["timestamp","mode","name","address","city","state","zip","phone","email",
                  "top_phone","top_address","confidence"];
    const lines = [cols.join(",")];
    for (const h of list) {
      const topPhone = h.mode === "live"
        ? ((h.result?.phones || [])[0]?.number || "")
        : (h.phoneInfo?.national || "");
      const topAddr = h.mode === "live"
        ? ((h.result?.addresses || [])[0]?.line || "")
        : (h.addrInfo?.standardized || "");
      lines.push([
        h.ts, h.mode, h.query.name, h.query.address, h.query.city, h.query.state,
        h.query.zip, h.query.phone, h.query.email,
        topPhone, topAddr, h.result?.confidence ?? "",
      ].map(csvCell).join(","));
    }
    return lines.join("\n");
  }

  // -- utilities -------------------------------------------------------------

  function formToQuery(form) {
    return normalizeQuery(Object.fromEntries(new FormData(form).entries()));
  }
  function normalizeQuery(raw) {
    const out = {};
    for (const k of ["name","address","city","state","zip","phone","email"]) {
      const v = raw[k] ?? raw[k.toUpperCase()] ?? raw[k[0].toUpperCase() + k.slice(1)];
      if (v != null) {
        const s = String(v).trim();
        if (s) out[k] = s;
      }
    }
    return out;
  }
  function hasInput(q) {
    return !!(q.name || q.address || q.phone || q.email);
  }
  function describeQuery(q) {
    const parts = [];
    if (q.name) parts.push(`<strong>${escape(q.name)}</strong>`);
    const addr = [q.address, q.city, q.state, q.zip].filter(Boolean).join(", ");
    if (addr) parts.push(escape(addr));
    if (q.phone) parts.push(escape(q.phone));
    if (q.email) parts.push(escape(q.email));
    return parts.join(" · ") || "<em>—</em>";
  }
  function showResult(el, html) { el.hidden = false; el.innerHTML = html; }
  function showError(el, msg) { el.hidden = false; el.innerHTML = `<div class="error">${escape(msg)}</div>`; }
  function csvCell(v) {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function downloadCSV(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function parseCSV(text) {
    const rows = [];
    let i = 0, field = "", row = [], inQ = false;
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = rows[r][idx] ?? ""; });
      if (Object.values(obj).some(v => String(v).trim() !== "")) out.push(obj);
    }
    return out;
  }

  // -- init ------------------------------------------------------------------

  refreshMode();
  renderHistory();
})();
