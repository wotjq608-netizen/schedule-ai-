# 개인 AI 비서 대시보드

`./start_server.sh`로 실행합니다. FastAPI, Uvicorn, httpx, Pydantic, python-dotenv가 설치되어 있지 않은 환경에서는 프로젝트의 가상환경에 `requirements.txt`를 설치합니다.

첫 실행용 관리자 암호는 이 프로젝트의 `.env`에 있습니다. 이 파일은 소유자만 읽고 쓸 수 있도록 생성되었습니다. 로그인에는 `ADMIN_USER`와 `ADMIN_PASS`를 사용합니다. 새 복사본에서는 `.env.example`을 참고해 관리자 값을 설정하세요.

현재 공개 주소는 https://narnialab.duckdns.org:8000 입니다. 포트는 기존의 8000을 유지하며, 프로젝트의 `.env`에서 `DASHBOARD_BIND=public`과 IPv4 접속을 설정했습니다. 카카오 설정이 없으므로 관리자로 로그인해야 대시보드와 일정 API를 사용할 수 있습니다. 로컬 접속만 허용하려면 `DASHBOARD_BIND=local`과 루프백 허용 목록으로 바꾸고 서버를 다시 실행합니다. TLS 호스트 이름을 유지하면서 서버에서 로컬 연결을 확인하려면 다음 명령을 실행합니다.

```bash
curl --noproxy '*' --resolve narnialab.duckdns.org:8000:127.0.0.1 \
  -o /dev/null -w '%{http_code}\n' https://narnialab.duckdns.org:8000/
```

접속 필터는 HTTP 전달 헤더 대신 직접 연결한 상대 IP를 `ALLOWED_CLIENT_NETWORKS`의 허용 목록과 비교합니다. 역방향 터널을 쓰면 앱에 보이는 IP는 터널의 연결 주소이므로 최종 사용자별 IP 제한은 터널 앞단에 적용해야 합니다.

API 키가 비어 있으면 규칙 기반 기본 엔진이 일정을 추출합니다. Gemini 또는 OpenAI의 키를 설정하면 대화 입력이 해당 제공자에게 전송됩니다. 두 키가 모두 있으면 Gemini를 먼저 사용합니다. 외부 API가 실패하면 다음 제공자 또는 기본 엔진으로 전환합니다. 날씨 기본 지역은 서울이며 `WEATHER_REGION`, `WEATHER_LAT`, `WEATHER_LON`으로 바꿀 수 있습니다. 실행 중인 서버는 시작 스크립트 재실행 시 그대로 유지되므로 환경 설정 변경은 신규 서버 시작 시 반영됩니다.

## Google Drive 저장 설정

