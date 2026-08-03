"""
센서 데이터 REST API
- POST /api/sensor        : LabVIEW의 WebSocket 전송이 여의치 않을 때 쓰는 HTTP 대안 경로
- GET  /api/sensor/latest : 가장 최근 수신 데이터 조회
- GET  /api/health        : 서버 상태 확인

이 파일은 수신한 센서 데이터에 대해 채널별 상태 판정(evaluate_status)도 함께 수행한다.
"""
import json
from datetime import datetime
from typing import Union

from fastapi import APIRouter

from models import SensorData
from websocket_manager import manager
from alert_service import send_slack_alert

router = APIRouter(prefix="/api", tags=["sensor"])

# 가장 최근 수신된 센서 데이터 (REST로 조회 가능)
latest_data: dict = {}

# 채널별 임계값: (정상 상한, 경고 상한) — 이 값을 넘으면 danger
# 예: temp_reactor는 75까지 정상, 85까지 경고, 85 초과는 위험
THRESHOLDS: dict[str, tuple[float, float]] = {
    "temp_reactor": (75, 85),
    "temp_coolant": (25, 30),
    "press_reactor": (1.3, 1.6),
    "stir_speed": (400, 450),
}

STATUS_PRIORITY = {"normal": 0, "warning": 1, "danger": 2}

# 채널별 직전 상태 — 이전 상태와 비교해 변화가 있는 채널에만 Slack 알림을 보내기 위한 저장소
previous_status: dict[str, str] = {}


def evaluate_status(key: str, value: Union[float, bool]) -> str:
    """채널 하나의 값을 받아 'normal' / 'warning' / 'danger' 중 하나를 반환한다."""

    # coolant_flow는 숫자 임계값이 아니라 boolean 규칙: False면 다른 값과 무관하게 위험
    if key == "coolant_flow":
        return "danger" if value is False else "normal"

    if key not in THRESHOLDS:
        # 판정 규칙이 없는 채널(exhaust_valve, timestamp 등)은 상태를 매기지 않음
        return "normal"

    normal_max, warning_max = THRESHOLDS[key]
    if value <= normal_max:
        return "normal"
    if value <= warning_max:
        return "warning"
    return "danger"


def evaluate_all(payload: dict) -> dict:
    """payload에 있는 채널들의 상태를 계산해서 '<채널명>_status' 필드로 추가하고,
    전체 시스템 상태(overall_status)도 함께 계산해서 반환한다."""

    result = dict(payload)
    overall = "normal"

    for key, value in payload.items():
        if key not in THRESHOLDS and key != "coolant_flow":
            continue  # 판정 규칙이 없는 채널은 건너뜀 (exhaust_valve, timestamp 등)

        status = evaluate_status(key, value)
        result[f"{key}_status"] = status

        if STATUS_PRIORITY[status] > STATUS_PRIORITY[overall]:
            overall = status

    result["overall_status"] = overall
    return result


def check_status_transitions(payload: dict):
    """evaluate_all()이 채운 '<채널명>_status' 필드들을 보고, 직전 상태와 비교해서
    다음 두 경우에만 Slack 알림을 보낸다:
      - normal -> warning 또는 normal -> danger로 '처음' 진입할 때
      - danger -> normal로 복귀할 때 (복구 알림)
    같은 위험 상태가 계속 유지되거나, warning <-> danger 사이를 오갈 때는
    반복 알림을 보내지 않는다."""

    for status_key, status_value in list(payload.items()):
        if status_key == "overall_status" or not status_key.endswith("_status"):
            continue

        channel = status_key[: -len("_status")]
        previous = previous_status.get(channel)
        previous_status[channel] = status_value

        if previous is None or previous == status_value:
            continue  # 최초 수신값은 기준선으로만 저장, 변화 없으면 알림 없음

        value = payload.get(channel)

        if previous == "normal" and status_value in ("warning", "danger"):
            send_slack_alert(channel, value, status_value)
        elif previous == "danger" and status_value == "normal":
            send_slack_alert(channel, value, "normal", message="정상 복귀")


async def process_sensor_data(payload: dict) -> dict:
    """REST(/api/sensor)와 WebSocket(/ws/labview) 두 수신 경로가 공유하는 단일 처리 파이프라인.

    입력 경로와 무관하게 다음을 동일하게 수행한다:
      1) 채널별 상태 판정 (evaluate_all)
      2) 이전 상태와 비교해 바뀐 채널만 Slack 알림 (check_status_transitions)
      3) 최근 데이터 갱신
      4) 모든 Dashboard 클라이언트에 브로드캐스트

    이 함수 하나로 합쳐둔 이유: 판정/알림 로직이 REST 핸들러 안에만 있으면
    WebSocket으로 들어오는 데이터는 알림 로직을 거치지 않고 그냥 지나가 버린다."""

    if "timestamp" not in payload:
        payload["timestamp"] = datetime.now().isoformat()

    payload = evaluate_all(payload)
    check_status_transitions(payload)

    global latest_data
    latest_data = payload

    # WebSocket으로 온 데이터와 REST로 온 데이터를 동일한 포맷으로 모든 Dashboard 클라이언트에 브로드캐스트
    await manager.broadcast(json.dumps(payload, ensure_ascii=False))

    return payload


@router.post("/sensor")
async def receive_sensor_data(data: SensorData):
    payload = data.model_dump(exclude_none=True)
    payload = await process_sensor_data(payload)

    print(f"[REST 수신] {payload}")

    return {"status": "ok", "received": payload}


@router.get("/sensor/latest")
def get_latest_sensor_data():
    return latest_data


@router.get("/health")
def health_check():
    return {"status": "healthy"}
