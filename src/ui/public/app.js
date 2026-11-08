// webloop UI — 빌드 없는 바닐라 JS
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const badge = (s) => `<span class="badge s-${esc(s)}">${esc(s)}</span>`;
const active = (s) => ["queued", "running", "evaluating", "retrying"].includes(s);
const dur = (a, b) => { if (!a) return "-"; const ms = (b ? new Date(b) : new Date()) - new Date(a); const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
const fmt = (t) => (t ? new Date(t).toLocaleString() : "-");
let timer = null, es = null, selected = null;

function cleanup() { clearInterval(timer); timer = null; es?.close(); es = null; }

async function listView() {
  cleanup();
  const draw = async () => {
    const runs = await fetch("/api/runs").then((r) => r.json());
    $app.innerHTML = runs.length ? `<div class="wrap"><table><thead><tr><th>runId</th><th>종류</th><th>프로파일</th><th>브라우저</th><th>상태</th><th>회차</th><th>시작</th><th>소요</th></tr></thead><tbody>${runs.map((r) => `<tr data-id="${esc(r.runId)}"><td>${esc(r.runId)}</td><td>${esc(r.kind)}</td><td>${esc(r.profile)}</td><td>${esc(r.browser ?? "-")}</td><td>${badge(r.status)}</td><td>${r.currentIteration}/${r.maxIterations}</td><td>${fmt(r.createdAt)}</td><td>${dur(r.startedAt, r.endedAt)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">아직 실행 기록이 없습니다. <code>webloop send</code> 또는 <code>webloop run</code>을 실행해 보세요.</p>`;
    $app.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => go(`/runs/${tr.dataset.id}`)));
  };
  await draw();
  timer = setInterval(draw, 3000);
}

async function detailView(id) {
  cleanup();
  selected = null;
  const draw = async () => {
    const r = await fetch(`/api/runs/${id}`).then((x) => (x.ok ? x.json() : null));
    if (!r) { $app.innerHTML = `<p>실행을 찾을 수 없습니다: ${esc(id)}</p>`; return; }
    const n = selected ?? r.details.at(-1)?.iteration;
    const d = r.details.find((x) => x.iteration === n);
    const it = r.iterations.find((x) => x.iteration === n);
    $app.innerHTML = `
      <div class="top"><a href="/">← 목록</a><h2>${esc(r.runId)}</h2>${badge(r.status)}
        <span class="muted">${esc(r.profile)} · ${esc(r.browser ?? "-")} · ${r.currentIteration}/${r.maxIterations}회 · ${dur(r.startedAt, r.endedAt)}</span>
        <button id="stop" ${active(r.status) && !r.stopRequested ? "" : "disabled"}>${r.stopRequested && active(r.status) ? "중지 요청됨" : "중지"}</button></div>
      ${r.error ? `<div class="card s-failed" style="margin-bottom:12px">${esc(r.error.message)}${r.error.hint ? `<br><span class="muted">${esc(r.error.hint)}</span>` : ""}</div>` : ""}
      <div class="grid">
        <div class="card"><ul class="timeline">${r.iterations.map((i) => `<li data-n="${i.iteration}" class="${i.iteration === n ? "sel" : ""}">
          <b>${i.iteration}회차</b> ${i.passed === true ? "✓" : i.passed === false ? "✗" : "…"} <span class="muted">${esc(i.status)}${i.score !== undefined ? ` · score ${i.score}` : ""}${i.chars ? ` · ${i.chars}자` : ""}</span>
          ${i.reasons?.length ? `<div class="r">${esc(i.reasons.join("; "))}</div>` : ""}${i.error ? `<div class="r">${esc(i.error)}</div>` : ""}</li>`).join("") || `<li class="muted">대기 중…</li>`}</ul></div>
        <div class="card">${d ? `
          <h3>프롬프트</h3><pre>${esc(d.prompt)}</pre>
          <h3>응답</h3><pre>${esc(d.response ?? (active(r.status) ? "응답 대기 중…" : "(없음)"))}</pre>
          ${d.extra ? `<h3>추가 수집</h3><pre>${esc(JSON.stringify(d.extra, null, 2))}</pre>` : ""}
          ${d.eval ? `<h3>평가</h3><pre>${esc(d.eval.criteria.map((c) => `${c.passed ? "✓" : "✗"} ${c.type}${c.reason ? " — " + c.reason : ""}`).join("\n"))}</pre>` : ""}
          ${(it && !it.endedAt && d.live) || d.screenshot ? `<h3>${d.screenshot ? "스크린샷" : "라이브 화면"}</h3><img class="shot" src="${esc(d.screenshot ?? d.live)}?t=${Date.now()}">` : ""}` : `<p class="muted">회차를 선택하세요.</p>`}
        </div></div>`;
    $app.querySelectorAll(".timeline li[data-n]").forEach((li) => li.addEventListener("click", () => { selected = Number(li.dataset.n); draw(); }));
    document.getElementById("stop")?.addEventListener("click", async () => { await fetch(`/api/runs/${id}/stop`, { method: "POST" }); draw(); });
    if (!active(r.status)) cleanup();
  };
  await draw();
  es = new EventSource(`/api/runs/${id}/events`);
  let pending = false;
  es.onmessage = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; draw(); }, 400); };
  timer = setInterval(draw, 3000);
}

function go(path) { history.pushState(null, "", path); route(); }
function route() {
  const m = location.pathname.match(/^\/runs\/([\w-]+)$/);
  m ? detailView(m[1]) : listView();
}
addEventListener("popstate", route);
route();
