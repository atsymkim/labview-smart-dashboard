/* ==========================================================================
   event log (log-area) — auto-generates INFO/WARNING/DANGER entries from
   the /ws/dashboard WebSocket broadcast feed. Reactor process channels.
   ========================================================================== */

(function () {
  const WS_URL = getWebSocketUrl("/ws/dashboard");
  const RECONNECT_DELAY_MS = 5000;
  const MAX_ENTRIES = 100;

  // 채널별 (경고 시작값, 위험 시작값) — backend/sensor_routes.py의 THRESHOLDS와 동일
  const TEMP_CHANNELS = {
    temp_reactor: { warnAt: 75, dangerAt: 85, label: "반응기 온도", unit: "°C" },
    temp_coolant: { warnAt: 25, dangerAt: 30, label: "냉각수 온도", unit: "°C" },
    press_reactor: { warnAt: 1.3, dangerAt: 1.6, label: "반응기 압력", unit: "bar" },
    stir_speed: { warnAt: 400, dangerAt: 450, label: "교반기 속도", unit: "rpm" },
  };

  // coolant_flow는 false 자체가 즉시 위험이라 별도로 처리, exhaust_valve는 일반 상태 변경 로그
  const BOOLEAN_CHANNELS = [
    { key: "exhaust_valve", label: "배기 밸브" },
  ];

  const SEVERITY_ICON = {
    info: "ℹ",
    warning: "⚠",
    danger: "⛔",
  };

  const logList = document.getElementById("log-list");

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
    icon.textContent = SEVERITY_ICON[severity] || SEVERITY_ICON.info;

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

  // 이전 상태 추적용 (최초 수신 시에는 조용히 기준값만 저장, 로그를 남기지 않음)
  const prevBooleanState = {};
  const prevZone = {};
  let prevCoolantFlow;

  function zoneOf(value, warnAt, dangerAt) {
    if (value > dangerAt) return "danger";
    if (value > warnAt) return "warning";
    return "ok";
  }

  function handleCoolantFlow(payload) {
    if (payload.coolant_flow === undefined) return;
    const value = Boolean(payload.coolant_flow);

    if (prevCoolantFlow === undefined) {
      prevCoolantFlow = value;
      return; // 최초 수신값은 기준선으로만 저장
    }

    if (prevCoolantFlow !== value) {
      prevCoolantFlow = value;
      if (value === false) {
        addLogEntry("danger", "냉각수 흐름 중단 감지 — 즉시 확인 필요");
      } else {
        addLogEntry("info", "냉각수 흐름 정상 복귀");
      }
    }
  }

  function handleBooleanChannels(payload) {
    BOOLEAN_CHANNELS.forEach(({ key, label }) => {
      if (payload[key] === undefined) return;
      const value = Boolean(payload[key]);
      const prev = prevBooleanState[key];

      if (prev === undefined) {
        prevBooleanState[key] = value;
        return;
      }

      if (prev !== value) {
        prevBooleanState[key] = value;
        addLogEntry("info", `${label} 상태 변경: ${value ? "ON" : "OFF"}`);
      }
    });
  }

  function handleTemperatureChannels(payload) {
    Object.keys(TEMP_CHANNELS).forEach((key) => {
      if (payload[key] === undefined) return;

      const { warnAt, dangerAt, label, unit } = TEMP_CHANNELS[key];
      const value = Number(payload[key]);
      const zone = zoneOf(value, warnAt, dangerAt);
      const prev = prevZone[key];

      prevZone[key] = zone;

      if (prev === undefined) return; // 최초 수신값은 기준선으로만 저장

      if (zone !== prev) {
        if (zone === "danger") {
          addLogEntry("danger", `${label} 위험 수준 초과: ${value.toFixed(2)}${unit} (>${dangerAt}${unit})`);
        } else if (zone === "warning") {
          addLogEntry("warning", `${label} 경고 수준 초과: ${value.toFixed(2)}${unit} (>${warnAt}${unit})`);
        }
        // ok로 복귀하는 경우는 요구사항에 없어 별도 로그를 남기지 않음
      }
    });
  }

  function handleMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error("[eventlog] JSON 파싱 실패:", raw, e);
      return;
    }

    handleCoolantFlow(payload);
    handleBooleanChannels(payload);
    handleTemperatureChannels(payload);
  }

  function connect() {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      addLogEntry("info", "WebSocket 연결됨");
    };

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };

    ws.onclose = () => {
      addLogEntry("info", "WebSocket 연결 끊김");
      setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.error("[eventlog] WebSocket 오류:", err);
      ws.close();
    };
  }

  connect();
})();
