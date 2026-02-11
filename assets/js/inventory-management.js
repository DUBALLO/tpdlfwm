// assets/js/inventory-management.js

let rawInventoryData = [];

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

    // 3. 버튼 이벤트 연결
    document.getElementById('searchBtn').addEventListener('click', renderInventory);
    document.getElementById('filterProductType').addEventListener('change', renderInventory);
});

function renderInventory() {
    const selectedYear = document.getElementById('filterYear').value;
    const selectedMonth = document.getElementById('filterMonth').value;
    const selectedProductType = document.getElementById('filterProductType').value;

    // 데이터 가공을 위한 맵 (품목별 생산/출고/재고 집계)
    const inventoryMap = new Map();

    // 선택된 제품 타입에 따른 컬럼명 설정
    const prodSpecCol = `${selectedProductType} 생산 규격`;
    const prodQtyCol = `${selectedProductType} 생산량`;
    const outSpecCol = `${selectedProductType} 출고 규격`;
    const outQtyCol = `${selectedProductType} 출고량`;

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

    // 2. UI 렌더링
    const tbody = document.getElementById('inventoryList');
    tbody.innerHTML = "";
    
    let totalP = 0, totalO = 0, totalS = 0;

    // 품목명 기준 정렬하여 출력
    const sortedItems = Array.from(inventoryMap.keys()).sort();
    
    sortedItems.forEach(itemName => {
        const data = inventoryMap.get(itemName);
        const row = tbody.insertRow();
        row.innerHTML = `
            <td class="px-4 py-3 font-medium text-gray-900">${itemName}</td>
            <td class="px-4 py-3 text-right">${CommonUtils.formatNumber(data.prodInPeriod)}</td>
            <td class="px-4 py-3 text-right">${CommonUtils.formatNumber(data.outInPeriod)}</td>
            <td class="px-4 py-3 text-right font-bold text-blue-600 bg-blue-50">${CommonUtils.formatNumber(data.stock)}</td>
        `;
        totalP += data.prodInPeriod;
        totalO += data.outInPeriod;
        totalS += data.stock;
    });

    // 요약 카드 업데이트
    document.getElementById('totalProd').textContent = CommonUtils.formatNumber(totalP) + "m";
    document.getElementById('totalOut').textContent = CommonUtils.formatNumber(totalO) + "m";
    document.getElementById('totalStock').textContent = CommonUtils.formatNumber(totalS) + "m";
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
