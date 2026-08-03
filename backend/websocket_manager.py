"""
Dashboard WebSocket 클라이언트 연결 관리, 브로드캐스트, 최근 상태 저장/복구
"""
import os
from typing import List, Optional
from fastapi import WebSocket

STATE_FILE = "last_state.json"


class ConnectionManager:
    def __init__(self):
        self.dashboard_clients: List[WebSocket] = []
        self.labview_client: Optional[WebSocket] = None
        self.last_state: Optional[str] = None

    # --- 상태 파일 저장/복구 (서버 재시작 대비) -------------------------------

    def load_last_state(self):
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    self.last_state = f.read()
                print(f"[복구] 이전 상태 로드됨: {self.last_state}")
            except Exception as e:
                print(f"[복구] 상태 파일 읽기 실패: {e}")
        else:
            print("[복구] 이전 상태 파일 없음 (최초 실행)")

    def save_last_state(self, data: str):
        self.last_state = data
        try:
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                f.write(data)
        except Exception as e:
            print(f"[저장] 상태 파일 쓰기 실패: {e}")

    # --- Dashboard 클라이언트 연결 관리 ----------------------------------------

    async def connect_dashboard(self, websocket: WebSocket):
        await websocket.accept()
        self.dashboard_clients.append(websocket)
        print(f"[Dashboard] 클라이언트 {len(self.dashboard_clients)}명 접속 중")

        # 새로 접속한 클라이언트에게 마지막 상태를 즉시 전달
        if self.last_state is not None:
            try:
                await websocket.send_text(self.last_state)
            except Exception as e:
                print(f"[Dashboard] 초기 상태 전송 실패: {e}")

    def disconnect_dashboard(self, websocket: WebSocket):
        if websocket in self.dashboard_clients:
            self.dashboard_clients.remove(websocket)
        print(f"[Dashboard] 클라이언트 연결 해제, 현재 {len(self.dashboard_clients)}명 접속 중")

    # --- LabVIEW 연결 관리 -------------------------------------------------------

    async def connect_labview(self, websocket: WebSocket):
        await websocket.accept()
        self.labview_client = websocket
        print("[LabVIEW] 연결됨")

    def disconnect_labview(self):
        self.labview_client = None
        print("[LabVIEW] 연결 해제됨")

    async def send_to_labview(self, message: str) -> bool:
        """제어 명령을 LabVIEW로 전송한다. 연결이 없거나 전송에 실패하면 False를 반환."""
        if self.labview_client is None:
            return False

        try:
            await self.labview_client.send_text(message)
            return True
        except Exception as e:
            print(f"[LabVIEW] 명령 전송 실패: {e}")
            self.labview_client = None
            return False

    # --- 브로드캐스트 ----------------------------------------------------------

    async def broadcast(self, message: str):
        """LabVIEW(WebSocket) 또는 REST(/api/sensor) 어느 경로로 들어온 데이터든
        이 메서드 하나로 모든 Dashboard 클라이언트에 전달하고, 최근 상태로 저장한다."""
        self.save_last_state(message)

        disconnected = []
        for client in self.dashboard_clients:
            try:
                await client.send_text(message)
            except Exception:
                disconnected.append(client)

        for client in disconnected:
            self.disconnect_dashboard(client)


# 앱 전역에서 공유하는 단일 인스턴스
manager = ConnectionManager()
