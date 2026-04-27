# 두발로 대시보드 — Claude Code 작업 지침

이 파일은 Claude Code가 새 세션 시작할 때 **자동으로 읽는** 프로젝트 컨텍스트입니다.
새 PC/새 세션에서 이어서 작업할 때 컨텍스트가 자동 복구되는 핵심 자료.

---

## 프로젝트 개요

- **두발로 주식회사**의 매출/관급 분석 PWA (정적 사이트)
- HTML/CSS/Vanilla JS만 사용. 빌드 도구·번들러 없음.
- 페이지 6개: `index`, `monthly-sales`, `customer-analysis`, `agency-purchase`, `supplier-ranking`, `trend-analysis`, `inventory-management`
- 배포: GitHub `DUBALLO/tpdlfwm` → Cloudflare Pages 자동 빌드 → `dash.duballo.kr`

## 사용자 / 협업 스타일

- **한국어 기본 응답**
- 사용자(`HARRY` / `duaxodbs0@gmail.com`)는 **비기술자** — 내부 동작·명령어 길게 설명 금지, 한 줄로 풀이
- **TEST OS PC에서만 코드 수정**. 다른 PC는 동기화로 받아 설계·리뷰만
- 비파괴적 작업은 진행 후 보고, 파괴적/큰 작업은 진행 전 한 번 확인 받기

## 데이터 소스 (이중 구조)

- **2024~2025년**: Google Sheets publish CSV — `assets/js/sheets-api.js` `csvUrls` 객체
  - 시트 3개: `procurement`, `nonSlip`, `vegetationMat` (헤더 39컬럼 동일)
- **2026년**: 조달청 공공데이터 API `getSpcifyPrdlstPrcureInfoList` — `assets/js/public-data-api.js`
- 두 소스는 `loadAllProcurementData()`에서 concat
- 4개 분석 페이지(agency-purchase, customer-analysis, supplier-ranking, trend-analysis)가 이걸 공유

## ⚠️ 핵심 규칙 1 — 정합성 dedup (이중계상 방지)

조달청 데이터는 계약 변경 시 동일 키 그룹에 여러 행이 쌓임. **그대로 합산하면 이중계상**.

- **그룹 키**: `(계약납품통합번호, 업체사업자등록번호, 계약납품요구물품순번)`
- **채택 규칙**: 그룹별 `계약납품통합변경차수` 최대값 1건. 동점 시 `최종계약납품요구여부 === 'Y'` 우선
- **결손 처리**: 키 3개 중 하나라도 비면 dedup 미적용으로 통과 (자체조달 레거시 보호)
- **구현**: 양 소스에 `pickFinalRevisionPerContract` 메서드 동일 코드 (sheets-api.js, public-data-api.js)

## ⚠️ 핵심 규칙 2 — 공급금액은 누적값

dedup으로 max 1건만 남기는 이상, 그 1건이 **누적 최종값**이어야 정합 (취소 계약 0원 처리).

| 소스 | 누적 컬럼 (✅ 사용) | 증감 컬럼 (❌ 사용 금지) |
|---|---|---|
| 시트 | `공급금액` | `공급증감금액` |
| API | `prdctAmt` | `incdecAmt` |

→ `public-data-api.js`의 `signedAmount`는 `prdctAmt` 우선. `incdecAmt`로 돌아가면 -매출 버그 재발.

## 컬럼 매핑표 (시트 ↔ API)

API row push에서 시트와 동일한 한글 컬럼명으로 통일.

| 표준 | 시트 | API 원본 |
|---|---|---|
| 최종계약여부 | 최종계약납품요구여부 | fnlCntrctDlvrReqChgOrdYn |
| 납품요구번호 | 계약납품통합번호 | cntrctDlvrReqNo |
| 사업자번호 | 업체사업자등록번호 | bizno |
| 변경차수 | 계약납품통합변경차수 | cntrctDlvrReqChgOrd |
| 물품순번 | 계약납품요구물품순번 | prdctSno |
| 수량 | 계약납품수량 | prdctQty |
| 단가 | 계약납품단가 | prdctUprc |
| 공급금액 | 공급금액 | prdctAmt |
| 일자 | 기준일자 | cntrctDlvrReqDate |
| 업체 | 업체 | corpNm |
| 수요기관 | 수요기관명 | dminsttNm |
| 물품식별명 | 물품식별명 | prdctIdntNoNm |
| 계약방법 | 계약방법 | cntrctMthdNm |
| 세부품명 | 세부품명 | dtilPrdctClsfcNoNm |

