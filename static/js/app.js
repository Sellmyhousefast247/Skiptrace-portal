(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const singleForm = $("#single-form");
  const singleResult = $("#single-result");
  const batchForm = $("#batch-form");
  const batchFile = $("#batch-file");
  const batchResult = $("#batch-result");
  const historyBody = $("#history-table tbody");
  const refreshBtn = $("#refresh-history");

  singleForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(singleForm).entries());
    showResult(singleResult, "Searching…");
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

  batchForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!batchFile.files.length) return;
    const fd = new FormData();
    fd.append("file", batchFile.files[0]);
    showResult(batchResult, "Processing batch…");
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
      `<li>${escape(p.number)} — ${escape(p.type)} <span class="pill">${p.score}</span></li>`
    ).join("");
    const emails = (result.emails || []).map(e => `<li>${escape(e)}</li>`).join("");
    const addrs = (result.addresses || []).map(a =>
      `<li>${escape([a.line, a.city, a.state, a.zip].filter(Boolean).join(", "))} <span class="pill ${a.type === 'previous' ? 'warn' : ''}">${a.type}</span></li>`
    ).join("");
    const rels = (result.relatives || []).map(r => `<li>${escape(r)}</li>`).join("");
    singleResult.hidden = false;
    singleResult.innerHTML = `
      <h3>${escape(result.name || "Unknown")} <span class="pill">confidence ${result.confidence}</span></h3>
      <strong>Phones</strong><ul>${phones || "<li>None</li>"}</ul>
      <strong>Emails</strong><ul>${emails || "<li>None</li>"}</ul>
      <strong>Addresses</strong><ul>${addrs || "<li>None</li>"}</ul>
      <strong>Possible relatives</strong><ul>${rels || "<li>None</li>"}</ul>
      ${result.notice ? `<div class="notice">${escape(result.notice)}</div>` : ""}
    `;
  }

  function renderBatch({ count, rows }) {
    const headers = ["Query", "Top phone", "Email", "Confidence"];
    const trs = rows.map(({ query, result, error }) => {
      if (error) {
        return `<tr><td>${describeQuery(query)}</td><td colspan="3" class="error">${escape(error)}</td></tr>`;
      }
      const topPhone = (result.phones && result.phones[0]?.number) || "";
      const email = (result.emails && result.emails[0]) || "";
      return `<tr>
        <td>${describeQuery(query)}</td>
        <td>${escape(topPhone)}</td>
        <td>${escape(email)}</td>
        <td>${result.confidence ?? ""}</td>
      </tr>`;
    }).join("");
    batchResult.hidden = false;
    batchResult.innerHTML = `
      <h3>${count} row${count === 1 ? "" : "s"} processed</h3>
      <div class="table-wrap"><table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${trs || `<tr><td colspan="4" class="empty">No rows</td></tr>`}</tbody>
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
      const emails = (r.result?.emails || []).join(", ");
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

  function describeQuery(q = {}) {
    const parts = [];
    if (q.name) parts.push(`<strong>${escape(q.name)}</strong>`);
    const addr = [q.address, q.city, q.state, q.zip].filter(Boolean).join(", ");
    if (addr) parts.push(escape(addr));
    if (q.phone) parts.push(escape(q.phone));
    if (q.email) parts.push(escape(q.email));
    return parts.join(" · ") || "<em>—</em>";
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

  function escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  loadHistory();
})();
