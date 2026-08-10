// assets/js/inventory-management.js
console.log('%c[inventory-management.js v=20260810a — 세로형 원장 기준 전환(1행=1건) + 품목마스터에서 품목·단위·용어 로드]', 'color:#4b5563; font-weight:bold');

// ⚠️ 2026-08-10 구조 변경 — 재고 시트가 가로형(품목별 전용 컬럼)에서 세로형 원장으로 바뀌었다.
//    옛 구조는 출고 규격을 하나 더 받을 때마다 컬럼을 늘려야 했고(잔해 컬럼 14개), 헤더에 단위 표기가
//    붙으면 그 열이 통째로 0이 되는 사고가 있었다. 이제 컬럼은 11개로 고정이고 건수는 행으로 늘어난다.
//    → PRODUCT_CONFIG(컬럼명 하드코딩)·resolveSheetColumns(헤더 보정)·uniqueHeaders 우회가 전부 사라졌다.
//    품목·규격·단위·용어(생산/입고)의 단일 진실은 시트의 '품목마스터' 탭이다. 물품 추가 = 마스터에 한 줄.

let ledger = [];        // 원장 정규화 행 — { date, year, month, kind, trade, product, spec, qty, sign, unit, partner, worker, ts, slip }
let products = [];      // 품목 목록(마스터 순서) — [{ name, unit, inLabel }]
let productMeta = {};   // 품목명 → { unit, inLabel }
let inventorySections = [];   // [{ product, cfg, rows, totals }] — 표시 단위(품목별 구간)
let currentSortColumn = 'name'; // 기본 정렬 컬럼
let currentSortOrder = 'asc';   // 기본 정렬 순서

// 재고 시트 — '원장'(1행=1건) + '품목마스터'(품목·규격·단위·용어)
const INV_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQkA2tLZxiYFn8w0T8WF8-ibHFWAILyq44LRkHaTtAP9E55Fvc3U6gAYeL9i_ZJjinUYmP1X3-LGHNm/pub';
const INV_TABS = { ledger: 1144177955, master: 1353758990 };

// 주문관리 시트 — 주문확정 물량(배송 전 주문)의 품명별 수량. 재고 표 '주문 수량' 열의 원천.
const ORDER_DB_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRum7_WBDKTJSA8B1ATxqpd3BtvjXnPLNQXuMpQsx0q4HVmwm_-JRQLCjy-FrYryIBPuxYkhV7F1nWq/pub';
const ORDER_DB_TABS = { deals: 0, dealLines: 745694215, deliveries: 2069628268 };
let orderQtyByProduct = {}; // { 품목: Map(품명 → 수량) }
let orderQtyAny = new Map(); // 품명 → 수량 (품목 불일치 시 폴백)

function getSelectedProduct() {
    return document.getElementById('filterProductType').value || 'all';
}
function getActiveProducts() {
    const sel = getSelectedProduct();
    return sel === 'all' ? products.map(p => p.name) : [sel];
}
function getProductConfig(product) {
    const name = product || getSelectedProduct();
    return productMeta[name] || products[0] || { unit: '', inLabel: '입고' };
}

