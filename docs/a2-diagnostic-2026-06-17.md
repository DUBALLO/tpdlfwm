# A2 광범위 진단 리포트 — 2026-06-17

> 멀티에이전트 워크플로우 진단 결과. **이 문서가 A3(개선 실행) 백로그의 단일 진실.**
> run `wf_9d654823-d9d` · 23 에이전트 · 1.45M 토큰 · 9.6분

## 방법 / 집계

- **대상**: 5개 분석 페이지(customer-analysis, agency-purchase, trend-analysis, monthly-sales, inventory-management) 각 HTML+JS + 공유 라이브러리(sheets-api.js, public-data-api.js, common.js) 교차점검
- **방식**: 페이지별 병렬 진단 → 정합성·버그 finding 적대적 검증(타깃당 최대 6) → 종합
- **집계**: 총 **33건** 발견 → 적대적 검증 통과/저위험 통과 **25건**, **오탐 8건 기각**
- **종합 실행항목 13개** (P1×4 / P2×5 / P3×4) + 공통화 권고 6 + 실행순서

## 핵심 (root cause)

4개 조달 페이지가 **같은 파서/집계 로직을 복붙**해 쓰면서 한쪽만 수정돼 페이지마다 매출 숫자가 어긋난다. 단일 진실(공통유틸) 부재가 정합성 사고의 근본 원인. **P1 정합성/치명버그를 먼저 잡고 그 수정분을 `common.js`로 추출**하는 순서가 효율적.

⚠️ **trend-analysis 페이지는 현재 라이브에서 통째로 죽어 있음**(이중버그). ⚠️ **supplier-ranking(A1 산출물)은 매출이 부풀려져 있음**(규칙2 위반).

---

## A3 진행 (2026-06-17)

