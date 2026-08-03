/* ==========================================================================
   공통 설정 — WebSocket / REST API 주소 헬퍼
   ==========================================================================
   chart.js, control.js, eventlog.js, gauge.js, led.js 등 모든 프론트엔드
   스크립트가 공유한다. 지금까지는 "ws://localhost:8000"처럼 주소가 하드코딩
   되어 있어서, ngrok 같은 외부 주소로 페이지를 열면 여전히 localhost로
   연결을 시도해 실패했다.

   대신 현재 페이지가 열린 주소(window.location)를 기준으로 계산하면,
   localhost든 ngrok이든 배포 서버든 백엔드가 프론트엔드와 같은 호스트에서
   서빙되는 한 항상 올바른 주소로 연결된다.

   주의: 이 파일은 반드시 다른 스크립트들(chart.js 등)보다 먼저 로드되어야
   한다 — HTML에서 <script src="config.js"></script>를 나머지 <script> 태그
   위쪽에 둘 것.
   ========================================================================== */
(function (global) {
  /**
   * 현재 페이지 주소를 기준으로 WebSocket 주소를 만든다.
   * https 페이지면 wss://, http 페이지면 ws://를 사용한다.
   * @param {string} path - 예: "/ws/dashboard"
   * @returns {string} 예: "wss://your-app.ngrok.io/ws/dashboard"
   */
  function getWebSocketUrl(path) {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${window.location.host}${path}`;
  }

  /**
   * 현재 페이지 주소를 기준으로 REST API 주소를 만든다.
   * @param {string} path - 예: "/api/control"
   * @returns {string} 예: "https://your-app.ngrok.io/api/control"
   */
  function getApiUrl(path) {
    return `${window.location.protocol}//${window.location.host}${path}`;
  }

  global.getWebSocketUrl = getWebSocketUrl;
  global.getApiUrl = getApiUrl;
})(window);
