/* ==========================================================================
   half-doughnut gauges (gauge-area) — reusable createGauge() factory,
   4 process gauges sharing one /ws/dashboard WebSocket connection.
   ========================================================================== */

(function () {
  const WS_URL = getWebSocketUrl("/ws/dashboard");
  const RECONNECT_DELAY_MS = 5000;

  const ZONE_OK = "#10B981";
  const ZONE_WARNING = "#F59E0B";
  const ZONE_DANGER = "#EF4444";
  const TRACK_EMPTY = "rgba(255, 255, 255, 0.08)";

  const rootStyle = getComputedStyle(document.documentElement);
  const textDimColor = rootStyle.getPropertyValue("--text-dim").trim() || "#64748b";
  const fontMono = rootStyle.getPropertyValue("--font-mono").trim() || "monospace";
  const fontSans = rootStyle.getPropertyValue("--font-sans").trim() || "sans-serif";

  /**
   * 재사용 가능한 반원 게이지 생성 함수
   * @param {string} canvasId - <canvas id="..."> 아이디
   * @param {object} config
   *   min, max   : 게이지 표시 범위
   *   thresholds : [경고 시작값, 위험 시작값] — 값이 이 이상으로 올라가면 경고/위험
   *                (예: 냉각수 온도처럼 "낮을수록 정상"인 채널도, 정상 구간의 상한을
   *                 넘어서는 순간부터 위험해지는 건 동일하므로 같은 상한 기준 로직을
   *                 그대로 쓰면 된다 — 별도의 반전 분기 없이 이미 "낮은 값 = 초록"이 성립)
   *   key        : WebSocket JSON에서 읽어올 필드명
   *   label      : 하단에 표시할 라벨 (기본값: key)
   *   unit       : 단위 표시 (기본값: '')
   *   decimals   : 소수점 자리수 (기본값: 1)
   */
  function createGauge(canvasId, config) {
    const {
      min,
      max,
      thresholds,
      key,
      label = key,
      unit = "",
      decimals = 1,
    } = config;

    const [warnAt, dangerAt] = thresholds;

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.warn(`[gauge] canvas #${canvasId} 없음`);
      return null;
    }

    function getZoneColor(value) {
      if (value <= warnAt) return ZONE_OK;
      if (value <= dangerAt) return ZONE_WARNING;
      return ZONE_DANGER;
    }

    let currentValue = null;

    const centerLabelPlugin = {
      id: `centerLabel-${canvasId}`,
      afterDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        const arc = meta.data && meta.data[0];
        if (!arc) return;

        const centerX = arc.x;
        const centerY = arc.y;
        const { ctx } = chart;

        ctx.save();

        const valueText = currentValue === null ? "--" : `${currentValue.toFixed(decimals)}${unit}`;
        ctx.font = `700 16px ${fontMono}`;
        ctx.fillStyle = currentValue === null ? textDimColor : getZoneColor(currentValue);
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(valueText, centerX, centerY - 4);

        ctx.font = `600 9px ${fontSans}`;
        ctx.fillStyle = textDimColor;
        ctx.fillText(label, centerX, centerY + 12);

        ctx.restore();
      },
    };

    // 구간 폭 계산 (min~warnAt / warnAt~dangerAt / dangerAt~max)
    const zoneData = [warnAt - min, dangerAt - warnAt, max - dangerAt];

    const chart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: ["정상", "경고", "위험"],
        datasets: [
          {
            data: zoneData,
            backgroundColor: [ZONE_OK, ZONE_WARNING, ZONE_DANGER],
            borderWidth: 0,
            weight: 2,
          },
          {
            data: [0, max - min],
            backgroundColor: [TRACK_EMPTY, "transparent"],
            borderWidth: 0,
            weight: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        rotation: -90,
        circumference: 180,
        cutout: "62%",
        animation: {
          duration: 300,
          easing: "easeOutQuad",
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [centerLabelPlugin],
    });

    function update(value) {
      const clamped = Math.max(min, Math.min(max, value));
      currentValue = value;

      const zoneColor = getZoneColor(clamped);
      chart.data.datasets[1].data = [clamped - min, max - clamped];
      chart.data.datasets[1].backgroundColor = [zoneColor, TRACK_EMPTY];
      chart.update();
    }

    return { key, update };
  }

  // ------------------------------------------------------------------------
  // 4개 게이지 생성 — 반응기 클러스터
  // ------------------------------------------------------------------------
  const GAUGE_DEFS = [
    { canvasId: "gauge-temp-reactor", key: "temp_reactor", label: "반응기 온도", min: 0, max: 100, thresholds: [75, 85], unit: "°C", decimals: 1 },
    { canvasId: "gauge-temp-coolant", key: "temp_coolant", label: "냉각수 온도", min: 0, max: 40, thresholds: [25, 30], unit: "°C", decimals: 1 },
    { canvasId: "gauge-press-reactor", key: "press_reactor", label: "반응기 압력", min: 0, max: 2, thresholds: [1.3, 1.6], unit: "bar", decimals: 2 },
    { canvasId: "gauge-stir-speed", key: "stir_speed", label: "교반기 속도", min: 0, max: 500, thresholds: [400, 450], unit: "rpm", decimals: 0 },
  ];

  const gauges = GAUGE_DEFS
    .map((def) => createGauge(def.canvasId, def))
    .filter(Boolean);

  const gaugesByKey = {};
  gauges.forEach((gauge) => {
    if (!gaugesByKey[gauge.key]) gaugesByKey[gauge.key] = [];
    gaugesByKey[gauge.key].push(gauge);
  });

  // ------------------------------------------------------------------------
  // 공용 WebSocket 연결
  // ------------------------------------------------------------------------
  function handleMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error("[gauge] JSON 파싱 실패:", raw, e);
      return;
    }

    Object.keys(gaugesByKey).forEach((key) => {
      if (payload[key] === undefined) return;
      const value = Number(payload[key]);
      gaugesByKey[key].forEach((gauge) => gauge.update(value));
    });
  }

  function connect() {
    const ws = new WebSocket(WS_URL);

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };

    ws.onclose = () => {
      console.log(`[gauge] WebSocket 연결 끊김, ${RECONNECT_DELAY_MS / 1000}초 후 재시도`);
      setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.error("[gauge] WebSocket 오류:", err);
      ws.close();
    };
  }

  connect();
})();
