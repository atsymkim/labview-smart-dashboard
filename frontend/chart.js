/* ==========================================================================
   trend chart (chart-area) — live-updated from the /ws/dashboard
   WebSocket broadcast feed. Displays reactor / coolant temperature.
   Also owns the header connection indicator and the system status banner,
   since both are driven by the same incoming message stream.
   ========================================================================== */

(function () {
  const canvas = document.getElementById("trendChart");
  if (!canvas) return;

  const WS_URL = getWebSocketUrl("/ws/dashboard");
  const MAX_POINTS = 30;
  const RECONNECT_DELAY_MS = 5000;

  // 채널별 데이터 필드명 → 범례 라벨
  const CHANNELS = [
    { key: "temp_reactor", label: "반응기 온도 (°C)" },
    { key: "temp_coolant", label: "냉각수 온도 (°C)" },
  ];

  // 차트 전용 색상 팔레트
  const CHART_PALETTE = [
    "#3B82F6", // 파랑 - 반응기 온도
    "#10B981", // 초록 - 냉각수 온도
  ];

  const connDot = document.getElementById("conn-dot");
  const connText = document.getElementById("conn-text");
  const statusBanner = document.getElementById("status-banner");

  function setConnectionStatus(isConnected) {
    if (!connDot || !connText) return;
    connDot.classList.toggle("is-connected", isConnected);
    connText.textContent = isConnected ? "연결됨" : "연결 끊김";
  }

  const OVERALL_STATUS_TEXT = {
    normal: "시스템 정상",
    warning: "주의 필요",
    danger: "즉시 확인 필요",
  };

  function updateStatusBanner(overallStatus) {
    if (!statusBanner) return;
    statusBanner.classList.remove("status-banner--normal", "status-banner--warning", "status-banner--danger");

    if (!OVERALL_STATUS_TEXT[overallStatus]) return; // 알 수 없는 값은 무시

    statusBanner.classList.add(`status-banner--${overallStatus}`);
    statusBanner.textContent = OVERALL_STATUS_TEXT[overallStatus];
  }

  // style.css의 색상 변수를 그대로 읽어와서 차트 축/격자에 맞춤
  const rootStyle = getComputedStyle(document.documentElement);
  const gridColor = rootStyle.getPropertyValue("--grid-line").trim() || "#1c2a47";
  const textDimColor = rootStyle.getPropertyValue("--text-dim").trim() || "#64748b";
  const textPrimaryColor = rootStyle.getPropertyValue("--text-primary").trim() || "#e2e8f0";
  const fontMono = rootStyle.getPropertyValue("--font-mono").trim() || "monospace";

  const ctx = canvas.getContext("2d");

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: CHANNELS.map((channel, i) => ({
        label: channel.label,
        key: channel.key,
        data: [],
        borderColor: CHART_PALETTE[i],
        backgroundColor: CHART_PALETTE[i],
        pointBackgroundColor: CHART_PALETTE[i],
        pointBorderColor: CHART_PALETTE[i],
        pointRadius: 2,
        borderWidth: 2,
        tension: 0.3,
        fill: false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 300,
        easing: "easeOutQuad",
      },
      layout: {
        padding: 4,
      },
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "top",
          labels: {
            color: textPrimaryColor,
            font: {
              family: fontMono,
              size: 11,
            },
            boxWidth: 12,
            usePointStyle: true,
          },
        },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: "#0f172acc",
          titleColor: textPrimaryColor,
          bodyColor: textPrimaryColor,
          borderColor: gridColor,
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: {
            color: textDimColor,
            font: {
              family: fontMono,
              size: 10,
            },
          },
          grid: {
            color: gridColor,
          },
        },
        y: {
          ticks: {
            color: textDimColor,
            font: {
              family: fontMono,
              size: 10,
            },
          },
          grid: {
            color: gridColor,
          },
        },
      },
    },
  });

  function addDataPoint(timestampLabel, valuesByChannel) {
    const labels = chart.data.labels;

    labels.push(timestampLabel);
    chart.data.datasets.forEach((dataset) => {
      const value = valuesByChannel[dataset.key];
      dataset.data.push(value !== undefined ? Number(value) : null);
    });

    while (labels.length > MAX_POINTS) {
      labels.shift();
      chart.data.datasets.forEach((dataset) => dataset.data.shift());
    }

    chart.update();
  }

  function handleMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error("JSON 파싱 실패:", raw, e);
      return;
    }

    if (payload.overall_status !== undefined) {
      updateStatusBanner(payload.overall_status);
    }

    const hasAnyChannel = CHANNELS.some((c) => payload[c.key] !== undefined);
    if (!hasAnyChannel) return;

    const label = payload.timestamp !== undefined ? String(payload.timestamp) : "";
    addDataPoint(label, payload);
  }

  function connect() {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnectionStatus(true);
      console.log("WebSocket 연결됨:", WS_URL);
    };

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };

    ws.onclose = () => {
      setConnectionStatus(false);
      console.log(`WebSocket 연결 끊김, ${RECONNECT_DELAY_MS / 1000}초 후 재시도`);
      setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.error("WebSocket 오류:", err);
      ws.close();
    };
  }

  connect();
})();
