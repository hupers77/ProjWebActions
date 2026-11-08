import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * 테스트용 가짜 채팅 사이트.
 * - 응답을 글자 단위로 스트리밍하고, 생성 중에는 Stop 버튼이 보인다.
 * - 같은 대화에서 n번째 질문이면 n단계 답변을 준다(1: 설치, 2: +사용법, 3: +장단점) → 반복 루프 테스트용.
 * - /ce 는 Perplexity처럼 contenteditable 입력창을 쓴다.
 * - /download 는 응답 후 다운로드 링크를 보여준다.
 * - /login 은 로그인 페이지(authCheck 테스트용).
 */
const page = (opts: { editable: boolean; download: boolean }) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Mock Chat</title>
<style>.message{margin:8px;padding:8px;border:1px solid #ccc} #stop{display:none}</style></head>
<body>
<button aria-label="New chat" id="new">새 대화</button>
<div id="log"></div>
${opts.editable ? `<div id="ask-input" contenteditable="true" role="textbox" style="min-height:40px;border:1px solid #999"></div>` : `<textarea id="prompt" rows="3" cols="60"></textarea>`}
<button type="submit" id="send" aria-label="Submit">보내기</button>
<button id="stop" aria-label="Stop">중지</button>
<script>
let turns = 0;
const log = document.getElementById('log');
const input = document.getElementById(${opts.editable ? "'ask-input'" : "'prompt'"});
const val = () => ${opts.editable ? "input.innerText" : "input.value"};
const clear = () => { ${opts.editable ? "input.innerText = ''" : "input.value = ''"}; };
function answerFor(q, n) {
  if (/^echo:/.test(q)) return q.slice(5);
  const parts = ['## 목차', '1. 설치 방법: 프로그램을 내려받아 설치합니다.'];
  if (n >= 2) parts.push('2. 사용법: 복구할 드라이브를 선택하고 **스캔**합니다.');
  if (n >= 3) parts.push('3. 장단점: 무료이지만 속도가 느립니다.');
  parts.push('', '(답변 ' + n + '회차)');
  return parts.join('\\n');
}
function send() {
  const q = val().trim();
  if (!q) return;
  turns++;
  const u = document.createElement('div'); u.className = 'message user'; u.textContent = q; log.appendChild(u);
  clear();
  const stop = document.getElementById('stop');
  stop.style.display = 'inline-block';
  const full = answerFor(q, turns);
  setTimeout(() => {
    const a = document.createElement('div'); a.className = 'message assistant'; log.appendChild(a);
    const pre = document.createElement('div'); pre.className = 'md'; a.appendChild(pre);
    let i = 0;
    const t = setInterval(() => {
      i += 7;
      pre.innerText = full.slice(0, i);
      if (i >= full.length) {
        clearInterval(t);
        stop.style.display = 'none';
        const src = document.createElement('a'); src.className = 'source'; src.href = 'https://example.com/src' + turns; src.textContent = '출처 ' + turns; a.appendChild(src);
        ${opts.download ? `const d = document.createElement('a'); d.className='download'; d.textContent='다운로드'; d.href='data:text/plain;charset=utf-8,' + encodeURIComponent(full); d.download='answer.txt'; a.appendChild(d);` : ""}
      }
    }, 40);
  }, 300);
}
document.getElementById('send').onclick = send;
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
document.getElementById('new').onclick = () => { log.innerHTML = ''; turns = 0; };
</script></body></html>`;

export async function startMockSite(port = 0): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/login") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end("<!doctype html><title>Login</title><h1>로그인 필요</h1>");
    }
    if (u.pathname === "/needs-login") {
      res.writeHead(302, { location: "/login" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page({ editable: u.pathname === "/ce", download: u.pathname === "/download" }));
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, close: () => new Promise((r) => server.close(() => r())) };
}
