# SH Rad Assistant

## 기능
1. Modality/검사부위별 Normal 템플릿 관리 (생성/조회/버전관리)
2. 한/영 혼합 실시간(문장단위) 음성전사
3. 전체 문법/오타 교정 (Claude API)
4. 소견 기반 영문 결론 자동생성 (Claude API)
5. 임상 체크포인트/감별진단 제시 (Claude API)

## 실행 방법

```bash
cd backend
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

브라우저에서 `http://127.0.0.1:8000` 접속. 마이크 권한을 허용해야 실시간 전사가 동작합니다.

## Claude API 키 설정 (기능 3~5 사용 시 필요)
1. https://console.anthropic.com 에서 API 키 발급
2. `backend/.env` 파일 생성 (`.env.example` 참고):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. 서버 재시작

기본 모델은 `claude-haiku-4-5-20251001` (`backend/app/llm/client.py`의 `MODEL` 상수)이며, 저비용/저지연을 우선한 선택입니다. 품질을 더 높이고 싶다면 `claude-sonnet-5`나 `claude-opus-5`로 바꿀 수 있습니다 (비용은 각각 3배/5배).

## 구조
- `backend/app/` - FastAPI 서버 (템플릿/판독초안 CRUD, 실시간 전사 WebSocket)
- `frontend/` - 순수 HTML/JS (빌드 불필요)
- `backend/data/radiology.db` - SQLite DB (gitignore됨)

## GPU 관련 참고사항
- RTX 5060에서 `faster-whisper`(large-v3-turbo) GPU 추론을 위해 `nvidia-cublas-cu12` pip 패키지로 cuBLAS 라이브러리를 보충했습니다 (`app/stt/model.py` 상단 참고). ctranslate2 pip wheel이 cuDNN은 포함하지만 cuBLAS는 포함하지 않기 때문입니다.
- GPU 추론 검증에 실패하면 자동으로 CPU(int8)로 폴백하지만, CPU에서는 large-v3-turbo 기준 6초 오디오에 30초 이상 걸려 실시간 사용에 부적합합니다. GPU가 정상 동작하는지 서버 시작 로그를 확인하세요.

## requirements.txt 재설치 시
```bash
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```
