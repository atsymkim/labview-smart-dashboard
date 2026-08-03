"""
Pydantic 데이터 모델 정의
"""
from typing import Literal, Optional
from pydantic import BaseModel


class SensorData(BaseModel):
    """LabVIEW / REST에서 수신하는 반응기 클러스터 센서 데이터.
    모든 필드는 선택값(Optional)이라 일부 채널만 보내도 됩니다."""

    temp_reactor: Optional[float] = None    # 반응기 온도 (°C)
    temp_coolant: Optional[float] = None    # 냉각수 온도 (°C)
    press_reactor: Optional[float] = None   # 반응기 압력 (bar)
    stir_speed: Optional[float] = None      # 교반기 속도 (rpm)
    coolant_flow: Optional[bool] = None     # 냉각수 흐름 여부
    exhaust_valve: Optional[bool] = None    # 배기 밸브 상태
    timestamp: Optional[str] = None


class ControlCommand(BaseModel):
    """LabVIEW로 내려보낼 원격 제어 명령.
    target/action 모두 허용된 값이 아니면 FastAPI가 자동으로 422를 반환한다."""

    target: Literal["motor_a", "motor_b", "fan", "coolant_flow", "exhaust_valve"]
    action: Literal["start", "stop", "toggle"]
