"""
알림 발송 서비스
- send_slack_alert(): Slack Incoming Webhook으로 상태 변화/복구 알림 발송
- AlertService: 콘솔 로그용 간단 래퍼 (기존 자리, 필요 시 다른 채널 추가 지점)
"""
import os
from datetime import datetime

import requests
from dotenv import load_dotenv

load_dotenv()

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL")

STATUS_EMOJI = {
    "warning": "⚠️",
    "danger": "🚨",
    "normal": "✅",
}


def send_slack_alert(channel: str, value, status: str, message: str = "") -> bool:
    """Slack Webhook으로 알림을 보낸다.

    channel  : 채널명 (예: 'temp_reactor')
    value    : 현재값
    status   : 'warning' / 'danger' / 'normal'(복구 알림용)
    message  : 추가로 덧붙일 메시지 (예: '정상 복귀')

    Slack 서버 오류나 네트워크 예외가 나도 여기서 삼키고 False만 반환한다 —
    알림 실패가 센서 데이터 수신/브로드캐스트 자체를 막으면 안 되기 때문이다.
    """
    if not SLACK_WEBHOOK_URL:
        print("[ALERT] SLACK_WEBHOOK_URL이 설정되지 않아 Slack 알림을 건너뜁니다.")
        return False

    emoji = STATUS_EMOJI.get(status, "ℹ️")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    text = f"{emoji} *{channel}* — 상태: {status.upper()} / 현재값: {value} / 발생시각: {timestamp}"
    if message:
        text += f"\n{message}"

    try:
        resp = requests.post(SLACK_WEBHOOK_URL, json={"text": text}, timeout=5)
        if resp.status_code != 200:
            print(f"[ALERT] Slack 응답 오류: {resp.status_code} {resp.text}")
            return False
        return True
    except Exception as e:
        print(f"[ALERT] Slack 전송 실패: {e}")
        return False


class AlertService:
    def send(self, severity: str, message: str):
        print(f"[ALERT:{severity.upper()}] {message}")


alert_service = AlertService()
