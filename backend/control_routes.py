"""
원격 제어 명령 REST API
- POST /api/control : 브라우저 대시보드에서 받은 제어 명령을 /ws/labview에
                       연결된 LabVIEW로 즉시 전달한다.
"""
import json
from datetime import datetime

from fastapi import APIRouter

from models import ControlCommand
from websocket_manager import manager

router = APIRouter(prefix="/api", tags=["control"])


@router.post("/control")
async def send_control_command(command: ControlCommand):
    timestamp = datetime.now().isoformat()

    # 누가 무엇을 언제 요청했는지 추적 가능하도록 항상 로그로 남김
    print(f"[{timestamp}] [제어 명령] target={command.target} action={command.action}")

    message = json.dumps(
        {"target": command.target, "action": command.action, "timestamp": timestamp},
        ensure_ascii=False,
    )
    sent = await manager.send_to_labview(message)

    if not sent:
        print(f"[{timestamp}] [제어 명령] 전송 실패 — LabVIEW 연결 없음")
        return {"status": "error", "message": "LabVIEW가 연결되어 있지 않습니다"}

    # LabVIEW가 명령을 실제로 처리했는지 확인할 방법이 없으므로,
    # 전송이 성공한 시점(연결에 write가 성공한 시점) 기준으로만 응답한다.
    return {"status": "sent", "target": command.target, "action": command.action}