// 공통 CSV 로더 — 퍼블리시 URL의 탭 하나를 읽어 객체 배열로
async function loadTab(base, gid) {
    const url = `${base}?gid=${gid}&single=true&output=csv&_=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`시트 HTTP ${res.status} (gid ${gid})`);
    return window.sheetsAPI.parseCSV(await res.text());
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 오늘 날짜로 드롭다운 초기 세팅 (품목은 '전체'가 기본)
    const today = new Date();
    document.getElementById('filterYear').value = today.getFullYear();
    document.getElementById('filterMonth').value = today.getMonth() + 1;
    document.getElementById('filterProductType').value = 'all';

    // 2. 데이터 로드 — 원장·품목마스터(필수) + 주문확정 물량(선택, 실패해도 표는 정상)
    try {
        const [rawLedger, rawMaster] = await Promise.all([
            loadTab(INV_BASE, INV_TABS.ledger),
            loadTab(INV_BASE, INV_TABS.master),
            loadOrderQty()
        ]);
        buildProducts(rawMaster, rawLedger);
        buildLedger(rawLedger);
        populateProductFilter();
        renderInventory();
    } catch (error) {
        console.error("데이터 로드 실패:", error);
        CommonUtils.showAlert("재고 데이터를 불러오는 데 실패했습니다.", "error");
    }

    // 3. 버튼·필터 이벤트 연결 (P2-5: 연도·월도 즉시 갱신형으로 통일)
    document.getElementById('searchBtn').addEventListener('click', renderInventory);
    document.getElementById('filterProductType').addEventListener('change', renderInventory);
    document.getElementById('filterYear').addEventListener('change', () => { syncMonthState(); renderInventory(); });
    document.getElementById('filterMonth').addEventListener('change', renderInventory);
    document.getElementById('weeklyStatusBtn').addEventListener('click', showWeeklyStatus);
    document.getElementById('printBtn').addEventListener('click', () => window.print());
    syncMonthState();
});

// ===== 품목마스터 =====
// 품목 순서·단위·용어(생산/입고)의 단일 진실. 마스터에 없는 품목이 원장에 있으면 뒤에 이어 붙인다
// (마스터 등록을 잊어도 재고가 화면에서 사라지지 않게 — 대신 콘솔에 알린다).
function buildProducts(rawMaster, rawLedger) {
    products = [];
    productMeta = {};
    const put = (name, unit, inLabel) => {
        if (!name || productMeta[name]) return;
        const meta = { name, unit: unit || '', inLabel: inLabel || '입고' };
        productMeta[name] = meta;
        products.push(meta);
    };

    (rawMaster || []).forEach(r => {
        if (String(r['사용'] || 'Y').trim().toUpperCase() === 'N') return;
        put(String(r['품목'] || '').trim(), String(r['단위'] || '').trim(), String(r['입고구분'] || '').trim());
    });

    (rawLedger || []).forEach(r => {
        const name = String(r['품목'] || '').trim();
        if (!name || productMeta[name]) return;
        console.warn(`[재고] 품목마스터에 없는 품목이 원장에 있습니다: '${name}' — 마스터에 한 줄 추가해 주세요`);
        put(name, String(r['단위'] || '').trim(), '입고');
    });

    console.log('[재고] 품목', products.map(p => `${p.name}(${p.unit}·${p.inLabel})`).join(' / '));
}

// 품목 드롭다운을 마스터 기준으로 다시 만든다 — 물품이 늘어도 HTML을 안 고치게
function populateProductFilter() {
    const sel = document.getElementById('filterProductType');
    if (!sel || !products.length) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="all">전체</option>' +
        products.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    sel.value = products.some(p => p.name === keep) ? keep : 'all';
}

// ===== 원장 =====
// 구분: 생산·입고·기초재고 = 들어옴(+) / 출고 = 나감(-). 그 외 값은 콘솔에 알리고 들어옴으로 본다.
function buildLedger(rows) {
    ledger = [];
    const unknownKinds = new Set();

    (rows || []).forEach(r => {
        const product = String(r['품목'] || '').trim();
        const spec = String(r['규격'] || '').trim();
        const qty = Number(String(r['수량'] || '').replace(/,/g, ''));
        // 수량 0인 행(기초재고 0 등)도 들고 간다 — 규격은 존재한다는 뜻이고, 재고 0이면 표에서 어차피 빠진다
        if (!product || !spec || !Number.isFinite(qty)) return;

        const dateStr = String(r['일자'] || '').trim();   // 형식: 2026. 1. 19
        const parts = dateStr.split('.').map(s => parseInt(s.trim()));
        if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1])) return;

        const kind = String(r['구분'] || '').trim();
        const isOut = kind === '출고';
        if (!isOut && kind !== '생산' && kind !== '입고' && kind !== '기초재고') unknownKinds.add(kind);

        ledger.push({
            slip: String(r['전표번호'] || '').trim(),
            date: dateStr,
            year: parts[0],
            month: parts[1],
            kind: kind || '입고',
            trade: String(r['거래구분'] || '').trim(),
            product,
            spec,
            qty,
            sign: isOut ? -1 : 1,
            unit: String(r['단위'] || '').trim() || (productMeta[product] || {}).unit || '',
            partner: String(r['거래처'] || '').trim(),
            worker: String(r['작업자'] || '').trim(),
            ts: String(r['타임스탬프'] || '').trim()
        });
    });

    if (unknownKinds.size) console.warn(`[재고] 모르는 구분 값(들어옴으로 계산): ${[...unknownKinds].join(', ')}`);
    console.log(`[재고] 원장 ${ledger.length}건 로드`);
}

// ===== 주문확정 물량 =====
// 주문관리 칸반의 '주문' 단계와 동일 기준: 세금계산서 없음 + 배송 없음 = 아직 나가지 않은 확정 물량.
async function loadOrderQty() {
    try {
        const [deals, dealLines, deliveries] = await Promise.all(
            ['deals', 'dealLines', 'deliveries'].map(k => loadTab(ORDER_DB_BASE, ORDER_DB_TABS[k]))
        );

        // 배송 시트는 아직 '거래번호' 컬럼이 남아 있어 양쪽 키 모두 인정 (주문관리와 동일)
        const shipped = new Set();
        deliveries.forEach(d => {
            const key = String(d.주문번호 || d.거래번호 || '').trim();
            if (key) shipped.add(key);
        });

        const pending = new Set();
        deals.forEach(d => {
            const no = String(d.주문번호 || '').trim();
            if (!no) return;
            if (String(d.세금계산서일자 || '').trim()) return; // 납품 완료
            if (shipped.has(no)) return;                        // 배송 단계로 넘어감
            pending.add(no);
        });

        const byProduct = {};
        const any = new Map();
        dealLines.forEach(l => {
            if (!pending.has(String(l.주문번호 || '').trim())) return;
            const 품목 = String(l.품목 || '').trim();
            const 품명 = String(l.품명 || '').trim();
            const qty = Number(l.수량) || 0;
            if (!품명 || !qty) return;
            if (!byProduct[품목]) byProduct[품목] = new Map();
            byProduct[품목].set(품명, (byProduct[품목].get(품명) || 0) + qty);
            any.set(품명, (any.get(품명) || 0) + qty);
        });

        orderQtyByProduct = byProduct;
        orderQtyAny = any;
        console.log('[재고] 주문확정 물량 로드', { 대상주문: pending.size, 품명수: any.size });
    } catch (e) {
        console.warn('[재고] 주문확정 물량 로드 실패 — 주문 수량 열은 0으로 표시', e);
        orderQtyByProduct = {};
        orderQtyAny = new Map();
    }
}

// 재고 규격(모델코드)에 걸린 주문확정 물량. 품목이 어긋난 입력(고정핀을 매트 품목으로 적은 경우 등)은 품명으로 폴백.
function lookupOrderQty(product, name) {
    if (!name) return 0;
    const m = orderQtyByProduct[product];
    if (m && m.has(name)) return m.get(name);
    return orderQtyAny.get(name) || 0;
}

// P2-3: 연도='전체'면 월 선택이 무의미(여러 해의 같은 달 합산 = 오해) → 월 드롭다운 비활성
function syncMonthState() {
    const yearAll = document.getElementById('filterYear').value === 'all';
    const monthSel = document.getElementById('filterMonth');
    if (!monthSel) return;
    monthSel.disabled = yearAll;
    if (yearAll) monthSel.value = 'all';
}

function renderInventory() {
    const selectedYear = document.getElementById('filterYear').value;
    // P2-3: 연도='전체'면 월 무시 → 세 카드 기준 기간 일치(전체 누적)
    const selectedMonth = selectedYear === 'all' ? 'all' : document.getElementById('filterMonth').value;
    const activeProducts = getActiveProducts();
    const isAll = getSelectedProduct() === 'all';

    // 컬럼 헤더·버튼 라벨 — 제품마다 용어가 다름(생산/입고)
    const thProd = document.getElementById('th-prod-label');
    if (thProd) thProd.textContent = isAll ? '당월 생산·입고' : `당월 ${getProductConfig().inLabel}`;
    const wkBtn = document.getElementById('weeklyStatusBtn');
    if (wkBtn) wkBtn.textContent = isAll ? '생산·입고 현황' : `${getProductConfig().inLabel} 현황`;

    // 품목별 집계 → 표시용 구간(section) 생성
    inventorySections = activeProducts.map(product => {
        const cfg = getProductConfig(product);
        const agg = aggregateProduct(product, selectedYear, selectedMonth);

        // 카드 합계는 전체 규격 기준(활동 총량), 표는 재고 있는 규격만
        const totals = agg.reduce((t, it) => {
            t.prod += it.prodInPeriod;
            t.out += it.outInPeriod;
            t.stock += it.stock;
            return t;
        }, { prod: 0, out: 0, stock: 0 });

        const rows = agg
            .filter(it => it.stock !== 0)   // 재고 없는 규격은 표에서 제외
            .map(it => ({ ...it, orderQty: lookupOrderQty(product, it.name) }));

        return { product, cfg, rows, totals };
    });

    sortInventoryData();
    renderInventoryTable();
    renderStockCards(selectedYear, selectedMonth);
    updatePrintMeta(selectedYear, selectedMonth);
}

// 품목별 소계 — 표에 보이는 줄(재고 있는 규격)의 합
function sectionSubtotal(sec) {
    return sec.rows.reduce((t, r) => {
        t.prod += r.prodInPeriod;
        t.out += r.outInPeriod;
        t.order += r.orderQty;
        t.stock += r.stock;
        return t;
    }, { prod: 0, out: 0, order: 0, stock: 0 });
}

// 한 품목의 규격별 (기간 생산·입고 / 기간 출고 / 선택 시점까지 누적 재고) 집계
function aggregateProduct(product, selectedYear, selectedMonth) {
    const map = new Map();

    ledger.forEach(e => {
        if (e.product !== product) return;

        const inPeriod = (selectedYear === 'all' || e.year == selectedYear)
            && (selectedMonth === 'all' || e.month == selectedMonth);
        const upToNow = checkIsBeforeOrEqual(e.year, e.month, selectedYear, selectedMonth);
        if (!inPeriod && !upToNow) return;

        if (!map.has(e.spec)) map.set(e.spec, { prodInPeriod: 0, outInPeriod: 0, stock: 0 });
        const d = map.get(e.spec);

        if (inPeriod) {
            if (e.sign > 0) d.prodInPeriod += e.qty;
            else d.outInPeriod += e.qty;
        }
        if (upToNow) d.stock += e.sign * e.qty;
    });

    return Array.from(map.entries()).map(([name, d]) => ({
        name,
        prodInPeriod: d.prodInPeriod,
        outInPeriod: d.outInPeriod,
        stock: d.stock
    }));
}

// 자연스러운 규격명 정렬 함수 (DB-800, DB-1000, DB-1200, DBM-1000 순서)
function naturalSort(a, b) {
    const regex = /([A-Za-z]+)-?(\d+)/;
    const aMatch = a.match(regex);
    const bMatch = b.match(regex);

    if (aMatch && bMatch) {
        // 접두사(DB, DBM 등) 비교
        if (aMatch[1] !== bMatch[1]) {
            return aMatch[1].localeCompare(bMatch[1]);
        }
        // 숫자 비교
        return parseInt(aMatch[2]) - parseInt(bMatch[2]);
    }

    // 기본 문자열 비교
    return a.localeCompare(b);
}

// 재고 데이터 정렬 — 품목 구간은 유지하고 구간 안에서 정렬
function sortInventoryData() {
    inventorySections.forEach(sec => {
        sec.rows.sort((a, b) => {
            let comparison = 0;

            switch (currentSortColumn) {
                case 'name':
                    comparison = naturalSort(a.name, b.name);
                    break;
                case 'prod':
                    comparison = a.prodInPeriod - b.prodInPeriod;
                    break;
                case 'out':
                    comparison = a.outInPeriod - b.outInPeriod;
                    break;
                case 'order':
                    comparison = a.orderQty - b.orderQty;
                    break;
                case 'stock':
                    comparison = a.stock - b.stock;
                    break;
            }

            return currentSortOrder === 'asc' ? comparison : -comparison;
        });
    });
}

// 재고 테이블 렌더링 — 품목 구간(소계 줄) + 그 아래 규격별 줄
function renderInventoryTable() {
    const tbody = document.getElementById('inventoryList');
    const num = v => CommonUtils.formatNumber(v);
    const zc = v => v === 0 ? ' zero' : '';
    let html = '';

    inventorySections.forEach(sec => {
        if (sec.rows.length === 0) return; // 재고 있는 규격이 없는 품목은 구간째 생략

        // 품목 구간 머리 = 그 품목의 소계 줄 (당월 생산·입고 / 당월 출고 / 주문 수량 / 재고)
        const sub = sectionSubtotal(sec);
        html += `
            <tr class="grp">
                <td>${sec.product} <span class="grp-unit">(${sec.cfg.unit})</span></td>
                <td class="col-num">${num(sub.prod)}</td>
                <td class="col-num">${num(sub.out)}</td>
                <td class="col-num">${num(sub.order)}</td>
                <td class="col-num col-stock">${num(sub.stock)}</td>
            </tr>`;
        sec.rows.forEach(item => {
            const negCls = item.stock < 0 ? ' neg' : '';
            const negTitle = item.stock < 0 ? ' title="음수 재고 — 이월 미반영이나 규격명 불일치 가능"' : '';
            html += `
                <tr>
                    <td>${item.name}</td>
                    <td class="col-num${zc(item.prodInPeriod)}">${num(item.prodInPeriod)}</td>
                    <td class="col-num${zc(item.outInPeriod)}">${num(item.outInPeriod)}</td>
                    <td class="col-num${zc(item.orderQty)}">${num(item.orderQty)}</td>
                    <td class="col-num col-stock${negCls}"${negTitle}>${num(item.stock)}</td>
                </tr>`;
        });
    });

    if (!html) {
        html = `<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#9ca3af;">재고가 있는 규격이 없습니다.</td></tr>`;
    }
    tbody.innerHTML = html;

    updateSortIcons();
}

