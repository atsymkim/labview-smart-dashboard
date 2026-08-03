/* ==========================================================================
   control buttons (led-area) — send start/stop commands to
   POST /api/control, with safety guards:
     1) '시작' 버튼은 confirm() 확인 후 전송, '정지'는 즉시 전송
     2) LabVIEW(WS) 연결이 끊기면 모든 제어 버튼 비활성화
     3) 5초 내 같은 버튼 5회 이상 클릭 시 경고 후 일시 잠금
   ========================================================================== */

(function () {
  const API_URL = getApiUrl("/api/control");
  const CLICK_DEBOUNCE_MS = 1000;
  const RATE_LIMIT_WINDOW_MS = 5000;
  const RATE_LIMIT_MAX_CLICKS = 5;
  const LOCKOUT_MS = 5000;
  const DISCONNECTED_TEXT = "연결 끊김 - 제어 불가";
  const LOCKED_TEXT = "잠금 중...";
  const PROCESSING_TEXT = "처리 중...";

  const TARGET_LABELS = {
    coolant_flow: "냉각수 흐름",
    exhaust_valve: "배기 밸브",
  };

  const ACTION_LABELS = {
    start: "시작",
    stop: "정지",
  };

  const logList = document.getElementById("log-list");
  const MAX_ENTRIES = 100;

  function nowTimeString() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function addLogEntry(severity, message) {
    if (!logList) return;

    const entry = document.createElement("div");
    entry.className = `log-entry log-entry--${severity}`;

    const icon = document.createElement("span");
    icon.className = "log-entry__icon";
    icon.textContent = severity === "danger" ? "⛔" : severity === "warning" ? "⚠" : "▶";

    const time = document.createElement("span");
    time.className = "log-entry__time";
    time.textContent = nowTimeString();

    const msg = document.createElement("span");
    msg.className = "log-entry__msg";
    msg.textContent = message;

    entry.appendChild(icon);
    entry.appendChild(time);
    entry.appendChild(msg);

    logList.prepend(entry);

    while (logList.children.length > MAX_ENTRIES) {
      logList.removeChild(logList.lastChild);
    }
  }

  // ------------------------------------------------------------------------
  // 버튼 수집 + 상태 렌더링
  // ------------------------------------------------------------------------
  const buttons = Array.from(document.querySelectorAll(".led-btn"));
  const buttonsByTarget = {};
  buttons.forEach((btn) => {
    const t = btn.dataset.target;
    if (!buttonsByTarget[t]) buttonsByTarget[t] = [];
    buttonsByTarget[t].push(btn);

    // 원래 라벨을 한 번만 저장해둔다 (이후 상태 표시 후 복원용)
    btn.dataset.originalText = btn.textContent;
    btn.dataset.processing = "false";
    btn.dataset.locked = "false";
  });

  // 2) 전역 연결 상태 — 헤더의 #conn-dot(대시보드 WebSocket 연결 표시)을 그대로 신뢰 소스로 사용한다.
  let connectionOk = false; // 페이지 로드 직후에는 연결 확인 전이므로 안전하게 잠금 상태로 시작

  function renderButton(btn) {
    if (!connectionOk) {
      btn.disabled = true;
      btn.textContent = DISCONNECTED_TEXT;
      return;
    }
    if (btn.dataset.locked === "true") {
      btn.disabled = true;
      btn.textContent = LOCKED_TEXT;
      return;
    }
    if (btn.dataset.processing === "true") {
      btn.disabled = true;
      btn.textContent = PROCESSING_TEXT;
      return;
    }
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText;
  }

  function renderAllButtons() {
    buttons.forEach(renderButton);
  }

  const connDot = document.getElementById("conn-dot");
  if (connDot) {
    connectionOk = connDot.classList.contains("is-connected");

    const observer = new MutationObserver(() => {
      const nowConnected = connDot.classList.contains("is-connected");
      if (nowConnected !== connectionOk) {
        connectionOk = nowConnected;
        if (!connectionOk) {
          addLogEntry("danger", "LabVIEW 연결 끊김 — 제어 버튼 비활성화");
        } else {
          addLogEntry("info", "연결 복구됨 — 제어 버튼 사용 가능");
        }
        renderAllButtons();
      }
    });
    observer.observe(connDot, { attributes: true, attributeFilter: ["class"] });
  }

  renderAllButtons();

  // ------------------------------------------------------------------------
  // 1) 연속 클릭 방지 (1초 디바운스)
  // ------------------------------------------------------------------------
  const lastClickAt = {};

  function isDebounced(key) {
    const now = Date.now();
    const last = lastClickAt[key] || 0;
    if (now - last < CLICK_DEBOUNCE_MS) return true;
    lastClickAt[key] = now;
    return false;
  }

  // ------------------------------------------------------------------------
  // 3) 5초 내 5회 이상 클릭 방지
  // ------------------------------------------------------------------------
  const clickHistory = {};

  function isRateLimited(key) {
    const now = Date.now();
    const history = (clickHistory[key] || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    history.push(now);
    clickHistory[key] = history;
    return history.length >= RATE_LIMIT_MAX_CLICKS;
  }

  function lockButtonTemporarily(btn, key, label) {
    addLogEntry("warning", `[사용자] ${label} - 너무 빠른 반복 명령입니다 (일시 잠금)`);
    btn.dataset.locked = "true";
    renderButton(btn);
    clickHistory[key] = [];

    setTimeout(() => {
      btn.dataset.locked = "false";
      renderButton(btn);
    }, LOCKOUT_MS);
  }

  // ------------------------------------------------------------------------
  // 명령 전송
  // ------------------------------------------------------------------------
  async function sendCommand(target, action, clickedButton, siblingButtons) {
    const targetLabel = TARGET_LABELS[target] || target;
    const actionLabel = ACTION_LABELS[action] || action;

    siblingButtons.forEach((btn) => {
      btn.dataset.processing = "true";
      renderButton(btn);
    });

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, action }),
      });
      const data = await res.json();

      if (data.status === "sent") {
        addLogEntry("info", `[사용자] ${targetLabel} ${actionLabel} 명령 전송`);
      } else {
        addLogEntry("danger", `[사용자] ${targetLabel} ${actionLabel} 명령 실패: ${data.message || "알 수 없는 오류"}`);
      }
    } catch (err) {
      console.error("[control] 요청 실패:", err);
      addLogEntry("danger", `[사용자] ${targetLabel} ${actionLabel} 명령 전송 실패 (네트워크 오류)`);
    } finally {
      siblingButtons.forEach((btn) => {
        btn.dataset.processing = "false";
        renderButton(btn);
      });
    }
  }

  // ------------------------------------------------------------------------
  // 버튼 클릭 바인딩
  // ------------------------------------------------------------------------
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!connectionOk || btn.dataset.locked === "true" || btn.dataset.processing === "true") {
        return; // 비활성화되어 있어야 정상이지만, 방어적으로 한 번 더 막는다
      }

      const target = btn.dataset.target;
      const action = btn.dataset.action;
      const key = `${target}:${action}`;
      const targetLabel = TARGET_LABELS[target] || target;
      const actionLabel = ACTION_LABELS[action] || action;

      // 3) 반복 클릭 잠금 체크가 가장 먼저
      if (isRateLimited(key)) {
        lockButtonTemporarily(btn, key, `${targetLabel} ${actionLabel}`);
        return;
      }

      // 1) 짧은 디바운스 (실수로 인한 연타 방지)
      if (isDebounced(key)) return;

      // 1) '시작' 계열은 확인 팝업, '정지'는 즉시 실행
      if (action === "start") {
        const confirmed = window.confirm(`${targetLabel}을(를) 시작하시겠습니까?`);
        if (!confirmed) return;
      }

      sendCommand(target, action, btn, buttonsByTarget[target] || [btn]);
    });
  });
})();
