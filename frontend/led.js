/* ==========================================================================
   LED indicators (led-area) — coolant_flow / exhaust_valve boolean status,
   live-updated from the /ws/dashboard WebSocket broadcast feed.
   ========================================================================== */

(function () {
  const WS_URL = getWebSocketUrl("/ws/dashboard");
  const RECONNECT_DELAY_MS = 5000;

  const LED_DEFS = [
    { elementId: "led-coolant_flow", key: "coolant_flow" },
    { elementId: "led-exhaust_valve", key: "exhaust_valve" },
  ];

  const ledsByKey = {};
  LED_DEFS.forEach((def) => {
    const el = document.getElementById(def.elementId);
    if (el) {
      ledsByKey[def.key] = el;
    } else {
      console.warn(`[led] #${def.elementId} 엘리먼트 없음`);
    }
  });

  function setLedState(el, isOn) {
    el.classList.toggle("is-on", Boolean(isOn));
  }

  function handleMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error("[led] JSON 파싱 실패:", raw, e);
      return;
    }

    Object.keys(ledsByKey).forEach((key) => {
      if (payload[key] === undefined) return;
      setLedState(ledsByKey[key], payload[key]);
    });
  }

  function connect() {
    const ws = new WebSocket(WS_URL);

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };

    ws.onclose = () => {
      console.log(`[led] WebSocket 연결 끊김, ${RECONNECT_DELAY_MS / 1000}초 후 재시도`);
      setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.error("[led] WebSocket 오류:", err);
      ws.close();
    };
  }

  connect();
})();