[Google Cloud Console](https://console.cloud.google.com/apis/library/drive.googleapis.com)에서 Drive API를 활성화하고 OAuth 동의 화면을 설정합니다. 웹 애플리케이션 OAuth 클라이언트를 만들고 승인된 리디렉션 URI에 `https://developers.google.com/oauthplayground`를 추가합니다. [OAuth Playground](https://developers.google.com/oauthplayground/) 설정에서 **Use your own OAuth credentials**를 선택하고 해당 클라이언트 정보를 입력합니다. 범위로 `https://www.googleapis.com/auth/drive.appdata`만 요청하고, Google에서 권한을 승인한 뒤 코드를 토큰으로 교환합니다.

서버의 비밀 변수에 `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`을 넣고 `TASK_STORAGE=google-drive`를 설정합니다. 로컬 검증에서는 같은 값을 프로젝트 `.env`에 설정할 수 있습니다. Google OAuth 동의 화면이 외부 사용자 테스트 상태라면 재승인이 필요한 시점이 있을 수 있습니다. 토큰의 갱신 조건은 [Google OAuth 문서](https://developers.google.com/identity/protocols/oauth2#expiration)를 확인하세요.

데이터는 [Drive 앱 전용 공간](https://developers.google.com/workspace/drive/api/guides/appdata)의 `personal-ai-dashboard.sqlite3`에 저장됩니다. Drive 웹 파일 목록에서는 이 공간이 표시되지 않습니다. Drive DB가 아직 없으면 첫 실행 때 프로젝트의 로컬 DB를 읽어 가져옵니다. Drive DB가 이미 있으면 해당 DB를 사용합니다. 기존 일정을 가져오려면 같은 OAuth 앱과 계정으로 로컬에서 먼저 연결한 뒤 배포하세요. Docker 이미지에는 DB와 비밀 설정이 들어가지 않습니다.

배포 인스턴스와 Uvicorn 워커는 각 1개로 유지하세요. 로컬 앱에서 같은 Drive DB를 쓰고 있다면 중지한 뒤 배포 앱에서 사용하세요. 일정 변경마다 최대 5 MB의 SQLite 파일 전체를 저장합니다. Drive 응답이 끊긴 경우 앱에서 일정을 새로고침해 저장 결과를 확인한 뒤 다시 시도하세요.

## GitHub에서 배포하기

1. GitHub에 비공개 저장소를 만들고, 이 폴더의 소스와 배포 설정을 커밋한 뒤 그 저장소에 푸시합니다. `.env`, OAuth JSON, DB, 로그는 제외합니다.
2. Dockerfile을 빌드할 수 있는 호스팅에서 GitHub 저장소의 `main` 브랜치를 연결합니다. 로컬에서 이미지를 확인하려면 `docker build -t personal-ai-dashboard .`를 실행합니다.
3. 호스팅의 비밀 설정에 위 Google Drive 변수 3개와 `ADMIN_USER`, `ADMIN_PASS`를 넣습니다. 컨테이너 기본 포트는 8080이며 호스팅이 지정하는 `PORT`를 사용할 수 있습니다.
4. 호스팅의 HTTPS 프록시에서 TLS를 종료하고, 인스턴스 포트를 직접 인터넷에 노출하지 않습니다. `ALLOWED_CLIENT_NETWORKS`에는 앱에 직접 연결하는 HTTPS 프록시의 IP 대역을 지정합니다. 최종 사용자 IP 제한은 호스팅 인그레스에서 적용합니다. 기본 허용 목록은 루프백이므로 프록시 대역을 추가하기 전에는 외부 요청이 차단됩니다.
5. 비인증 요청이 401을, 인증 요청이 정상 응답을 반환하는지 확인합니다. 테스트 일정을 저장하고 앱을 재배포한 뒤 일정이 남아 있는지 확인합니다.

## 대화와 캘린더

대화는 현재 브라우저 탭에서 이어집니다. 외부 LLM을 쓰는 경우 최근 네 번의 대화와 새 메시지를 함께 보내고, 일정은 새 메시지에서만 추출합니다. 대화는 새로고침하면 초기화되며 저장된 일정은 유지됩니다. 답변 아래 저장된 일정의 버튼을 누르면 그 날짜의 상세 목록으로 이동합니다.

첫 화면의 예시 버튼을 누르면 고민이나 여러 일정이 입력창에 채워집니다. 전송하기 전에 문장을 바꿀 수 있습니다.

## Codex CLI 보조 엔진

현재 서버의 로컬 설정은 `CODEX_CLI_FALLBACK=1`입니다. API 키가 없거나 제공자가 오류를 반환하면 Codex CLI를 시도하고, CLI 인증이나 실행에도 실패하면 기본 엔진으로 전환합니다. Codex CLI 역시 계정의 사용 한도가 적용됩니다. 입력과 최근 문맥은 선택된 AI 제공자에게 전달됩니다.

일반 Docker 배포에서는 Codex CLI가 기본적으로 꺼져 있습니다. 배포 환경에 별도의 안전한 CLI 실행 파일과 승인된 인증 경로가 마련되기 전에는 API 엔진 또는 기본 엔진을 사용합니다. 로컬 CLI 인증 자료와 전용 작업 디렉터리는 Git과 Docker 빌드에서 제외됩니다.

프론트엔드, 서버, API, 터널과 호스팅 사이의 관계는 [구동 구성도](docs/architecture.html)를 참고하세요.

## 배포 전 검증

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v`로 관리자 로그인, 일정 추출·완료·삭제, CLI 전환, Drive 저장 실패와 앱 재시작 복원을 확인할 수 있습니다. 테스트는 임시 SQLite와 모의 외부 응답을 사용합니다.

실제 배포에서는 저장소·호스팅·Google OAuth를 연결한 뒤 README의 HTTPS와 재배포 복원 검증을 실행합니다. 동일한 Drive DB를 쓰는 이전 인스턴스를 중지한 다음 새 인스턴스를 실행해 동시 쓰기를 피합니다.

## 카카오 로그인

[카카오디벨로퍼스](https://developers.kakao.com/)에서 앱의 카카오 로그인을 활성화하고, 앱의 REST API 키 설정에 실제 접속 주소의 `/auth/kakao/callback`을 리다이렉트 URI로 등록합니다. 예를 들어 배포 주소가 `https://dashboard.example`이면 콜백은 `https://dashboard.example/auth/kakao/callback`입니다. 카카오톡 메시지 발송이나 연락처 권한은 사용하지 않습니다. [카카오 로그인 REST API 문서](https://developers.kakao.com/docs/ko/kakaologin/rest-api)

다음 값은 프로젝트 `.env` 또는 호스팅의 비밀 변수에 등록합니다.

- `KAKAO_REST_API_KEY`에는 앱의 REST API 키를 넣습니다.
- `KAKAO_CLIENT_SECRET`에는 클라이언트 시크릿 기능을 사용하는 경우 발급받은 값을 넣습니다.
- `KAKAO_REDIRECT_URI`에는 앱에 등록한 HTTPS 콜백 주소를 그대로 넣습니다.
- `SESSION_SECRET`에는 `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`로 생성한 비밀값을 넣습니다. 모든 재시작에서 같은 값을 유지합니다.

설정 후 서버를 다시 시작하면 첫 화면이 카카오 로그인으로 전환됩니다. 앱 내부 로그인은 8시간 동안 유지되고 로그아웃은 이 대시보드의 세션을 종료합니다. 서버는 계정 식별에 필요한 카카오 사용자 ID만 사용하고 로그인 토큰과 프로필은 저장하지 않습니다. 호스팅 프록시가 요청 URL을 기록할 경우 콜백 쿼리 문자열은 기록에서 제외합니다.

기존 관리자 일정은 DB에 보존됩니다. 본인 카카오 계정의 앱별 사용자 ID가 확인되면 `KAKAO_LEGACY_OWNER_ID`에 그 값을 넣어 기존 일정을 해당 계정으로 한 번 옮길 수 있습니다. 옮긴 뒤 이 변수를 비웁니다. 값이 비어 있으면 이전 일정은 카카오 계정 화면에 표시되지 않습니다. SQLite와 Drive 모드에서 모두 적용됩니다. 카카오 로그인 모드에서는 관리자 Basic 인증만으로 일정 API에 들어갈 수 없습니다.

미인증 HTTPS 검사 결과는 관리자 모드에서 `401`, 카카오 모드에서 로그인 페이지로 이동하는 `303`입니다. 로컬에서 테스트를 실행하려면 `.venv/bin/python -B -m unittest -v`를 사용합니다. 가상환경이 없다면 `python3 -m venv .venv`로 만든 뒤 `.venv/bin/python -m pip install -r requirements.txt`를 실행합니다.

## 관리자 로그인 기록

로그인 화면의 **관리자 모드** 링크 또는 `/admin`에서 서버의 `ADMIN_USER`와 `ADMIN_PASS`로 인증합니다. 카카오 세션은 관리자 권한을 부여하지 않습니다. 배포 환경의 비밀 설정에 관리자 계정을 설정하고, 외부에 공개할 때는 다른 곳에서 사용하지 않은 비밀번호를 사용합니다.

카카오 인증을 마칠 때마다 한국 표준시 기준 로그인 시각과 계정을 구별할 수 있는 식별자를 기록합니다. 같은 계정의 식별자를 유지하려면 `SESSION_SECRET`을 계속 사용합니다. 로그인 기록은 일정과 같은 설정의 SQLite 또는 Drive 저장소에 보관됩니다. 기존 로그인은 소급해서 기록하지 않습니다.

## Playwright

GitHub Actions는 푸시와 PR에서 Python 회귀 테스트와 Chromium 로그인 테스트를 실행합니다. 브라우저 테스트는 임시 DB와 모의 카카오 OAuth 응답을 사용합니다.

로컬에서 Python 의존성을 설치하고 OpenSSL을 PATH에 둔 뒤 아래 명령을 실행합니다.

```sh
npm ci
npx playwright install chromium
npm test
```

저장소의 `.codex/config.toml`은 이 프로젝트를 신뢰한 Codex 세션에서 Playwright MCP를 격리 프로필로 실행합니다. 터미널에서는 `npm run mcp`로 같은 버전의 서버를 시작할 수 있습니다.

## Windows에서 네 페이지 실행

폴더에서 PowerShell을 열고 `powershell -NoProfile -ExecutionPolicy Bypass -File .\start_windows.ps1`을 실행합니다.
카카오 설정이 없는 로컬 모드에서는 콘솔이 보여 주는 계정으로 로그인합니다. 관리자 아이디와 암호를 직접 관리하려면 `env.example`을 `.env`로 복사하고 `ADMIN_USER`, `ADMIN_PASS`를 설정하세요.

1. `/login` — 카카오 로그인 또는 로컬 관리자 인증
2. `/architecture` — 브라우저·호스팅·터널·서버·외부 API 연결 구성도
3. `/schedule` — 기존 일정 기능 및 서울 기본 날씨, 기온에 따른 톤온톤·3색 조합
4. `/materials` — 원고나 메모 정리, 음성 전사, 결과 복사·텍스트 저장

음성 전사에는 서버의 `OPENAI_API_KEY`가 필요합니다. 파일 제한은 24 MB이며, 성공하면 편집 가능한 전사문이 입력창에 추가됩니다. 자료 정리는 OpenAI 또는 Gemini를 사용하며, 둘 다 설정하지 않으면 기본 문장 분류를 사용합니다. 외부 서비스를 사용할 때 전사 파일이나 정리할 텍스트를 해당 API에 전송합니다. 이 앱은 자료 정리 요청이나 결과를 일정 DB에 저장하지 않습니다.

## 화면 오른쪽 아래 챗봇

질문에는 Gemini 또는 OpenAI로 답변하고, 알람·날씨·찜 목록 명령은 앱에서 처리합니다. 예를 들어 `내일 7시에 알람 맞춰 줘`, `부산 내일 날씨랑 옷차림`, `저소음 키보드 찜해줘`, `2번 찜해줘`를 입력할 수 있습니다. 알람에서 오전/오후를 생략한 시간은 24시간제로 해석합니다.

알람과 찜은 계정별로 저장됩니다. 웹 알람은 페이지가 열려 있고 기기가 깨어 있을 때 울리며, 브라우저 소리 재생 제한을 풀려면 페이지에서 챗봇을 한 번 사용해야 합니다. 음성 입력은 브라우저의 한국어 인식을 사용하며, 브라우저에서 인식을 지원하지 않으면 녹음 후 서버 전사를 이용할 수 있습니다. 서버 전사에는 `OPENAI_API_KEY`가 필요합니다. 상품 검색은 다나와·롯데ON의 공개 상품 정보를 비교하며, OpenAI 웹 검색은 키가 연결된 경우 추가 검색에 사용합니다. 가격과 리뷰의 출처를 모두 확인한 상품만 최대 3개를 표시합니다.

`/shop`은 계정별 찜 목록을 표시합니다. Gemini 설정이 있으면 챗봇 문장을 구조화해 날씨·알람·상품·찜 명령으로 연결하며, 조회값과 저장은 앱의 해당 기능에서 처리합니다.

관리자 대시보드는 `/admin`에서 기존 관리자 인증으로 접근합니다. 계정 식별자 또는 IP로 성공한 로그인 기록을 검색할 수 있습니다. 이전 기록에 IP를 소급 저장하지 않습니다. Render에서는 프록시가 제공하고 전달 헤더와 일치하는 IP만 기록합니다.

### 업무 보고서

일정 관리의 달성률 기준은 한국 시간 기준 오늘의 완료 건수 / 예정 건수입니다. 업무 5건에 각각 1~5점의 우선순위를 입력하고 보고서를 생성하면 현재 집계를 저장합니다. 자료 정리 페이지에서는 정리 결과가 보고서 폼에 자동으로 들어갑니다. 보고서 이력에서 조회하거나 Markdown으로 내려받을 수 있습니다.

CrewAI는 기존 GEMINI_API_KEY와 GEMINI_MODEL을 사용합니다. 카카오맵을 활성화한 앱의 REST API 키로 주소 검색과 카카오모빌리티 자동차 길찾기를 호출합니다. 기본값은 기존 KAKAO_REST_API_KEY입니다. 별도 앱을 쓸 때는 KAKAO_MOBILITY_REST_API_KEY를 설정합니다. 무료 쿼터만 쓰려면 카카오 콘솔에서 유료 API를 활성화하지 마세요. 현재 위치를 허용하거나 출발지 주소를 입력하면 방문 주소와 출발지로 자동차 경로를 비교합니다. 방문은 최대 5곳이며 보고서 한 건에 구간 조회를 최대 25회 수행합니다. 경로 조회가 불가능하면 우선순위 점수순으로 정리합니다. 지도 좌표는 저장하지 않으며 주소와 업무명은 보고서에 포함됩니다.
