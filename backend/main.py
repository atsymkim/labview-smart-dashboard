"""
LabVIEW Smart Dashboard — 통합 백엔드 서버
- WebSocket: /ws/labview, /ws/dashboard
- REST API : /api/sensor, /api/sensor/latest, /api/health, /api/control
"""
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
import uvicorn

from models import SensorData
from websocket_manager import manager
from sensor_routes import router as sensor_router, process_sensor_data
from control_routes import router as control_router

# main.py가 backend/에 있고 frontend/는 그 한 단계 위(프로젝트 루트)에 있는 구조.
# 상대경로("frontend")를 쓰면 uvicorn을 어느 폴더에서 실행하느냐에 따라 매번 못 찾을 수
# 있어서, main.py 파일 위치를 기준으로 한 절대경로로 항상 같은 곳을 가리키게 한다.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

HOST = "0.0.0.0"
PORT = 8000


def print_banner(lines):
    width = max(len(line) for line in lines) + 4
    print("=" * width)
    for line in lines:
        print(f"  {line}")
    print("=" * width)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print_banner([
        "LabVIEW Smart Dashboard Server",
        f"http://{HOST}:{PORT}",
        "WS  /ws/labview   /ws/dashboard",
        "API /api/sensor   /api/sensor/latest   /api/health   /api/control",
    ])
    manager.load_last_state()

    yield

    print_banner(["LabVIEW Smart Dashboard Server 종료됨"])


app = FastAPI(title="LabVIEW Smart Dashboard Server", lifespan=lifespan)

# CORS: 개발 단계 기준 모든 출처 허용
# (allow_origins=["*"] 와 allow_credentials=True는 브라우저에서 동시 사용 불가하므로
#  자격 증명이 필요 없는 개발 환경 특성상 credentials는 꺼둔다)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sensor_router)
app.include_router(control_router)


@app.websocket("/ws/labview")
async def websocket_labview(websocket: WebSocket):
    """LabVIEW 전용 채널 — 받은 데이터를 Dashboard에 브로드캐스트하고,
    연결 자체는 manager가 들고 있어 /api/control이 이 연결로 명령을 내려보낼 수 있다."""
    await manager.connect_labview(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            print(f"[LabVIEW] 수신: {data}")

            # REST(/api/sensor)와 동일하게 판정 -> 알림 -> 브로드캐스트를 태우기 위해
            # 원시 텍스트를 SensorData로 검증한 뒤 공용 파이프라인(process_sensor_data)에 넘긴다.
            # 검증 없이 바로 manager.broadcast(data)로 보내면 evaluate_all/Slack 알림을 건너뛰게 된다.
            try:
                raw = json.loads(data)
                parsed = SensorData(**raw)
            except (json.JSONDecodeError, ValidationError) as e:
                print(f"[LabVIEW] 데이터 파싱/검증 실패, 무시함: {e}")
                continue

            payload = parsed.model_dump(exclude_none=True)
            await process_sensor_data(payload)
    except WebSocketDisconnect:
        manager.disconnect_labview()
    except Exception as e:
        print(f"[LabVIEW] 오류 발생: {e}")
        manager.disconnect_labview()


@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """브라우저 대시보드 전용 수신 채널"""
    await manager.connect_dashboard(websocket)

    try:
        while True:
            # 대시보드 쪽에서 보내는 메시지는 없지만, 연결 유지를 위해 대기
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_dashboard(websocket)
    except Exception as e:
        print(f"[Dashboard] 오류 발생: {e}")
        manager.disconnect_dashboard(websocket)


# 프론트엔드 정적 파일(frontend/index.html, chart.js 등) 서빙.
# /api, /ws 라우트들보다 반드시 뒤에 등록해야 한다 — Starlette는 등록 순서대로 경로를
# 매칭하므로, 이 마운트가 먼저 오면 "/"에 걸리는 이 정적 파일 마운트가 /api나 /ws 요청까지
# 가로챌 수 있다. html=True로 두면 "/" 요청 시 frontend/index.html을 자동으로 서빙한다.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
