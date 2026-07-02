// assets/js/inventory-management.js
console.log('%c[inventory-management.js v=20260702c — 고정핀(입고·개) 지원 + 컴팩트 표 + 즉시갱신 + 음수재고 경고]', 'color:#0ea5e9; font-weight:bold');

let rawInventoryData = [];
let currentInventoryData = []; // 정렬을 위한 현재 표시 데이터
let currentSortColumn = 'name'; // 기본 정렬 컬럼
let currentSortOrder = 'asc'; // 기본 정렬 순서

// 제품별 시트 컬럼·단위·라벨 설정 — 매트=생산·m / 고정핀=입고·개 (시트 컬럼명·단위·용어가 다름)
const PRODUCT_CONFIG = {
    '보행매트': { specIn: '보행매트 생산 규격', qtyIn: '보행매트 생산량', specOut: '보행매트 출고 규격', qtyOut: '보행매트 출고량', dest: '보행매트 출고처', unit: 'm', inLabel: '생산' },
    '식생매트': { specIn: '식생매트 생산 규격', qtyIn: '식생매트 생산량', specOut: '식생매트 출고 규격', qtyOut: '식생매트 출고량', dest: '식생매트 출고처', unit: 'm', inLabel: '생산' },
    '고정핀':   { specIn: '고정핀 입고 규격', qtyIn: '고정핀 입고량', specOut: '고정핀 출고 규격', qtyOut: '고정핀 출고량', dest: '출고처', unit: '개', inLabel: '입고' }
};
function getProductConfig() {
    return PRODUCT_CONFIG[document.getElementById('filterProductType').value] || PRODUCT_CONFIG['보행매트'];
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 오늘 날짜로 드롭다운 초기 세팅
    const today = new Date();
    document.getElementById('filterYear').value = today.getFullYear();
    document.getElementById('filterMonth').value = today.getMonth() + 1;
    document.getElementById('filterProductType').value = '보행매트';

    // 2. 데이터 로드
    try {
        rawInventoryData = await window.sheetsAPI.loadCSVData('inventory');
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
    syncMonthState();
});

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
    const cfg = getProductConfig();

    updatePeriodLabels(selectedYear, selectedMonth, cfg);
    // 제품별 용어(생산/입고) — 컬럼 헤더 + '생산 현황' 버튼 라벨 동적 갱신
    const thProd = document.getElementById('th-prod-label');
    if (thProd) thProd.textContent = `당월 ${cfg.inLabel}`;
    const wkBtn = document.getElementById('weeklyStatusBtn');
    if (wkBtn) wkBtn.textContent = `${cfg.inLabel} 현황`;

    // 데이터 가공을 위한 맵 (품목별 생산·입고/출고/재고 집계)
    const inventoryMap = new Map();

    // 선택된 제품 타입에 따른 컬럼명 (설정표 기반 — 매트=생산, 고정핀=입고)
    const prodSpecCol = cfg.specIn;
    const prodQtyCol = cfg.qtyIn;
    const outSpecCol = cfg.specOut;
    const outQtyCol = cfg.qtyOut;

    // 1. 전체 데이터 스캔하여 누적 재고 및 선택 기간 활동 계산
    rawInventoryData.forEach(row => {
        const dateStr = row['일자'] || ""; // 형식: 2026. 1. 19
        const parts = dateStr.split('.').map(s => parseInt(s.trim()));
        if (parts.length < 3) return;

        const year = parts[0];
        const month = parts[1];
        
        // 데이터 필터링 조건
        const isSelectedYear = (selectedYear === 'all' || year == selectedYear);
        const isSelectedMonth = (selectedMonth === 'all' || month == selectedMonth);
        const isBeforeOrEqualSelection = checkIsBeforeOrEqual(year, month, selectedYear, selectedMonth);

        const prodItem = row[prodSpecCol];
        const prodQty = parseInt(row[prodQtyCol]) || 0;
        const outItem = row[outSpecCol];
        const outQty = parseInt(row[outQtyCol]) || 0;

        // 생산 처리
        if (prodItem) {
            initItem(inventoryMap, prodItem);
            const data = inventoryMap.get(prodItem);
            if (isSelectedYear && isSelectedMonth) data.prodInPeriod += prodQty;
            if (isBeforeOrEqualSelection) data.stock += prodQty;
        }

        // 출고 처리
        if (outItem) {
            initItem(inventoryMap, outItem);
            const data = inventoryMap.get(outItem);
            if (isSelectedYear && isSelectedMonth) data.outInPeriod += outQty;
            if (isBeforeOrEqualSelection) data.stock -= outQty;
        }
    });

    // 2. 데이터를 배열로 변환
    currentInventoryData = Array.from(inventoryMap.entries()).map(([name, data]) => ({
        name,
        prodInPeriod: data.prodInPeriod,
        outInPeriod: data.outInPeriod,
        stock: data.stock
    }));

    // 3. 정렬 적용
    sortInventoryData();
    
    // 4. UI 렌더링
    renderInventoryTable();
}

