(() => {
  const get = id => document.getElementById(id);
  const form = get("report-form");
  const status = get("report-status");
  const engines = {crewai: "CrewAI · Gemini", gemini: "Gemini", python: "Python 기본 보고서"};
  const engineName = engine => engines[engine] || engine;
  const guest = document.querySelector("[data-guest]")?.dataset.guest === "true";

  async function api(path, options) {
    const response = await fetch("/api/" + path, options);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(typeof result.detail === "string" ? result.detail : "입력값을 확인해 주세요.");
    }
    return result;
  }

  function display(report) {
    const preview = get("report-preview");
    preview.hidden = false;
    preview.textContent = report.markdown;
    const download = get("report-download");
    download.href = "/api/reports/" + report.id + "?download=true";
    download.hidden = false;
  }

  if (form) {
    if (guest) {
      form.hidden = true;
      status.textContent = "카카오 또는 구글 로그인 후 보고서를 저장할 수 있습니다.";
      return;
    }
    const visits = get("report-visits");
    for (let i = 1; i <= 5; i++) {
      const row = document.createElement("fieldset");
      row.className = "report-visit";
      row.innerHTML = `<legend>업무 ${i}</legend>
        <label>업무 이름<input name="title" maxlength="180" required></label>
        <label>방문 주소<input name="address" maxlength="200" placeholder="방문이 없으면 비워 두세요"></label>
        <label>점수<input name="score" type="number" min="1" max="5" step="1" required></label>`;
      visits.append(row);
    }
    let gps = null;
    let gpsToken = null;
    const origin = get("report-origin");
    const gpsButton = get("report-gps");
    function showQuota({remaining, limit}) {
      get("report-gps-quota").textContent =
        `오늘 GPS ${remaining}/${limit}회 남음 · 한국 시간 자정 초기화 · 위치 확인을 시작하면 1회 차감`;
    }
    const refreshQuota = () => api("reports/gps-quota").then(showQuota).catch(() => {});
    refreshQuota();
    function clearGps() {
      gps = null;
      gpsToken = null;
      gpsButton.textContent = "현재 위치 사용";
    }
    origin.addEventListener("input", clearGps);
    gpsButton.addEventListener("click", async () => {
      if (!navigator.geolocation) {
        status.textContent = "이 브라우저에서 위치를 가져올 수 없습니다. 출발지를 입력하세요.";
        return;
      }
      gpsButton.disabled = true;
      origin.disabled = true;
      try {
        const quota = await api("reports/gps-quota", {method: "POST"});
        showQuota(quota);
        clearGps();
        gpsToken = quota.token;
      } catch (error) {
        gpsButton.disabled = false;
        origin.disabled = false;
        status.textContent = error.message;
        refreshQuota();
        return;
      }
      navigator.geolocation.getCurrentPosition(({coords}) => {
        gps = {latitude: coords.latitude, longitude: coords.longitude};
        origin.value = "";
        origin.disabled = false;
        gpsButton.disabled = false;
        gpsButton.textContent = "현재 위치 선택됨";
        status.textContent = "현재 위치를 출발지로 사용합니다.";
      }, () => {
        clearGps();
        origin.disabled = false;
        gpsButton.disabled = false;
        status.textContent = "현재 위치를 읽지 못했습니다. 출발지 주소를 입력하세요.";
      }, {timeout: 8000, maximumAge: 30000});
    });

    get("report-fill").addEventListener("click", async () => {
      try {
        const {today, tasks} = await api("tasks");
        const fields = [...visits.querySelectorAll('[name="title"]')];
        const blanks = fields.filter(input => !input.value.trim());
        const titles = new Set(fields.map(input => input.value.trim()));
        const pending = tasks.filter(task => task.day === today && !task.done && !titles.has(task.title));
        const filled = Math.min(blanks.length, pending.length);
        blanks.slice(0, filled).forEach((input, index) => {
          input.value = pending[index].title.slice(0, 180);
        });
        status.textContent = `오늘 미완료 일정 ${filled}건을 넣었습니다. 업무와 점수를 확인하세요.`;
      } catch (error) {
        status.textContent = error.message;
      }
    });
    document.addEventListener("material-organized", event => {
      const notes = get("report-notes");
      if (event.detail.length <= notes.maxLength) {
        notes.value = event.detail;
      } else {
        status.textContent = "자료를 12,000자 이하로 줄여 보고서에 붙여 넣으세요.";
      }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const rows = [...visits.querySelectorAll("fieldset")];
      const payload = {
        visits: rows.map(row => ({
          title: row.querySelector('[name="title"]').value.trim(),
          address: row.querySelector('[name="address"]').value.trim(),
          score: row.querySelector('[name="score"]').valueAsNumber,
        })),
        origin: origin.value.trim(), gps, gps_token: gpsToken, notes: get("report-notes").value.trim(),
      };
      if (payload.visits.some(visit => !visit.title)) {
        status.textContent = "업무 이름 5건을 입력하세요.";
        return;
      }
      if (gpsButton.disabled) {
        status.textContent = "위치를 확인하고 있습니다. 잠시 기다려 주세요.";
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      gpsButton.disabled = true;
      submit.disabled = true;
      status.textContent = "달성률을 집계하고 업무 순서와 보고서를 작성 중입니다…";
      try {
        const result = await api("reports", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify(payload),
        });
        if (payload.gps) clearGps();
        display(result);
        status.textContent = `보고서를 저장했습니다. ${engineName(result.engine)}`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        gpsButton.disabled = false;
        submit.disabled = false;
      }
    });
    return;
  }

  const gpsHistoryStatus = get("gps-history-status");
  const gpsHistoryList = get("gps-history-list");
  const gpsHistoryMore = get("gps-history-more");
  const koreanTime = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit",
  });
  const formatTime = stamp => koreanTime.format(new Date(stamp));
  let gpsNext = null;
  async function loadGpsHistory() {
    gpsHistoryMore.disabled = true;
    try {
      const result = await api("reports/gps-history" + (gpsNext ? "?before=" + gpsNext : ""));
      for (const entry of result.history) {
        const item = document.createElement("li");
        const time = entry.requested_at ? formatTime(entry.requested_at) : "시각 미기록";
        const used = entry.used ? "보고서 생성에 사용" : "위치 확인 요청";
        item.textContent = `${entry.day} ${time} · 1회 차감 · ${used}`;
        gpsHistoryList.append(item);
      }
      gpsNext = result.next;
      gpsHistoryMore.hidden = !gpsNext;
      gpsHistoryStatus.textContent = gpsHistoryList.children.length ? "" : "GPS 사용 이력이 없습니다.";
    } catch (error) {
      gpsHistoryStatus.textContent = error.message;
    } finally {
      gpsHistoryMore.disabled = false;
    }
  }
  if (guest) {
    gpsHistoryStatus.textContent = "로그인하면 내 GPS 사용 이력을 확인할 수 있습니다.";
  } else {
    gpsHistoryMore.addEventListener("click", loadGpsHistory);
    loadGpsHistory();
    api("reports/gps-quota").then(({remaining, limit}) => {
      get("gps-history-quota").textContent =
        `오늘 ${limit - remaining}회 사용 · ${remaining}/${limit}회 남음 · 한국 시간 기준`;
    }).catch(() => {
      get("gps-history-quota").textContent = "오늘 남은 횟수를 확인하지 못했습니다.";
    });
  }

  const list = get("report-list");
  const more = get("report-more");
  let next = null;
  let selection = 0;
  async function load() {
    more.disabled = true;
    try {
      const result = await api("reports" + (next ? "?before=" + next : ""));
      for (const report of result.reports) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        const time = formatTime(report.created_at);
        const percent = report.percent == null ? "일정 없음" : `달성률 ${report.percent}%`;
        button.textContent = `${report.day} ${time} · ${percent} · ${engineName(report.engine)}`;
        button.addEventListener("click", async () => {
          const selected = ++selection;
          try {
            const detail = await api("reports/" + report.id);
            if (selected === selection) display(detail);
          } catch (error) {
            if (selected === selection) status.textContent = error.message;
          }
        });
        item.append(button);
        list.append(item);
      }
      next = result.next;
      more.hidden = !next;
      status.textContent = list.children.length ? "" : "저장된 보고서가 없습니다.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      more.disabled = false;
    }
  }
  more.addEventListener("click", load);
  load();
})();