- ✅ **P1-1 trend-analysis 부활** — 함수명 `loadAndParseAllData`→`loadAndParseProcurementData` + 날짜필드 `contractDate`→`date` 통일(정의 line 43 **+ 진단이 놓친 필터 line 52** 동시 — 필드명만 바꿨으면 필터가 전부 걸러 빈 데이터 됐을 것). 로컬 검증: 480건 로드, 연도필터 2020~2026(이전 [NaN]), 차트 3종 렌더(전체평균 6년 4.72억·2026 1.92억), 콘솔 에러 0. **실제 고장이었고 완전 복구.**
- ✅ **P1-2 supplier-ranking 부호 보존** — `[^\d]`→`[^\d.-]`(3개 조달 페이지와 동일 파서). 로컬 검증: 159개 업체 정상 렌더, 에러 0. **단 실측 결과 현재 데이터 55,598행 중 음수 공급금액 0건 → 실제 매출 부풀림은 없던 잠복 결함.** 방어·일관성 차원으로 수정 유지. (적대검증은 "코드가 부호를 버림"까지만 확인 — 데이터에 음수 실재 여부는 이 실측으로 확정. **진단 P1 심각도는 "잠복(현재 영향 0)"으로 정정.**)
- ✅ **monthly-sales 3건**(독립 파일) — **P1-4 병합키 주문번호**(baseItem·건수키·상세키에 `orderNo` 추가; 동명+동거래처 분할발주가 1건으로 합쳐지던 것 분리). **P2-2 새로고침**(없는 `sheetsAPI.refreshCache()` 호출 제거→`loadSalesData()`만, 성공여부 반환). **P2-4 기본연도**(실측: 이미 `autoSelectYear`로 올해 자동 적용 중 — 진단 "표시 불일치"는 오판, HTML 옛 `selected=2025`만 2026으로 정리). 로컬 검증: salesData 1,234건 전부 orderNo, **분할발주 7건 분리 확인**(예 송원중학교(추가분)/태정=B-24-0423001+B-24-0510001), 기본연도 2026, 새로고침 정상(에러 0·버튼 복귀).
- ✅ **agency-purchase 2건** — **P1-3 5년 윈도우 통일**(순위표 vsAvg와 상세 추이가 서로 다른 5년 기준 쓰던 것 → 공통 `getSelectedBaseYear()`/`getFiveYearWindow()`로 통일). **P2-1 그룹키=납품요구번호**(계약명→`계약납품통합번호`; loadAndParse에 contractNo 추가 + buildContractSummary 키·출력 + 순위표/업체별 거래건수 Set 3곳 일괄). 로컬 검증: contractNo 100% 채워짐(55,598건), 동명 별개 납품요구 **849건 분리**(+983 그룹; 예 광주시/새길조경/팔당호반2차=납품요구 1220100720+1220132790), 2024 선택 시 순위표 vsAvg=상세 vsAvg=▲23.2% **일치**(예전 불일치), 콘솔 에러 0.
- ✅ **inventory 3건** — **P2-5 즉시 갱신**(연도·월에도 change→renderInventory, 제품타입과 통일). **P2-3 전체연도+월 일치**(연도='전체'면 월 드롭다운 비활성+월 무시 → 세 카드 전체누적 일치, 카드 라벨 동적화 'OOOO년 M월 말 재고'). **P3-3**(음수 재고 빨강 경고 + 생산현황 모달 setTimeout(100ms)→동기 바인딩). 로컬 검증: 연도='전체' 시 월 비활성·라벨 '전체 기간/전체 기말 재고' 즉시 반영, 2026·3월 재활성·라벨 즉시, 모달 페이지네이션 1-5→6-10 정상, 에러 0. (현재 음수재고 0건 — 경고 코드는 대기)
- ✅ **customer-analysis 3건** — **P3-1 고정핀 옵션 제거**(세부품명에 없어 항상 0건이던 옵션). **P3-2 인쇄 KPI**(stats-grid의 모순된 정적 `printable-area`+`no-print` 둘 다 제거 → printCurrentView가 메인뷰 인쇄 때만 KPI 토글하도록). **P3-2 지역칼럼**(고객별 표 `regionFull`→`region` 광역으로 타 탭과 단위 통일; 시군은 수요기관명에 포함). 로컬 검증: 품목옵션 4종(고정핀 없음), stats-grid no-print/정적printable 제거, 지역칼럼 광역(경상북도/경기도/인천광역시), 에러 0.
- 캐시: SW v97→v98, `trend-analysis.js`·`supplier-ranking.js`·`monthly-sales.js`·`agency-purchase.js`·`inventory-management.js`·`customer-analysis.js` `?v=20260617a`.
- ✅ **③ 공통추출 완료** — `parseSignedAmount`·`parseProductIdentName`을 common.js로 단일화, 4개 조달페이지가 공유(인라인 중복 제거, trend의 parseInt→Number 통일). 검증: 4개 페이지 CommonUtils 파서 사용·콘솔에러0, **숫자 교차일치**(customer 2026/보행 두발로 = supplier 두발로 2026 = 105,477,500; trend 2026=192,127,500; agency contractNo 100%·계약상세팝업 모델/규격 파싱 정상). ※ 검증 중 라이브 데이터가 +320,000 드리프트했으나 4개 페이지가 동일 반영 → 추출 숫자 중립 확인.
  - **보류(저효용·고위험이라 의도적 제외)**: buildContractSummary 일반화 / sortData·updateSortIndicators·showContractItemsPopup 통합 / parseCSV 통합 / agency 죽은필드(contractOrder·firstContractDate·lineCount·parseContractOrder, 이미 dead). 각 페이지 내부는 일관하므로 현재 버그 없음 — 향후 별도 정리 가능.
- 🎯 **A3 전체 완료** (P1 4/4 · P2 5/5 · P3 · 공통추출). 6개 JS + 5개 HTML 수정, **SW v97→v98**, 변경 JS `?v=20260617a`(common.js는 SW로 캐시무효화). **미배포 — 형우 결정으로 모아서 배포 대기.** 배포 후 라이브 확인 필요(Access 게이트로 AI 불가): trend-analysis 차트 부활 / 4개 조달페이지 매출 교차일치 / 일부 건수 증가(정상).

---

## P1 — 정합성 / 치명버그 (4건, 전부 적대검증 통과)

