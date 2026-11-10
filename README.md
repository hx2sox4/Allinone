# Aio (가칭)

한국 소상공인을 위한 AI 마케팅팀 앱. 이미지와 영상 생성은 Higgsfield API를 쓴다.
현재 상태: 마일스톤 1(뼈대)과 2(크리에이티브 스튜디오) 완료. 전체 화면 픽셀 사무실에서 팀장에게 한 줄로 일을 맡기는 방식으로 동작한다.

## 실행

필요한 것: Node 22, PostgreSQL, (선택) Redis.

```bash
cp .env.example .env        # 값 채우기
npm install
npm run db:push             # 테이블 생성
npm run mock                # 모의 Higgsfield 서버 (포트 4010). 실제 키가 없을 때 사용
npm run dev                 # http://localhost:3000
```

모의 서버로 돌릴 때는 `.env`에서 `HF_API_BASE=http://127.0.0.1:4010`, `APP_PUBLIC_URL=http://127.0.0.1:3000`로 두고,
`HF_WEBHOOK_SECRET`에는 `whsec_`로 시작하는 임의의 base64 값을 넣는다.
`QUEUE_MODE=bullmq`로 바꾸면 Redis 작업 큐를 쓰며 `npm run worker`를 함께 띄워야 한다.

실제 키로 돌릴 때는 `.env`에서 `HF_API_BASE=https://api.higgsfield.ai`, `HF_API_KEY_ID`, `HF_API_KEY_SECRET`, `LLM_API_KEY`를 채우고 `npm run mock`은 생략한다.
`APP_PUBLIC_URL`을 비우면 웹훅 없이 상태 조회만 쓴다. 생성과 문구 받기는 실제로 과금된다.

## 문구 초안 (글샘)

- 제작실의 브리프 카드에서 "문구 받기"를 누르면 인스타그램 캡션, 이미지 위 문구, 문자 광고 초안을 받는다.
- LLM은 OpenAI 호환 chat/completions 형식이면 되고 기본값은 DeepSeek(`deepseek-flash`)이다. `LLM_API_BASE`, `LLM_API_KEY`, `LLM_MODEL`로 바꾼다.
- 광고 표기, 수신거부 안내, 글자 수, 입력에 없는 숫자와 단정 표현은 코드로 검사해 경고한다. 검사 통과가 법적 적합을 보장하지는 않는다.

## 검사

```bash
npm test          # 단위 테스트와 모의 서버 기반 전체 흐름 테스트 (테스트 전용 DB 스키마 `test` 사용)
npm run typecheck
npm run lint
```

## 마일스톤 1에 들어 있는 것

- 가입, 로그인, 워크스페이스와 역할(OWNER, EDITOR, VIEWER). 가입 때 생성형 AI 이용 고지에 동의를 받는다.
- 브랜드 기억 온보딩(한국어): 업종, 말투(존댓말·반말), 고객, 상품, 금지어, 운영 채널, 브랜드 색상 3가지.
- 모델 레지스트리 `src/lib/higgsfield/models.json`: 문서에서 스키마를 직접 확인한 5개 모델만 들어 있다. 항목을 추가하면 코드 수정 없이 모델이 늘어난다.
- Higgsfield 클라이언트: 견적, 제출(멱등 키, 웹훅 주소), 상태 조회, 취소, 업로드 주소 발급.
- 웹훅 수신: 원문 서명 검증(Standard Webhooks), `webhook-id` 중복 제거, 상태 반영.
- 자산 복사: 완료 즉시 결과 파일을 우리 저장소(로컬 또는 S3 호환)로 복사한다. Higgsfield는 7일 뒤 원본을 지운다.
- 제작실 화면: 예상 비용(원화)을 먼저 보여 주고, 승인해야 제출한다. 실패와 심의 중단은 비용이 없다고 표시한다.

## 사무실이 곧 앱 (`/office`)

- 로그인하면 `/intro`에서 팀을 소개하고, 전체 화면 픽셀 사무실 `/office`가 앱의 본체가 된다.
- 아래 입력창에서 한결(팀장)에게 한 줄로 일을 맡긴다. 한결이 일을 나누면 맡은 직원이 문으로 들어와 자리에 앉아 일하고, 보고서를 한결 책상에 놓고 나간다.
- 말풍선은 서버가 실제로 한 일의 기록(`MissionEvent`)만 재생한다. 지금 일하는 직원은 한결(계획, DeepSeek), 글샘(문구, DeepSeek), 빛나(이미지와 영상, Higgsfield)뿐이다. 나루와 셈은 아직 일을 하지 않으며 사무실에 나오지 않는다.
- 이미지와 영상은 빛나가 견적을 받아 손을 들고, 사장님이 승인해야만 제출된다. 영상은 이미지가 끝난 뒤 따로 승인받는다.
- 한결이 한국어 요청을 영어 이미지 프롬프트로 다듬어 넘긴다.
- 누를 수 있는 것: 직원(맡은 일, 한 일, 보고), 계획판, 프린터(결과물), 책장(지난 일과 다시보기), 서버(연결된 AI), 문(팀 소개), 창문(낮·저녁·밤), 고양이와 소품.
- 다시보기는 저장된 기록을 재생할 뿐이라 비용이 들지 않는다.
- 구조: `src/lib/missions.ts`(임무 진행: 화면이 기록을 물어볼 때마다 한 걸음씩 나아가는 상태 기계), `src/lib/llm/plan.ts`(일 나누기), `src/app/api/missions/*`, `src/components/bureau/*`(화면).

