(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const singleForm = $("#single-form");
  const singleResult = $("#single-result");
  const batchForm = $("#batch-form");
  const batchFile = $("#batch-file");
  const batchResult = $("#batch-result");
  const historyBody = $("#history-table tbody");
  const refreshBtn = $("#refresh-history");
  const quickLinksEl = $("#quick-links");

  singleForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(singleForm).entries());
    showResult(singleResult, "Searching free skip-trace sites…");
    try {
      const res = await fetch("/api/skiptrace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      renderSingle(json);
      loadHistory();
    } catch (err) {
      showError(singleResult, err.message);
    }
  });

  singleForm?.addEventListener("input", debounce(refreshQuickLinks, 250));

  batchForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!batchFile.files.length) return;
    const fd = new FormData();
    fd.append("file", batchFile.files[0]);
    showResult(batchResult, "Processing batch — this may take a while at 6–8s per row, per site…");
    try {
      const res = await fetch("/api/batch", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Batch failed");
      renderBatch(json);
      loadHistory();
    } catch (err) {
      showError(batchResult, err.message);
    }
  });

  refreshBtn?.addEventListener("click", loadHistory);

  historyBody?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-delete]");
    if (!btn) return;
    const id = btn.getAttribute("data-delete");
    if (!confirm("Delete this search?")) return;
    const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
    if (res.ok) loadHistory();
  });

  function renderSingle({ query, result }) {
    const phones = (result.phones || []).map(p =>
      `<li><strong>${escape(p.number)}</strong> ${sourcePills(p.sources)} ${enrichmentForPhone(result, p.number)}</li>`
    ).join("");
    const emails = (result.emails || []).map(e =>
      `<li>${escape(e.email)} ${sourcePills(e.sources)}</li>`
    ).join("");
    const addrs = (result.addresses || []).map(a =>
      `<li>${escape(a.line)} ${sourcePills(a.sources)} ${enrichmentForAddress(result, a.line)}</li>`
    ).join("");
    const rels = (result.relatives || []).map(r =>
      `<li>${escape(r.name)} ${sourcePills(r.sources)}</li>`
    ).join("");

    const sources = (result.sources || []).map(renderSource).join("");
    const links = (result.quick_links || []).map(l =>
      `<a class="link" href="${escape(l.url)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`
    ).join("");
    const detailLinks = (result.detail_urls || []).map(u =>
      `<a class="link" href="${escape(u)}" target="_blank" rel="noopener">${escape(prettyHost(u))} detail ↗</a>`
    ).join("");

    singleResult.hidden = false;
    singleResult.innerHTML = `
      <div class="result-head">
        <h3>${escape(result.name || "Unknown")}</h3>
        <span class="pill">confidence ${result.confidence ?? 0}</span>
      </div>
      <div class="cols">
        <section>
          <h4>Phones</h4><ul>${phones || "<li class=\"muted\">None</li>"}</ul>
          <h4>Emails</h4><ul>${emails || "<li class=\"muted\">None</li>"}</ul>
          <h4>Addresses</h4><ul>${addrs || "<li class=\"muted\">None</li>"}</ul>
          <h4>Relatives / associates</h4><ul>${rels || "<li class=\"muted\">None</li>"}</ul>
        </section>
        <section>
          <h4>Sources</h4>
          <div class="source-grid">${sources || "<div class=\"muted\">No sources ran.</div>"}</div>
          ${detailLinks ? `<h4>Detail pages</h4><div class="links">${detailLinks}</div>` : ""}
          <h4>Open these manually</h4>
          <div class="links">${links}</div>
        </section>
      </div>
      ${result.notice ? `<div class="notice">${escape(result.notice)}</div>` : ""}
    `;
  }

  function renderSource(s) {
    const pillClass = {
      ok: "good", no_results: "muted", blocked: "bad", error: "bad", skipped: "muted",
    }[s.status] || "muted";
    const cacheTag = s.from_cache ? '<span class="tag">cached</span>' : "";
    return `
      <div class="src-card">
        <div class="src-head">
          <a href="${escape(s.url)}" target="_blank" rel="noopener" class="src-name">${escape(s.label)} ↗</a>
          <span class="pill ${pillClass}">${escape(s.status)}</span>
        </div>
        <div class="src-meta">
          ${s.result_count} hit${s.result_count === 1 ? "" : "s"} · ${s.elapsed_ms}ms ${cacheTag}
        </div>
        ${s.error ? `<div class="error small">${escape(s.error)}</div>` : ""}
      </div>
    `;
  }

  function enrichmentForPhone(result, num) {
    const e = (result.enrichment?.phones || []).find(p => p.number === num);
    if (!e) return "";
    if (e.error) return `<span class="muted small">(${escape(e.error)})</span>`;
    const bits = [e.type, e.carrier, e.location].filter(Boolean).map(escape).join(" · ");
    return bits ? `<span class="muted small">— ${bits}</span>` : "";
  }

  function enrichmentForAddress(result, line) {
    const e = (result.enrichment?.addresses || []).find(a => a.line === line);
    if (!e || e.error) return "";
    if (e.standardized) return `<span class="muted small">→ ${escape(e.standardized)}</span>`;
    return "";
  }

  function renderBatch({ count, rows }) {
    const trs = rows.map(({ query, result, error }) => {
      if (error) {
        return `<tr><td>${describeQuery(query)}</td><td colspan="4" class="error">${escape(error)}</td></tr>`;
      }
      const topPhone = (result.phones && result.phones[0]?.number) || "";
      const email = (result.emails && result.emails[0]?.email) || "";
      const okSources = (result.sources || []).filter(s => s.status === "ok").length;
      return `<tr>
        <td>${describeQuery(query)}</td>
        <td>${escape(topPhone)}</td>
        <td>${escape(email)}</td>
        <td>${okSources}/${(result.sources || []).length}</td>
        <td>${result.confidence ?? ""}</td>
      </tr>`;
    }).join("");
    batchResult.hidden = false;
    batchResult.innerHTML = `
      <h3>${count} row${count === 1 ? "" : "s"} processed</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Query</th><th>Top phone</th><th>Email</th><th>Sources OK</th><th>Conf.</th></tr></thead>
        <tbody>${trs || `<tr><td colspan="5" class="empty">No rows</td></tr>`}</tbody>
      </table></div>
    `;
  }

  async function loadHistory() {
    const res = await fetch("/api/history?limit=50");
    if (!res.ok) return;
    const { rows } = await res.json();
    if (!rows.length) {
      historyBody.innerHTML = `<tr><td colspan="7" class="empty">No searches yet.</td></tr>`;
      return;
    }
    historyBody.innerHTML = rows.map(r => {
      const q = describeQuery({
        name: r.name, address: r.address, city: r.city,
        state: r.state, zip: r.zip, phone: r.phone, email: r.email,
      });
      const phones = (r.result?.phones || []).map(p => p.number).join(", ");
      const emails = (r.result?.emails || []).map(e => typeof e === "string" ? e : e.email).join(", ");
      const conf = r.result?.confidence ?? "";
      const when = formatTime(r.created_at);
      return `<tr>
        <td>${escape(when)}</td>
        <td>${escape(r.source)}</td>
        <td>${q}</td>
        <td>${escape(phones)}</td>
        <td>${escape(emails)}</td>
        <td>${escape(String(conf))}</td>
        <td><button class="danger" data-delete="${r.id}">Delete</button></td>
      </tr>`;
    }).join("");
  }

  async function refreshQuickLinks() {
    if (!quickLinksEl) return;
    const data = Object.fromEntries(new FormData(singleForm).entries());
    const hasInput = ["name", "address", "phone", "email"].some(k => (data[k] || "").trim());
    if (!hasInput) {
      quickLinksEl.innerHTML = '<span class="muted small">Enter a name, address, or phone to enable quick links.</span>';
      return;
    }
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const { links } = await res.json();
      quickLinksEl.innerHTML = links.length
        ? links.map(l => `<a class="link" href="${escape(l.url)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`).join("")
        : '<span class="muted small">No matching link templates for these fields.</span>';
    } catch {
      /* silent */
    }
  }

  function describeQuery(q = {}) {
    const parts = [];
    if (q.name) parts.push(`<strong>${escape(q.name)}</strong>`);
    const addr = [q.address, q.city, q.state, q.zip].filter(Boolean).join(", ");
    if (addr) parts.push(escape(addr));
    if (q.phone) parts.push(escape(q.phone));
    if (q.email) parts.push(escape(q.email));
    return parts.join(" · ") || "<em>—</em>";
  }

  function sourcePills(srcs) {
    return (srcs || []).map(s => `<span class="pill src">${escape(s)}</span>`).join(" ");
  }

  function prettyHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return url; }
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function showResult(el, msg) {
    el.hidden = false;
    el.innerHTML = `<em>${escape(msg)}</em>`;
  }
  function showError(el, msg) {
    el.hidden = false;
    el.innerHTML = `<div class="error">${escape(msg)}</div>`;
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  loadHistory();
  refreshQuickLinks();
})();