// 요약 카드 — 품목별 재고량 한 장씩 (단위가 품목마다 달라 섞어 쓰지 않는다)
function renderStockCards(selectedYear, selectedMonth) {
    const wrap = document.getElementById('stockCards');
    if (!wrap) return;

    const asOf = selectedYear === 'all'
        ? '전체 기말 기준'
        : (selectedMonth === 'all' ? `${selectedYear}년 말 기준` : `${selectedYear}년 ${parseInt(selectedMonth)}월 말 기준`);

    wrap.innerHTML = inventorySections.map(sec => {
        const stock = sec.totals.stock;
        // 음수 재고는 색 대신 점선 밑줄로 경고 (모노톤)
        const negStyle = stock < 0 ? ' style="text-decoration:underline dotted;"' : '';
        return `
            <div class="bg-white rounded-lg shadow-md p-4" style="flex:1 1 180px;">
                <p class="text-sm font-medium text-gray-600">${sec.product} 재고</p>
                <p class="text-xl font-bold text-gray-900"${negStyle}>${CommonUtils.formatNumber(stock)}${sec.cfg.unit}</p>
                <p class="text-xs text-gray-500">${asOf}</p>
            </div>`;
    }).join('');

    const sub = document.getElementById('listSubtitle');
    if (sub) sub.textContent = '재고 있는 규격만 · 주문 수량 = 배송 전 확정 주문';
}