### 가져온 코드와 출처

- 사무실 그림과 움직임은 [Le Bureau des agents](https://github.com/devlikemasta/bureau-des-agents) v0.1.0(커밋 184daa8)의 엔진을 `src/vendor/bureau/`에 가져와 쓴다. Copyright (c) 2026 VibesMoney, MIT License. 라이선스 전문은 `src/vendor/bureau/LICENSE`에 있고, 각 파일 머리에 출처를 적었다. 바꾼 것은 import 경로뿐이다.
- 가져온 것: `src/engine/*`(instance.ts 제외), `shared/protocol.ts`, `shared/activity.ts`, `src/state/bus.ts`. 그림은 모두 코드로 그려지며 이미지 파일은 없다.
- 가져오지 않은 것: 음악(`public/music`), 목소리(`public/voice`), 효과음, 원 프로젝트의 화면(React UI)과 서버. 음악과 목소리는 원 저장소 README에 ElevenLabs와 Google Lyria로 만들었다고만 적혀 있고 재배포 조건을 확인하지 못해 뺐다.
- 그대로 가져온 상태라 사무실 안 간판(RECHERCHE, CODE, LE PLAN 등)과 로봇 모습은 원 프로젝트 그대로다. 글샘은 RÉDACTION 자리, 빛나는 DESIGN 자리에 앉는다.
- 원 프로젝트는 사용자의 Claude Code 구독으로 에이전트를 돌리지만, 이 앱은 서버의 API 키(DeepSeek, Higgsfield)로 동작한다.
- 인트로 화면의 사람 캐릭터(`src/components/pixel.ts`)는 이 프로젝트에서 직접 그린 것이다.

## 마일스톤 2에 들어 있는 것

- 브리프: 무엇을, 어느 채널에, 시안 몇 개인지 적으면 작업으로 풀고 합계 견적을 보여 준다. 승인해야 제출된다.
- 모델 추천: 제품 사진이 있으면 Ads Studio(묶음 생성, 참조 사진), 브랜드 색상 고정이면 Recraft V4.1, 그 외에는 Z-Image Turbo. 직접 고를 수도 있다.
- 채널별 화면비: 모델 스키마가 지원하는 값만 보낸다. 지원하지 않으면 가까운 값으로 바꾸고 화면에 이유를 적는다.
- 제품 사진 업로드: 우리 저장소에 보관하고, 쓸 때마다 Higgsfield 업로드 주소로 올려 참조 주소를 받는다.
- 보관함: 승인, 보류, 내려받기, 버전 기록.
- 한글 문구 얹기: 글자는 모델이 아니라 앱이 Pretendard 글꼴로 직접 그린다. '가상인물' 표시를 함께 넣을 수 있다. 원본은 남고 새 버전으로 저장된다.
- 고른 시안으로 영상 만들기(Kling 2.5 Turbo, Seedance 2.0).

운영 참고: `QUEUE_MODE=inline`에서는 웹훅 요청 안에서 결과 파일을 복사한다. Higgsfield 웹훅은 10초 안에 응답해야 하므로 실제 서비스에서는 `QUEUE_MODE=bullmq`와 `npm run worker`를 써야 한다.

## 아직 없는 것과 확인하지 못한 것

- 자동 테스트는 모두 모의 서버 기준이고 모의 서버의 금액은 임의 값이다. 실제 키로는 2026-11-10에 앱 화면에서 이미지 1건(Z-Image Turbo)과 문구 초안(DeepSeek)을 만들고, 영상은 견적까지만 확인했다.
- 한국어 브리프를 그대로 이미지 프롬프트로 보내면 뜻이 어긋날 수 있다. 실제 시험에서 "따뜻한 생강라떼"가 얼음이 든 차로 나왔다. 프롬프트를 영어로 다듬는 단계가 필요하다.
- 인트로는 직원 다섯 명을 사람 캐릭터로 소개하지만 사무실에서는 원 프로젝트의 로봇으로 나오고, 실제로 일하는 직원은 세 명이다.
- 사무실 임무는 화면이 열려 있을 때만 진행된다(화면의 조회가 진행을 이끈다). 화면을 닫으면 멈췄다가 다시 열면 이어진다.
- 공식 TypeScript SDK(`@higgsfield/client`)는 쓰지 않았다. SDK의 메서드 구성을 문서로 확인하지 못해, 문서로 확인한 HTTP 규격만 쓰는 얇은 클라이언트를 만들었다.
- `USD_KRW_RATE`는 운영자가 정하는 값이며 실시간 환율이 아니다.
- 원화 원장과 한도, 결제 연동, 게시 승인 대기열, 달력, 채널별 내보내기, 규정 검사기, AI 직원 대화는 다음 마일스톤이다.
- Higgsfield에 올린 참조 이미지 주소가 얼마 동안 유효한지 문서에서 확인하지 못했다. 그래서 쓸 때마다 새로 올린다.
- '가상인물' 표시는 인물 위치를 자동으로 찾지 못해 모서리에 넣는다. 인물 가까이에 있는지는 사용자가 확인해야 한다.
- Soul ID 학습, 실제 모델의 한글 표현 품질은 아직 다루지 않았다.