> ⚠️ 시트의 `계약변경차수`(단가계약 차수)와 `계약납품통합변경차수`(납품요구 차수)는 별개. dedup엔 후자만 사용.

## UI 패턴

### 모달(팝업)
- 헬퍼: `CommonUtils.showModal(title, html, {width: '900px'})`
- 정의: `assets/js/common.js:58`, CSS: `assets/css/common.css:94`
- 모든 페이지에서 동일 패턴 재사용 (월별매출, 수요기관 분석, 관급매출 집계 등)

### 계약 상세 팝업 (수요기관 분석 / 관급매출 집계)
- 트리거: 계약명 클릭 (`a.contract-name-link`)
- 컬럼: 모델 / 규격 / 수량 / 단가 / 합계액
- 데이터 소스: `buildContractSummary` 결과 객체의 `lineItems[]` 배열

### 물품식별명 파싱 (`parseProductIdentName`)
구조: `세부품명, 업체단축명, 모델, 규격...` (parts[0]=세부품명 전수 검증 완료)

| parts 수 | 처리 | 비중 |
|---|---|---|
| ≥ 4 | 모델=parts[2], 규격=parts.slice(3).join(', ') | 99.7% |
| 3 | 모델=parts[2], 규격='-' | 0.2% |
| 2 | 모델='-', 규격=parts[1] | <0.01% |
| ≤ 1 | 모델/규격 모두 '-', raw 통째 표시 (수의계약 통짜 케이스) | 0.3% |

## 캐시 무효화 프로토콜

⚠️ **JS/HTML 수정 후 사용자가 새 코드를 보려면 두 가지 모두 해야 함.**

1. 수정한 JS를 부르는 모든 `<script src="...?v=YYYYMMDDx">` 버전 bump (현재: `v=20260427b`)
2. `service-worker.js`의 `CACHE_NAME` bump (`v3` → `v4`...)

둘 다 안 바꾸면 PWA가 옛 코드를 잡고 안 풀어줍니다 (실제 발생한 사고).

Service Worker 정책:
- `cache: 'no-store'`로 fetch — 브라우저 HTTP 캐시도 우회
- `skipWaiting()` + `clients.claim()` — 새 버전 즉시 활성화

## 배포 워크플로우

```
[TEST OS 로컬 폴더에서 수정]
        ↓
git add -A && git commit -m "..." && git push
        ↓
[GitHub: DUBALLO/tpdlfwm main]
        ↓ 자동
[Cloudflare Pages: duballo] (1~2분 빌드)
        ↓
dash.duballo.kr (실제 사이트)
        ↓
Cloudflare Access 게이트
   허용 이메일: man@duballo.kr, duaxodbs0@gmail.com
```

## 디렉토리 구조 (중요 파일만)

```
02_Dashboard/
├── index.html, manifest.json, service-worker.js
├── pages/
│   ├── monthly-sales.html         ← 판매 데이터 기반
│   ├── customer-analysis.html     ← 관급매출 집계 (조달 데이터)
│   ├── agency-purchase.html       ← 수요기관 분석 (조달 데이터)
│   ├── supplier-ranking.html      ← 업체 판매순위
│   ├── trend-analysis.html        ← 트렌드 분석
│   └── inventory-management.html  ← 재고 현황
├── assets/
│   ├── css/common.css             ← 모달 등 공통 스타일
│   └── js/
│       ├── common.js              ← showModal, formatCurrency 등
│       ├── sheets-api.js          ← 시트 로드 + dedup
│       ├── public-data-api.js     ← 2026 API + dedup
│       ├── customer-analysis.js
│       ├── agency-purchase.js
│       └── (page별 1개씩)
└── docs/
    ├── data-integrity-check.md    ← 정합성 점검 리포트
    └── development-log.md         ← 세션 변경 이력 (사람이 읽음)
```

## 개발 환경

- 로컬 미리보기: `python -m http.server 8000` (정적 서버, 8000 포트)
- 설정: `.claude/launch.json`
- Service Worker는 절대경로(`/manifest.json`, `/service-worker.js`)를 쓰므로 루트에서 서빙 필수
