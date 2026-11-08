# 테스트 방법 (GitHub Actions 사용 안 함)

빌드·테스트는 모두 로컬 PC에서 합니다.

## 공통

```bash
npm install
npm run build
npm run test:unit        # 브라우저 없이 도는 단위 테스트
```

## macOS + Whale (개발 테스트)

```bash
npm run build
WEBLOOP_TEST_BROWSER=whale npm run test:e2e              # 목업 사이트 대상 전체 흐름 (창 숨김)
WEBLOOP_TEST_BROWSER=whale WEBLOOP_TEST_HEADED=1 npm run test:e2e   # 창을 보면서
```

Whale이 기본 위치(`/Applications/Whale.app`)가 아니면 `WEBLOOP_WHALE_PATH=<실행파일 경로>`를 함께 지정합니다.

실제 사이트 점검:

```bash
node dist/cli/index.js --browser whale profile test perplexity
node dist/cli/index.js --browser whale profile test perplexity --send "안녕하세요"
node dist/cli/index.js --browser whale send -p perplexity --prompt "오늘 서울 날씨 알려줘"
```

## Windows + Edge (실사용 PC) 점검표

PowerShell에서:

```powershell
npm install
npm run build
$env:WEBLOOP_TEST_BROWSER = "edge"; npm run test:e2e
node dist/cli/index.js doctor
node dist/cli/index.js --browser edge profile test perplexity --send "안녕하세요"
node dist/cli/index.js --browser edge --json send -p perplexity --prompt-file .\q.txt --out .\answer.md
```

- [ ] `doctor`가 Edge 경로를 찾는다
- [ ] 한글 프롬프트(파일·인자 모두)가 깨지지 않고 전송된다
- [ ] `answer.md`가 UTF-8로 저장되고 한글이 정상이다
- [ ] `webloop ui` → 브라우저로 `http://127.0.0.1:4777` 접속, 진행이 보이고 중지 버튼이 동작한다
- [ ] 경로에 공백/한글이 있는 폴더에서 실행해도 동작한다