### P1-1. trend-analysis 페이지 전체 사망 — 진입점 함수명 + 날짜 필드명 이중 불일치 〔버그 / S〕
- **파일**: `assets/js/trend-analysis.js`
- **문제**: 초기화가 `loadAndParseAllData()`를 호출하나 정의된 건 `loadAndParseProcurementData()`뿐 → ReferenceError → '데이터 로딩 오류' 알럿만 뜨고 전 차트/표 공백. 함수명을 고쳐도, 파서는 기준일자를 `contractDate`(line ~43)로 저장하는데 모든 소비부는 `item.date`를 읽어 `new Date(undefined)`=Invalid Date → `getFullYear/getMonth` NaN → 연도필터 `[NaN]`·월별 집계 no-op로 모든 그래프 0. **두 버그가 겹쳐 두 단계로 죽음.**
- **수정**: (1) line ~10 호출을 `loadAndParseProcurementData()`로 교체. (2) 파서 매핑을 `date: (item['기준일자']||'').trim()`으로 변경(agency-purchase와 동일 규약 `date`로 통일). `contractDate` 소비부가 없어 매핑 키만 바꾸면 전 소비부 정상화.

### P1-2. supplier-ranking 공급금액 파싱이 부호를 버려 취소·감액 계약 매출이 양수로 둔갑 (규칙2 위반) 〔정합성 / S〕
- **파일**: `assets/js/supplier-ranking.js` (loadAndParseData, line ~77)
- **문제**: `String(item['공급금액']).replace(/[^\d]/g,'')`로 숫자만 추출 → 마이너스 부호 제거. 다른 3개 조달 페이지는 `parseSignedAmount`(`/[^\d.-]/`)로 부호 보존. 음수 공급금액(취소·감액)이 절대값 양수로 변해 매출에 +합산, `amount>0` 필터도 통과 → **'업체별 판매순위'의 두발로·경쟁업체 매출이 다른 페이지보다 부풀려짐.** 4개 공유 페이지 숫자 불일치의 직접 원인.
- **수정**: 부호보존 파서로 교체(`/[^\d.-]/g` 후 `Number()`). 공통화 시 `CommonUtils.parseSignedAmount` 사용. `amount>0` 필터도 다른 페이지(`rawAmount!==''`) 기준으로 재검토.

### P1-3. agency-purchase '평균 대비' 5년 윈도우가 순위표 vs 상세에서 달라 같은 기관이 다른 값 〔정합성 / M〕
- **파일**: `assets/js/agency-purchase.js` (renderAgencyRankPanel line ~347 vs renderTrendDetail line ~749)
- **문제**: 순위표는 **선택연도** 기준 5년(selectedYear-0..4), 상세는 **시스템연도** 기준 고정 5년(currentSystemYear-0..4). 2024 선택 시 순위표=2020~2024 평균, 상세=2022~2026 평균 → 동일 기관 '평균 대비'가 두 화면에서 다른 숫자. 또 분석기간='전체(all)'일 때 selectedYear를 현재연도(2026)로 강제해 '총 구매액'(전기간)과 '평균 대비'(2026 단년) 기준이 어긋남.
- **수정**: `getFiveYearWindow(baseYear)` 공통 헬퍼로 추출, 두 함수가 같은 baseYear(권장: 선택연도) 사용. `all`이면 vsAvg='-' 또는 헤더에 '최근연도 기준' 명시.

### P1-4. monthly-sales 건수/상세 병합키에 주문번호 누락 — 동명 사업 분할발주가 1건으로 합쳐짐 〔정합성 / M〕
- **파일**: `assets/js/monthly-sales.js` (baseItem line ~87, aggregate line ~133/139, processDetailData line ~253)
- **문제**: 집계/병합 키가 `${사업명}-${거래처}`인데 baseItem에 `주문번호`가 없음. 같은 학교에 같은 사업명으로 분할발주된 별개 주문 2건이 (1)월별 건수 Set에서 1건으로 카운트, (2)상세 팝업에서 totalAmount 합산돼 한 줄로 뭉침. **건수 과소집계 + 상세 금액 오귀속.** 관급에서 동일 사업명 반복발주는 흔함.
- **수정**: baseItem에 `orderNo: deal['주문번호']` 추가, 키를 `${orderNo}` 또는 `${orderNo}-${사업명}`로 변경(품목은 orderNo 내 items[]로 묶음). 조달 dedup과 동일 철학(통합번호/주문번호 단위 식별).