// P2-3: 카드 라벨을 선택 기간으로 동적 갱신 (기간 기준 명확화 — '선택 시점까지 누적' 의미 반영)
function updatePeriodLabels(selectedYear, selectedMonth, cfg) {
    const inLabel = (cfg && cfg.inLabel) || '생산';
    const period = selectedYear === 'all'
        ? '전체 기간'
        : (selectedMonth === 'all' ? `${selectedYear}년` : `${selectedYear}년 ${parseInt(selectedMonth)}월`);
    const stockText = selectedYear === 'all'
        ? '전체 기말 재고'
        : (selectedMonth === 'all' ? `${selectedYear}년 말 재고` : `${selectedYear}년 ${parseInt(selectedMonth)}월 말 재고`);
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('prodLabel', `${period} ${inLabel}량`);
    set('outLabel', `${period} 출고량`);
    set('stockLabel', stockText);
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

// 재고 데이터 정렬
function sortInventoryData() {
    currentInventoryData.sort((a, b) => {
        let comparison = 0;
        
        switch(currentSortColumn) {
            case 'name':
                comparison = naturalSort(a.name, b.name);
                break;
            case 'prod':
                comparison = a.prodInPeriod - b.prodInPeriod;
                break;
            case 'out':
                comparison = a.outInPeriod - b.outInPeriod;
                break;
            case 'stock':
                comparison = a.stock - b.stock;
                break;
        }
        
        return currentSortOrder === 'asc' ? comparison : -comparison;
    });
}

// 재고 테이블 렌더링
function renderInventoryTable() {
    const tbody = document.getElementById('inventoryList');
    tbody.innerHTML = "";
    
    let totalP = 0, totalO = 0, totalS = 0;
    
    currentInventoryData.forEach(item => {
        const row = tbody.insertRow();
        // P3-3: 음수 재고(이월 미반영·규격키 불일치 가능)는 빨강 경고
        const stockCls = item.stock < 0 ? 'text-red-600 bg-red-50' : 'text-blue-600 bg-blue-50';
        // 컴팩트 표: 생산·출고 0값은 흐리게(zero) 처리
        const zc = v => v === 0 ? ' zero' : '';
        row.innerHTML = `
            <td class="col-name px-4 py-3 font-medium text-gray-900">${item.name}</td>
            <td class="col-num px-4 py-3${zc(item.prodInPeriod)}">${CommonUtils.formatNumber(item.prodInPeriod)}</td>
            <td class="col-num px-4 py-3${zc(item.outInPeriod)}">${CommonUtils.formatNumber(item.outInPeriod)}</td>
            <td class="col-num col-stock px-4 py-3 font-bold ${stockCls}">${CommonUtils.formatNumber(item.stock)}</td>
        `;
        totalP += item.prodInPeriod;
        totalO += item.outInPeriod;
        totalS += item.stock;
    });

    // 요약 카드 업데이트 (단위는 제품별 — 매트=m, 고정핀=개)
    const unit = getProductConfig().unit;
    document.getElementById('totalProd').textContent = CommonUtils.formatNumber(totalP) + unit;
    document.getElementById('totalOut').textContent = CommonUtils.formatNumber(totalO) + unit;
    const stockEl = document.getElementById('totalStock');
    stockEl.textContent = CommonUtils.formatNumber(totalS) + unit;
    // P3-3: 음수 재고 품목이 있으면 총 재고 카드도 빨강으로 경고
    const hasNeg = currentInventoryData.some(it => it.stock < 0);
    stockEl.classList.toggle('text-red-600', hasNeg);
    stockEl.classList.toggle('text-gray-900', !hasNeg);
    
    // 정렬 아이콘 업데이트
    updateSortIcons();
}

// 정렬 아이콘 업데이트
function updateSortIcons() {
    // 모든 정렬 아이콘 초기화
    ['name', 'prod', 'out', 'stock'].forEach(col => {
        const icon = document.getElementById(`sort-${col}`);
        if (icon) {
            icon.className = 'sort-icon';
            icon.classList.remove('asc', 'desc', 'active');
        }
    });
    
    // 현재 정렬 컬럼 아이콘 활성화
    const activeIcon = document.getElementById(`sort-${currentSortColumn}`);
    if (activeIcon) {
        activeIcon.classList.add('active', currentSortOrder);
    }
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

// 품목 데이터 초기화 도우미
function initItem(map, name) {
    if (!map.has(name)) {
        map.set(name, { prodInPeriod: 0, outInPeriod: 0, stock: 0 });
    }
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

// 주간 현황 팝업 표시
let allActivities = []; // 전체 활동 데이터
let currentPage = 0; // 현재 페이지
const itemsPerPage = 5; // 페이지당 표시할 항목 수
let weeklyInLabel = '생산'; // 모달 용어(생산/입고) — 페이지네이션 재렌더 시 유지
let weeklyUnit = 'm';       // 모달 수량 단위(m/개)

function showWeeklyStatus() {
    const selectedProductType = document.getElementById('filterProductType').value;
    const cfg = getProductConfig();
    weeklyInLabel = cfg.inLabel;
    weeklyUnit = cfg.unit;

    // 선택된 제품 타입에 따른 컬럼명 (설정표 기반 — 매트=생산, 고정핀=입고)
    const prodSpecCol = cfg.specIn;
    const prodQtyCol = cfg.qtyIn;
    const outSpecCol = cfg.specOut;
    const outQtyCol = cfg.qtyOut;
    const outDestCol = cfg.dest;
    
    // 최근 데이터 수집 (생산 + 출고 통합)
    allActivities = [];
    
    rawInventoryData.forEach(row => {
        const dateStr = row['일자'] || "";
        const worker = row['작업자'] || "-";
        const timestamp = row['타임스탬프'] || "";
        
        // 생산 데이터
        const prodSpec = row[prodSpecCol];
        const prodQty = parseInt(row[prodQtyCol]) || 0;
        if (prodSpec && prodQty > 0) {
            allActivities.push({
                date: dateStr,
                timestamp: timestamp,
                worker: worker,
                product: selectedProductType,
                type: weeklyInLabel,
                spec: prodSpec,
                qty: prodQty,
                destination: '-'
            });
        }
        
        // 출고 데이터
        const outSpec = row[outSpecCol];
        const outQty = parseInt(row[outQtyCol]) || 0;
        const outDest = row[outDestCol] || '-';
        if (outSpec && outQty > 0) {
            allActivities.push({
                date: dateStr,
                timestamp: timestamp,
                worker: worker,
                product: selectedProductType,
                type: '출고',
                spec: outSpec,
                qty: outQty,
                destination: outDest
            });
        }
    });
    
    // 날짜 기준으로 최신순 정렬 (년.월.일 형식 파싱)
    allActivities.sort((a, b) => {
        const parseDate = (dateStr) => {
            const parts = dateStr.split('.').map(s => s.trim());
            if (parts.length >= 3) {
                const year = parseInt(parts[0]);
                const month = parseInt(parts[1]);
                const day = parseInt(parts[2]);
                return new Date(year, month - 1, day);
            }
            return new Date(0);
        };
        
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        
        // 날짜가 같으면 타임스탬프로 비교
        if (dateA.getTime() === dateB.getTime()) {
            return (b.timestamp || '').localeCompare(a.timestamp || '');
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
                        <th class="px-4 py-3 text-center" style="min-width: 200px;">출고처</th>
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
            const typeClass = item.type === '출고' ? 'text-red-600' : 'text-blue-600';
            tableHTML += `
                <tr>
                    <td class="px-3 py-3 text-center">${item.date}</td>
                    <td class="px-4 py-3 text-center">${item.worker}</td>
                    <td class="px-4 py-3 text-center">${item.product}</td>
                    <td class="px-4 py-3 text-center font-semibold ${typeClass}">${item.type}</td>
                    <td class="px-3 py-3 text-center">${item.spec}</td>
                    <td class="px-4 py-3 text-center font-medium">${CommonUtils.formatNumber(item.qty)}${weeklyUnit}</td>
                    <td class="px-4 py-3 text-center">${item.destination}</td>
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
    CommonUtils.showModal(`${weeklyInLabel} 현황`, tableHTML, { width: '1100px' });
    
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
