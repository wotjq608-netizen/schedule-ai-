(() => {
  "use strict";
  const get = name => document.getElementById("assistant-" + name);
  const panel = get("panel"), log = get("log"), input = get("input"), status = get("status");
  const korea = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit"});
  const alarmFormat = new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul", dateStyle:"long", timeStyle:"short"});
  const cities = "서울 부산 인천 대구 대전 광주 울산 세종 수원 제주 춘천 청주 전주 포항 창원 성남".split(" ");
  const history = [];
  const scope = panel.closest(".assistant-widget").dataset.scope;
  const weatherPref = "assistant-weather:" + scope;
  const candidateKey = "assistant-products:" + scope;
  let candidates = readCandidates(), comparisonShown = false;

  function readCandidates() {
    try {
      const value = JSON.parse(sessionStorage.getItem(candidateKey));
      return value?.expires > Date.now() && Array.isArray(value.products) ? value.products : [];
    } catch { return []; }
  }

  function rememberCandidates(products) {
    candidates = products;
    try {
      if (products.length) sessionStorage.setItem(candidateKey, JSON.stringify({products, expires:Date.now() + 3600000}));
      else sessionStorage.removeItem(candidateKey);
    } catch {}
  }
  let pending = null, busy = false, audioContext, alarmTimer, checking = false;
  let nextAlarms = [];
  const setOpen = (open, focus = true) => {
    panel.hidden = !open;
    get("open").setAttribute("aria-expanded", String(open));
    if (open && !comparisonShown && candidates.length) {
      bubble("최근 비교한 상품입니다. ‘2번 찜 목록에 추가해줘’처럼 선택하세요.");
      showProducts(candidates, "최근 상품 비교");
      comparisonShown = true;
    }
    if (focus) (open ? input : get("open")).focus();
  };
  get("open").onclick = () => { unlockSound(); setOpen(panel.hidden); };
  get("close").onclick = () => setOpen(false);
  panel.addEventListener("keydown", event => { if (event.key === "Escape") setOpen(false); });

  function speak(message) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "ko-KR";
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  function bubble(message, user = false, voice = false) {
    const element = document.createElement("p");
    if (user) element.className = "assistant-user";
    element.textContent = message;
    log.append(element);
    log.scrollTop = log.scrollHeight;
    if (voice) speak(message);
  }

  async function api(path, data) {
    const response = await fetch("/api/assistant/" + path, data === undefined ? {} : {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "요청을 완료하지 못했습니다.");
    return payload;
  }

  function showProducts(products, heading) {
    const list = document.createElement("div");
    list.className = "assistant-products";
    list.setAttribute("aria-label", heading);
    products.forEach((product, index) => {
      const card = document.createElement("article"), h = document.createElement("h3");
      h.textContent = (index + 1) + ". " + product.name;
      const detail = document.createElement("p");
      detail.textContent = product.tier + " · " + product.price.toLocaleString("ko-KR") +
        "원 · 평점 " + product.rating + "/5 · 상품평 " + product.reviews.toLocaleString("ko-KR") + "개\n" + product.note;
      card.append(h, detail);
      for (const [url, label] of [[product.url, "가격 출처"], [product.review_url, "상품평 출처"]]) {
        if (!url.startsWith("https://")) continue;
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = label;
        card.append(link);
      }
      list.append(card);
    });
    log.append(list);
    log.scrollTop = log.scrollHeight;
  }

  function wishlist() {
    if (location.pathname === "/shop") {
      location.hash = "saved";
      location.reload();
      return;
    }
    location.assign("/shop#saved");
  }

  async function compare(query) {
    rememberCandidates([]);
    const {products} = await api("compare", {text:query});
    if (!products.length) {
      bubble("가격과 상품평 출처를 모두 확인한 상품을 찾지 못했어요. 제품명이나 조건을 바꿔 다시 검색해 주세요.");
      return;
    }
    rememberCandidates(products);
    comparisonShown = true;
    bubble(products.length + "개 상품을 확인했어요. ‘2번 찜해줘’처럼 번호나 상품명으로 골라 주세요. 가격은 검색 시점 기준입니다.");
    showProducts(products, "상품 비교 결과");
  }

  function alarmTime(text) {
    const date = text.match(/(\d{4}-\d{2}-\d{2})/);
    const time = text.match(/(?:오전\s*|오후\s*|저녁\s*|아침\s*|새벽\s*)?(\d{1,2})\s*(?:시(?:\s*(\d{1,2})\s*분|\s*(반))?|[:：](\d{2}))/);
    if (!time) return null;
    let hour = Number(time[1]);
    const minute = Number(time[2] ?? (time[3] ? 30 : time[4] ?? 0));
    if (hour > 23 || minute > 59) return null;
    if (/오후|저녁/.test(time[0]) && hour >= 1 && hour <= 12) hour = hour % 12 + 12;
    if (/오전|아침|새벽/.test(time[0]) && hour === 12) hour = 0;
    const now = Date.now(), days = /모레/.test(text) ? 2 : /내일/.test(text) ? 1 : 0;
    const day = date?.[1] || korea.format(now + days * 86400000);
    const iso = day + "T" + String(hour).padStart(2,"0") + ":" + String(minute).padStart(2,"0") + ":00+09:00";
    if (!Number.isFinite(Date.parse(iso)) || korea.format(new Date(iso)) !== day || Date.parse(iso) <= now) return null;
    return iso;
  }

  async function createAlarm(time, voice) {
    await api("alarms", {time});
    bubble(alarmFormat.format(new Date(time)) + "에 웹 알람을 설정했어요. 페이지가 열려 있고 기기가 깨어 있을 때 울립니다.", false, voice);
    await refreshAlarms();
  }

  function unlockSound() {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    } catch {}
  }

  function ringSound() {
    if (audioContext?.state !== "running") return false;
    const clock = audioContext.currentTime;
    for (let i = 0; i < 4; i++) {
      const tone = audioContext.createOscillator(), gain = audioContext.createGain();
      const start = clock + i * .4;
      tone.frequency.value = 680 + 100 * (i % 2);
      gain.gain.setValueAtTime(.11, start);
      gain.gain.exponentialRampToValueAtTime(.001, start + .24);
      tone.connect(gain).connect(audioContext.destination);
      tone.start(start);
      tone.stop(start + .25);
    }
    return true;
  }

  function scheduleRing() {
    clearTimeout(alarmTimer);
    if (nextAlarms.length) alarmTimer = setTimeout(checkAlarms,
      Math.min(2147483647, Math.max(0, Date.parse(nextAlarms[0].due) - Date.now())));
  }

  async function checkAlarms() {
    if (checking) return;
    checking = true;
    clearTimeout(alarmTimer);
    try {
      while (nextAlarms.length && Date.parse(nextAlarms[0].due) <= Date.now()) {
        const alarm = nextAlarms[0];
        const {ring} = await api("alarms/" + alarm.id + "/ring", {});
        nextAlarms.shift();
        if (!ring) continue;
        setOpen(true, false);
        bubble("알람 · " + alarmFormat.format(new Date(alarm.due)), false, !ringSound());
      }
      scheduleRing();
    } catch {
      alarmTimer = setTimeout(refreshAlarms, 30000);
    } finally {
      checking = false;
    }
  }

  async function refreshAlarms() {
    try {
      const {alarms} = await api("alarms");
      nextAlarms = alarms;
      await checkAlarms();
    } catch {}
  }
  window.addEventListener("focus", refreshAlarms);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAlarms(); });
  refreshAlarms();

  async function weather(text, intent) {
    const named = cities.find(city => text.includes(city));
    const match = text.match(/([가-힣]{2,14})(?:시|군|구)(?:의|에서|에|\s)/);
    const prefix = text.match(/([가-힣]{2,14})(?:의)?\s+(?:(?:오늘|내일|모레)\s+)?(?:날씨|온도|기온|옷차림|착장)/);
    const reserved = /^(오늘|내일|모레|지금|현재|이번|주말|지역|알려줘|추천|비교|최신)$/;
    let remembered = "";
    try { remembered = localStorage.getItem(weatherPref) || ""; } catch {}
    const alternative = prefix?.[1].replace(/의$/, "");
    const city = named || intent?.city || match?.[1] || (alternative && !reserved.test(alternative) ? alternative : "") || remembered;
    const day = /모레/.test(text) ? 2 : /내일/.test(text) ? 1 : intent?.day || 0;
    const params = new URLSearchParams({city, day:String(day)});
    const data = await api("weather?" + params);
    const when = ["오늘","내일","모레"][day] || data.date;
    const rain = data.rain > 0 || data.probability >= 45;
    const temperature = day ? (data.low + data.high) / 2 : data.temperature;
    const outfit = temperature < 10 ? ["아이보리","네이비","버건디","도톰한 겉옷"]
      : temperature < 20 ? ["화이트","올리브","브라운","가벼운 겉옷"]
      : ["크림","연청","테라코타","통기성 있는 옷"];
    const summary = data.region + " " + when + " " + (day ? "" : "현재 " + data.temperature + "도, ") +
      "최저 " + data.low + "도, 최고 " + data.high + "도. " +
      (data.probability === null ? "강수확률 정보 없음." : "최대 강수확률 " + data.probability + "퍼센트.") +
      (data.rain > 0 ? " 예상 비 " + data.rain.toFixed(1) + "밀리미터." : " 예보상 비의 양은 0밀리미터입니다.");
    const clothing = "\n3색 착장. 상의 " + outfit[0] + ", 하의 " + outfit[1] + ", " +
      (rain ? "방수 신발이나 우산 " : "신발이나 소품 ") + outfit[2] + ". " + outfit[3] + "을 추천해요.";
    bubble(summary + clothing, false, true);
  }

  const affirmative = /^(네|예|응|좋아|그래|확인|맞아|진행(?:해\s*줘)?|실행(?:해\s*줘)?|설정(?:해\s*줘)?)[.! ]*$/;
  const negative = /^(아니(?:요)?|취소(?:해\s*줘)?|그만|하지\s*마)[.! ]*$/;
  const question = /라고\s*(?:하면|말하면)|예를\s*들면|[?？]\s*$|수\s*있|줄\s*(?:래|수)|(?:되|가능)(?:니|나요|한가요|해요|해|요|까)|(?:어떻게|방법|인지|설정돼|있어|있나요)|뭐야|인가요/;
  const directive = /해\s*줘|맞춰\s*줘|맞춰|설정(?:해|하라)|등록(?:해|하라)|추가(?:해|하라)|골라|찜(?:해|하라)|비교해|찾아\s*줘|부탁/;

  async function handle(text, voice) {
    if (negative.test(text)) {
      pending = null;
      bubble("진행을 취소했어요.", false, voice);
      return;
    }
    if (pending && affirmative.test(text)) {
      const task = pending;
      pending = null;
      if (task.kind === "alarm") return createAlarm(task.time, voice);
      if (task.kind === "compare") return compare(task.query);
      if (task.kind === "save") { await api("wishlist", task.product); return wishlist(); }
    }
    if (/하지\s*(?:마|말)|주지\s*(?:마|말)|말아\s*줘|맞추지\s*(?:마|말)/.test(text)) {
      pending = null;
      bubble("요청을 실행하지 않았어요.", false, voice);
      return;
    }
    const number = text.match(/^\s*([1-3])(?:[.! ]*$|\s*번)/)?.[1] || text.match(/([1-3])\s*번/)?.[1];
    const koreanNumber = text.match(/(첫|두|세)\s*번째/)?.[1];
    const choice = number ? Number(number) : ({첫:1,두:2,세:3}[koreanNumber] || 0);
    const normalized = text.toLowerCase().replace(/\s+/g, "");
    const product = choice ? candidates[choice - 1] :
      candidates.find(item => normalized.includes(item.name.toLowerCase().replace(/\s+/g, "")));
    const selection = /^\s*(?:[1-3]\s*번?|(?:첫|두|세)\s*번째)[.! ]*$/.test(text);
    const saveIntent = /찜|저장|선택|골라|담아|추가/.test(text);
    if (product && (selection || saveIntent || normalized === product.name.toLowerCase().replace(/\s+/g, ""))) {
      if (/빼고|제외/.test(text)) {
        bubble("선택한 상품을 저장하지 않았어요.", false, voice);
        return;
      }
      if (question.test(text)) {
        if (!saveIntent) {
          showProducts([product], "선택 상품 정보");
          return;
        }
        pending = {kind:"save", product};
        bubble(product.name + "을 찜할까요? ‘네’라고 답하면 저장해요.", false, voice);
        return;
      }
      await api("wishlist", product);
      pending = null;
      return wishlist();
    }
    if (choice && (selection || saveIntent)) {
      bubble(candidates.length ? "비교 카드에 표시된 번호를 골라 주세요." :
        "먼저 상품을 비교해 주세요. ‘저소음 키보드 찜해줘’라고 입력하면 후보를 보여드려요.");
      return;
    }
    if (/찜\s*목록|위시리스트/.test(text) && !/추가|담아|넣어|저장/.test(text)) return wishlist();
    const intent = (await api("interpret", {text}).catch(() => ({}))).intent;
    if (intent?.action === "cancel") {
      pending = null;
      bubble("요청을 실행하지 않았어요.", false, voice);
      return;
    }
    if (intent?.action === "wishlist" && !/추가|담아|넣어|저장/.test(text)) return wishlist();
    if (intent?.action === "weather" || (/날씨|기온|온도|강수|비\s*(?:와|오|예보|올)|옷차림|착장|뭐\s*입/.test(text) && !/상품|쇼핑|키보드/.test(text))) {
      return weather(text, intent);
    }
    if (/알람|알림/.test(text) || pending?.kind === "alarm-time" || ["alarm","alarm_list"].includes(intent?.action)) {
      if (intent?.action === "alarm_list" || /목록|맞춰\s*(?:놨|졌)|설정돼|몇\s*시에\s*맞/.test(text)) {
        const {alarms} = await api("alarms");
        bubble(alarms.length ? alarms.map(a=>alarmFormat.format(new Date(a.due))).join("\n") : "예정된 알람이 없어요.", false, voice);
        return;
      }
      if (/하지\s*마|맞추지\s*마|끄|삭제|취소/.test(text)) {
        pending = null;
        bubble("알람을 추가하지 않았어요. 저장된 알람 삭제는 아직 지원하지 않아요.", false, voice);
        return;
      }
      const literalTime = alarmTime(text);
      const proposed = intent?.action === "alarm" ? intent.alarm_at : "";
      const inferred = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00)?\+09:00$/.test(proposed) && Date.parse(proposed) > Date.now();
      const time = literalTime || (inferred ? proposed : "");
      if (!time) {
        pending = {kind:"alarm-time"};
        bubble("알람 설정을 할 수 있어요. ‘내일 오전 7시’처럼 앞으로의 날짜와 시간을 확인해 주세요.", false, voice);
        return;
      }
      if (!literalTime || question.test(text) || intent?.mode === "confirmation" || (!directive.test(text) && pending?.kind !== "alarm-time")) {
        pending = {kind:"alarm", time};
        bubble(alarmFormat.format(new Date(time)) + "에 설정할 수 있어요. 알람을 설정할까요? ‘네’라고 답해 주세요.", false, voice);
        return;
      }
      pending = null;
      return createAlarm(time, voice);
    }
    if (intent?.action === "compare" || (/찜|상품\s*비교|가격\s*비교|구매\s*추천/.test(text) && !/하지\s*마|하지\s*말/.test(text))) {
      const query = (intent?.action === "compare" && intent.query) || text.replace(/(?:을|를)?\s*(?:찜|상품\s*비교|가격\s*비교|구매\s*추천).*$/, "").trim()
        || text.replace(/^(?:찜할|상품\s*비교|가격\s*비교)\s*/, "").trim();
      if (!query || query === text && /^찜/.test(text)) {
        bubble("어떤 상품을 찾을까요? ‘저소음 키보드 찜해줘’처럼 입력해 주세요.", false, voice);
        return;
      }
      if (intent?.mode === "confirmation" || (question.test(text) && /찜|가능|수\s*있/.test(text))) {
        pending = {kind:"compare", query};
        bubble("가격과 상품평을 비교할 수 있어요. " + query + " 상품을 찾아 볼까요? ‘네’라고 답해 주세요.", false, voice);
        return;
      }
      pending = null;
      return compare(query);
    }
    const {reply} = await api("ask", {text, history:history.slice(-8)});
    bubble(reply || "질문에 답할 내용을 찾지 못했어요.", false, voice);
    history.push("사용자: " + text, "비서: " + reply);
    if (history.length > 8) history.splice(0, history.length - 8);
  }

  async function submit(text, voice = false) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    input.value = "";
    get("send").disabled = true;
    status.textContent = "처리 중…";
    bubble(text, true);
    try {
      await handle(text.slice(0, 500), voice);
      status.textContent = "";
    } catch (error) {
      bubble(error.message || "요청을 완료하지 못했어요.", false, voice);
      status.textContent = "";
    } finally {
      busy = false;
      get("send").disabled = false;
    }
  }
  get("form").onsubmit = event => { event.preventDefault(); unlockSound(); submit(input.value); };
  document.getElementById("shop-chat")?.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    const field = document.getElementById("shop-query");
    const text = field.value.trim();
    if (!text) return;
    field.value = "";
    unlockSound();
    setOpen(true);
    submit(text);
  });

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recorder;
  async function recordSpeech() {
    if (recorder?.state === "recording") { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      status.textContent = "이 브라우저는 음성 입력을 지원하지 않습니다. 문장을 입력해 주세요.";
      return;
    }
    let stream;
    try {
      get("mic").disabled = true;
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        clearTimeout(limit);
        stream.getTracks().forEach(track => track.stop());
        get("mic").disabled = true;
        get("mic").setAttribute("aria-label", "음성 입력");
        status.textContent = "음성을 글로 옮기는 중…";
        try {
          const type = recorder.mimeType;
          const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
          const response = await fetch("/api/materials/transcribe?extension=" + ext, {
            method:"POST", headers:{"Content-Type":"application/octet-stream"}, body:new Blob(chunks, {type})
          });
          const result = await response.json();
          if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "음성을 읽지 못했습니다.");
          await submit(result.text, true);
        } catch (error) {
          status.textContent = error.message;
        } finally {
          get("mic").disabled = false;
        }
      };
      recorder.start();
      const limit = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 15000);
      get("mic").disabled = false;
      get("mic").setAttribute("aria-label", "녹음 끝내기");
      status.textContent = "녹음 중… 마이크를 다시 누르면 OpenAI로 전송해 글로 옮깁니다.";
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      get("mic").disabled = false;
      status.textContent = "녹음할 수 없습니다. 마이크 권한을 확인하거나 문장을 입력해 주세요.";
    }
  }
  get("mic").onclick = () => {
    unlockSound();
    if (busy) return;
    if (!Recognition) { recordSpeech(); return; }
    window.speechSynthesis?.cancel();
    const recognition = new Recognition();
    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.onstart = () => { status.textContent = "듣는 중…"; get("mic").disabled = true; };
    recognition.onresult = event => submit(event.results[0][0].transcript, true);
    recognition.onerror = event => {
      if (event.error === "network" || event.error === "service-not-allowed") {
        get("mic").onclick = recordSpeech;
        status.textContent = "브라우저 음성 인식을 사용할 수 없습니다. 녹음 후 전사하려면 마이크를 다시 누르세요.";
        return;
      }
      status.textContent = "음성을 인식하지 못했습니다. 마이크 권한을 확인하거나 직접 입력해 주세요.";
    };
    recognition.onend = () => { get("mic").disabled = false; if (status.textContent === "듣는 중…") status.textContent = ""; };
    try { recognition.start(); } catch { status.textContent = "마이크를 시작하지 못했습니다."; }
  };
})();