---

## P2 — 일반버그 / 중요 UX (5건)

### P2-1. agency-purchase 계약 그룹키가 계약명 문자열 — 동명 별개 납품요구가 1행 병합 〔버그 / M / 검증완료〕
- `assets/js/agency-purchase.js` buildContractSummary(line ~171). 그룹키가 계약납품통합번호가 아닌 **계약명**이라 '보행매트 구매'류 흔한 명칭이면 별개 납품요구가 한 행으로 합쳐져 거래건수 과소·lineItems 뒤섞임(총 매출은 보존). → 매핑에 `contractNo: item['계약납품통합번호']` 추가, 그룹키를 통합번호 우선(결손 시 계약명 fallback). **P1-4와 같은 패턴 → 묶어 처리.**

### P2-2. monthly-sales 새로고침이 없는 sheetsAPI.refreshCache() 호출 → 항상 실패 〔버그 / S / 검증완료〕
- `assets/js/monthly-sales.js` refreshData(line ~390). `refreshCache` 메서드 부재 → TypeError → 매번 '새로고침 실패' 토스트. Phase 7 이후 이 페이지는 sheetsAPI 미사용(fetchOrderDb로 직접 fetch, 이미 no-store). → refreshCache 호출 줄 삭제, `await loadSalesData()`만 남김.

### P2-3. inventory '전체'연도+특정월 선택 시 카드 3개의 기준 기간이 제각각 〔버그 / M / 검증완료〕
- `assets/js/inventory-management.js` (필터 line ~54-76, checkIsBeforeOrEqual line ~208). 연도='전체'+월='5'면 생산/출고 카드는 24·25·26년 5월 전부 합산, 재고 카드는 월 무시(전체 누적). → 연도='전체'면 월 드롭다운 disable, 재고 카드 라벨 'OOOO년 OO월 말 재고'로 명확화.

### P2-4. monthly-sales 기본 조회기간이 HTML(2025) 의도와 달리 2026으로 강제됨 〔UX / S〕
- `assets/js/monthly-sales.js` + `common.js` initAutoYearSelection(line ~149) + `pages/monthly-sales.html`. HTML은 startYear/endYear=2025 selected인데 자동연도선택이 2026으로 덮어씀 → 첫 진입이 2026 전체라 '데이터 없음'처럼 보임. → 기본기간 정책 확정(2025 유지 시 startYear/endYear를 autoSelect 대상에서 제외). 다른 페이지(analysisYear) 영향 없게 범위 한정.

### P2-5. inventory 조작 모델 혼재 — 제품타입만 즉시 갱신, 연도/월은 버튼 필요 〔UX / S〕
- `assets/js/inventory-management.js` (바인딩 line ~25). filterProductType만 change 즉시 렌더, 연도/월은 '조회하기' 필요 → 사용자가 '바뀐 줄 안 바뀐' 수치 오독. → 셋 다 즉시갱신형 또는 버튼형으로 통일.

---

## P3 — 사소 UX / 리팩터 (4건)

### P3-1. customer-analysis 품목필터 '고정핀' 옵션은 항상 빈 결과 〔UX / S〕
- `pages/customer-analysis.html` (option line ~88). 세부품명 정확일치 비교인데 데이터에 '고정핀' 세부품명 없음(2026 API는 보행/식생/논슬립 3코드만). → 옵션 제거 또는 부분일치/매핑.

### P3-2. customer-analysis 인쇄 시 상단 KPI 요약카드 미출력 + '지역' 칼럼 단위 불일치 〔UX / S〕
- `pages/customer-analysis.html` + `assets/js/customer-analysis.js`. (1) 카드 컨테이너에 `printable-area no-print` 동시 부착 → `@media print`에서 `display:none`이 이김 → 인쇄물에 핵심 카드 누락. (2) 고객별 표는 풀주소(regionFull), 지역별/소관 탭은 단축 region → 같은 헤더 단위 불일치. → no-print/printable 모순 제거 + region 단위 통일.

