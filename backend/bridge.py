import asyncio
import websockets

RENDER_WSS_URL = "wss://labview-smart-dashboard.onrender.com/ws/labview"

async def forward(ws_local, ws_remote):
    async for msg in ws_local:
        print(f"[LabVIEW ➔ Render] 데이터 전달: {msg}")
        await ws_remote.send(msg)

async def reverse(ws_local, ws_remote):
    async for msg in ws_remote:
        print(f"[Render ➔ LabVIEW] 응답 전달: {msg}")
        await ws_local.send(msg)

async def handler(websocket):
    print("✅ LabVIEW 로컬 접속 감지! Render와 보안(WSS) 연결 시도 중...")
    try:
        async with websockets.connect(RENDER_WSS_URL) as ws_remote:
            print("🚀 Render 서버와 보안 연결 성공! 데이터 중계 시작")
            await asyncio.gather(
                forward(websocket, ws_remote),
                reverse(websocket, ws_remote)
            )
    except Exception as e:
        print(f"❌ Render 연결 실패: {e}")

async def main():
    async with websockets.serve(handler, "localhost", 8000):
        print("==================================================")
        print(" WebSocket Bridge 실행 중...")
        print(" LabVIEW 주소 입력: ws://localhost:8000/ws/labview")
        print("==================================================")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())