// 인쇄용 머리글 — 무엇을 언제 기준으로 뽑은 표인지 종이에 남긴다
function updatePrintMeta(selectedYear, selectedMonth) {
    const el = document.getElementById('printMeta');
    if (!el) return;
    const sel = getSelectedProduct();
    const period = selectedYear === 'all'
        ? '전체 기간'
        : (selectedMonth === 'all' ? `${selectedYear}년` : `${selectedYear}년 ${parseInt(selectedMonth)}월`);
    const now = new Date();
    const stamp = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}`;
    el.textContent = `제품: ${sel === 'all' ? '전체' : sel} · 기간: ${period} · 출력일 ${stamp}`;
}

// 정렬 아이콘 업데이트
function updateSortIcons() {
    ['name', 'prod', 'out', 'order', 'stock'].forEach(col => {
        const icon = document.getElementById(`sort-${col}`);
        if (icon) icon.textContent = '';
    });

    const activeIcon = document.getElementById(`sort-${currentSortColumn}`);
    if (activeIcon) activeIcon.textContent = currentSortOrder === 'asc' ? '▲' : '▼';
}

// 테이블 정렬 함수 (HTML에서 호출)
function sortTable(column) {
    if (currentSortColumn === column) {
        // 같은 컬럼 클릭 시 정렬 순서 토글
        currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        // 다른 컬럼 클릭 시 해당 컬럼으로 오름차순 정렬
        currentSortColumn = column;
        currentSortOrder = 'asc';
    }

    sortInventoryData();
    renderInventoryTable();
}

// "선택한 기간까지" 누적 데이터를 계산하기 위한 날짜 비교 함수
function checkIsBeforeOrEqual(y, m, selY, selM) {
    if (selY === 'all') return true;
    if (y < selY) return true;
    if (y == selY) {
        if (selM === 'all' || m <= selM) return true;
    }
    return false;
}

// 생산·입고/출고 현황 팝업 — 원장을 그대로 최신순으로 보여준다
let allActivities = []; // 전체 활동 데이터
let currentPage = 0; // 현재 페이지
const itemsPerPage = 5; // 페이지당 표시할 항목 수
let weeklyTitle = '생산 현황'; // 모달 제목 — 페이지네이션 재렌더 시 유지

function showWeeklyStatus() {
    const activeProducts = new Set(getActiveProducts());
    const isAll = getSelectedProduct() === 'all';
    weeklyTitle = isAll ? '생산·입고 현황' : `${getProductConfig().inLabel} 현황`;

    allActivities = ledger.filter(e => activeProducts.has(e.product));

    // 날짜 기준으로 최신순 정렬 (년.월.일 형식 파싱)
    allActivities.sort((a, b) => {
        const parseDate = (dateStr) => {
            const parts = dateStr.split('.').map(s => s.trim());
            if (parts.length >= 3) {
                return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            }
            return new Date(0);
        };

        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);

        // 날짜가 같으면 타임스탬프로 비교
        if (dateA.getTime() === dateB.getTime()) {
            return (b.ts || '').localeCompare(a.ts || '');
        }

        return dateB - dateA; // 최신순 (내림차순)
    });

    // 첫 페이지로 초기화
    currentPage = 0;

    // 팝업 렌더링
    renderWeeklyStatusModal();
}

function renderWeeklyStatusModal() {
    const totalPages = Math.ceil(allActivities.length / itemsPerPage);
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    const currentItems = allActivities.slice(start, end);

    // 테이블 HTML 생성
    let tableHTML = `
        <div style="max-height: 500px; overflow-y: auto;">
            <table class="data-table w-full">
                <thead>
                    <tr>
                        <th class="px-3 py-3 text-center" style="width: 130px;">일자</th>
                        <th class="px-4 py-3 text-center" style="width: 100px;">작업자</th>
                        <th class="px-4 py-3 text-center" style="width: 100px;">제품</th>
                        <th class="px-4 py-3 text-center" style="width: 80px;">구분</th>
                        <th class="px-3 py-3 text-center" style="width: 120px;">규격</th>
                        <th class="px-4 py-3 text-center" style="width: 100px;">수량</th>
                        <th class="px-4 py-3 text-center" style="min-width: 200px;">거래처</th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (currentItems.length === 0) {
        tableHTML += `
            <tr>
                <td colspan="7" class="text-center py-8 text-gray-500">데이터가 없습니다.</td>
            </tr>
        `;
    } else {
        currentItems.forEach(item => {
            tableHTML += `
                <tr>
                    <td class="px-3 py-3 text-center">${item.date}</td>
                    <td class="px-4 py-3 text-center">${item.worker || '-'}</td>
                    <td class="px-4 py-3 text-center">${item.product}</td>
                    <td class="px-4 py-3 text-center font-semibold" style="color: ${item.sign < 0 ? '#dc2626' : '#2563eb'};">${item.kind}</td>
                    <td class="px-3 py-3 text-center">${item.spec}</td>
                    <td class="px-4 py-3 text-center font-medium">${CommonUtils.formatNumber(item.qty)}${item.unit}</td>
                    <td class="px-4 py-3 text-center">${item.partner || '-'}</td>
                </tr>
            `;
        });
    }

    tableHTML += `
                </tbody>
            </table>
        </div>

        <div class="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
            <button
                id="prevPageBtn"
                class="btn btn-secondary px-4 py-2 text-sm ${currentPage === 0 ? 'opacity-50 cursor-not-allowed' : ''}"
                ${currentPage === 0 ? 'disabled' : ''}
            >
                ← 이전
            </button>
            <span class="text-sm text-gray-600">
                ${start + 1}-${Math.min(end, allActivities.length)} / 전체 ${allActivities.length}건
            </span>
            <button
                id="nextPageBtn"
                class="btn btn-secondary px-4 py-2 text-sm ${currentPage >= totalPages - 1 ? 'opacity-50 cursor-not-allowed' : ''}"
                ${currentPage >= totalPages - 1 ? 'disabled' : ''}
            >
                다음 →
            </button>
        </div>
    `;

    // 모달 표시
    CommonUtils.showModal(weeklyTitle, tableHTML, { width: '1100px' });

    // 페이지네이션 버튼 이벤트 연결 (showModal이 DOM을 동기 삽입하므로 즉시 바인딩 — setTimeout 경합 제거)
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 0) { currentPage--; renderWeeklyStatusModal(); }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages - 1) { currentPage++; renderWeeklyStatusModal(); }
        });
    }
}