### P3-3. inventory 음수 재고 무경고 노출 + 생산현황 모달 setTimeout(100ms) 바인딩 〔UX / S〕
- `assets/js/inventory-management.js`. (1) stock=생산-출고 하한 없어 음수 재고가 파란 강조로 노출(이월 미반영·규격키 미세불일치) → stock<0 빨강 경고 + 규격키 분리 점검. (2) 모달 prev/next를 setTimeout 100ms로 바인딩 → 경합 위험 → 동기 바인딩 또는 이벤트 위임.

### P3-4. agency-purchase 미사용 죽은 필드 정리 (contractOrder/firstContractDate/lineCount, parseContractOrder) 〔기타 / M〕
- `assets/js/agency-purchase.js` buildContractSummary(line ~194). 산출만 되고 렌더 어디서도 미사용. parseContractOrder도 상위 dedup 후라 실효 없음. → 제거 또는 상세에 노출. (정렬마다 vsAvg 전수 재계산 성능 이슈도 같은 함수 — 캐시/렌더분리 시 함께 검토.)

---

## 공통화 권고 (common.js 추출 — A3에 P1·P2 수정분 흡수)

1. **parseSignedAmount** (부호보존 파서) — customer:31 / agency:99 / trend:28에 복붙, supplier-ranking은 `[^\d]` 버그 변형. **P1-2의 근본 원인.** P1-2 수정과 동시에 단일 추출 → 4개 페이지 교체.
2. **normalizeProcurementRow** (시트/API row→표준객체: 수요기관명/지역/소관/공급금액/기준일자→`date`/세부품명/업체) — 4개 페이지 거의 동일 복붙, **P1-1(date vs contractDate)의 유입 경로.** 단일화하면 필드명 규약 강제→재발 방지.
3. **buildContractSummary** — customer:82 / agency:167 키 구성만 다름. keyFields 인자 받는 단일 함수로 일반화(**P1-4·P2-1 그룹키 수정 반영**).
4. **parseProductIdentName** — agency:677 / customer:527 바이트 동일, order-management:1515 한글키 변형. common.js 추출 + order-management는 어댑터.
5. **테이블 유틸** sortData/handleTableSort/updateSortIndicators + 계약상세팝업 — customer↔agency 거의 동일.
6. **parseCSV** — sheets-api:215 외 monthly-sales:34·supplier-ranking:22에 3벌(미세차). 우선순위 낮음(매출 직접영향 작음).

## 권장 실행 순서

1. **trend-analysis 이중버그** 수정 (페이지 통째 사망, S) — 영향 최대
2. **supplier-ranking 부호보존 파서** 교체 (매출 부풀림 제거, S)
3. **parseSignedAmount + normalizeProcurementRow를 common.js 추출** → 4개 조달 페이지 교체 (1·2를 단일 진실로 고정, 재발 차단)
4. **buildContractSummary 그룹키=납품요구번호(agency) + monthly-sales 병합키 주문번호 추가** (P1-4·P2-1 같은 패턴, 묶어서 + 추출된 공통 함수에 반영)
5. agency-purchase 5년 윈도우 통일(getFiveYearWindow) + 'all' vsAvg 처리
6. monthly-sales refreshCache 제거 + 기본연도(2025) 정책 확정
7. inventory 전체연도+월 기준 일치 + 조작모델 통일
8. P3 잔여(고정핀·인쇄 KPI/지역·음수재고·죽은필드·CSV통합)는 별도 정리 배치

> ⚠️ 각 JS 수정 후 **캐시 무효화 프로토콜**(HANDOVER §5): script `?v=` bump + service-worker `CACHE_NAME` bump 동시. 공통화(3)는 4개 페이지 동시 영향 → 배포 전 로컬(`python -m http.server 8000`)에서 4개 페이지 숫자 일치 확인 필수.

## 오탐 기각 (8건)

적대적 검증에서 코드 확인 결과 실제 문제 아님으로 기각된 8건은 채택하지 않음(예: 실제로는 상위에서 dedup이 적용되거나 영향 없는 케이스). 검증이 환각 버그를 걸러낸 것.
