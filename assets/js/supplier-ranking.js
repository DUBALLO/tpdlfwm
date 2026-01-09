// supplier-ranking.js

// 전역 변수
let allData = [];
let currentFilteredData = [];
let sortStates = {
    main: { key: 'amount', direction: 'desc', type: 'number' },
    detail: { key: 'amount', direction: 'desc', type: 'number' }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        allData = await loadAndParseData();
        document.getElementById('analyzeBtn').addEventListener('click', analyzeData);
        await analyzeData();
    } catch (error) {
        console.error("초기화 실패:", error);
        CommonUtils.showAlert("페이지 초기화 중 오류가 발생했습니다.", 'error');
    }
});

// ▼▼▼ [수정됨] 데이터 파싱 로직을 안정화하여 오류 방지 ▼▼▼
async function loadAndParseData() {
    if (!window.sheetsAPI) throw new Error('sheets-api.js가 로드되지 않았습니다.');
    
    // 이제 모든 조달 데이터를 한번에 불러옵니다.
    const rawData = await window.sheetsAPI.loadAllProcurementData();
    
    // 어떤 데이터가 들어와도 오류가 나지 않도록 안전하게 처리합니다.
    return rawData.map(item => {
        const amountStr = String(item['공급금액'] || '0').replace(/[^\d]/g, '');
        return {
            agency: (item['수요기관명'] || '').trim(),
            supplier: (item['업체'] || '').trim(),
            region: (item['수요기관지역'] || '').trim().split(' ')[0],
            agencyType: item['소관구분'] || '기타',
            product: (item['세부품명'] || '').trim(),
            amount: amountStr ? parseInt(amountStr, 10) : 0,
            date: item['기준일자'] || '',
            contractName: (item['계약명'] || '').trim()
        };
    }).filter(item => item.supplier && item.agency && item.amount > 0); // 유효한 데이터만 필터링
}


function analyzeData() {
    document.getElementById('supplierDetailPanel').classList.add('hidden');
    document.getElementById('supplierPanel').classList.remove('hidden');

    const year = document.getElementById('analysisYear').value;
    const product = document.getElementById('productFilter').value;

    currentFilteredData = allData.filter(item =>
        (year === 'all' || (item.date && item.date.startsWith(year))) &&
        (product === 'all' || item.product === product)
    );

    updateSummaryStats(currentFilteredData);
    renderSupplierTable(currentFilteredData);
}

function updateSummaryStats(data) {
    const totalSuppliers = new Set(data.map(item => item.supplier)).size;
    const totalContracts = data.length; // 계약 건수는 row 수로 집계
    const totalSales = data.reduce((sum, item) => sum + item.amount, 0);

    document.getElementById('totalSuppliers').textContent = CommonUtils.formatNumber(totalSuppliers) + '개';
    document.getElementById('totalContracts').textContent = CommonUtils.formatNumber(totalContracts) + '건';
    document.getElementById('totalSales').textContent = CommonUtils.formatCurrency(totalSales);
}

function renderSupplierTable(data) {
    const panel = document.getElementById('supplierPanel');
    panel.innerHTML = `
        <div class="p-6 printable-area">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-900">업체별 판매 순위</h3>
                <div class="flex space-x-2 no-print">
                    <button id="printMainBtn" class="btn btn-secondary btn-sm">인쇄</button>
                    <button id="exportMainBtn" class="btn btn-secondary btn-sm">CSV 내보내기</button>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table id="supplierTable" class="min-w-full divide-y divide-gray-200 data-table">
                    <thead class="bg-gray-50"><tr>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="rank" data-sort-type="number"><span>순위</span></th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="supplier" data-sort-type="string"><span>업체명</span></th>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractCount" data-sort-type="number"><span>계약건수</span></th>
                        <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>총 판매액</span></th>
                    </tr></thead>
                    <tbody id="supplierTableBody"></tbody>
                </table>
            </div>
        </div>`;

    const supplierMap = new Map();
    data.forEach(item => {
        if (!supplierMap.has(item.supplier)) {
            supplierMap.set(item.supplier, { amount: 0, contractCount: 0 });
        }
        const info = supplierMap.get(item.supplier);
        info.amount += item.amount;
        info.contractCount++; // 각 row를 계약 1건으로 집계
    });

    let supplierData = [...supplierMap.entries()].map(([supplier, { amount, contractCount }]) => ({
        supplier, amount, contractCount
    }));

    sortData(supplierData, sortStates.main);
    supplierData.forEach((item, index) => item.rank = index + 1);

    const tbody = panel.querySelector('#supplierTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
    if (supplierData.length === 0) return;

    tbody.innerHTML = '';
    supplierData.forEach(item => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td class="px-4 py-3 text-center">${item.rank}</td>
            <td class="px-4 py-3"><a href="#" data-supplier="${item.supplier}" class="text-blue-600 hover:underline">${item.supplier}</a></td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.contractCount)}</td>
            <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
        `;
        row.querySelector('a').addEventListener('click', e => {
            e.preventDefault();
            showSupplierDetail(e.target.dataset.supplier);
        });
    });

    updateSortIndicators('supplierTable', sortStates.main);

    panel.querySelector('#supplierTable thead').addEventListener('click', e => {
        const th = e.target.closest('th');
        if (th && th.dataset.sortKey) {
            handleTableSort('main', th.dataset.sortKey, th.dataset.sortType);
            renderSupplierTable(currentFilteredData);
        }
    });
    
    panel.querySelector('#printMainBtn').addEventListener('click', () => printPanel(panel));
    panel.querySelector('#exportMainBtn').addEventListener('click', () => CommonUtils.exportTableToCSV(panel.querySelector('#supplierTable'), '업체별_판매순위.csv'));
}

function showSupplierDetail(supplierName) {
    const detailPanel = document.getElementById('supplierDetailPanel');
    detailPanel.innerHTML = `
        <div class="p-6 printable-area">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg"><strong class="font-bold">${supplierName}</strong> <span class="font-normal">판매 상세 내역</span></h3>
                <div class="flex items-center space-x-2 no-print">
                    <button id="printDetailBtn" class="btn btn-secondary btn-sm">인쇄</button>
                    <button id="exportDetailBtn" class="btn btn-secondary btn-sm">CSV 내보내기</button>
                    <button id="backToListBtn" class="btn btn-secondary btn-sm">목록으로</button>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table id="supplierDetailTable" class="min-w-full divide-y divide-gray-200 data-table">
                    <thead class="bg-gray-50"><tr>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="agency" data-sort-type="string"><span>수요기관명</span></th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="region" data-sort-type="string"><span>소재지</span></th>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>업체 판매금액</span></th>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="totalAmount" data-sort-type="number"><span>수요기관 전체 구매액</span></th>
                    </tr></thead>
                    <tbody id="supplierDetailTableBody"></tbody>
                </table>
            </div>
        </div>`;

    const supplierSpecificData = currentFilteredData.filter(item => item.supplier === supplierName);
    const agencyTotalMap = new Map();
    currentFilteredData.forEach(item => {
        agencyTotalMap.set(item.agency, (agencyTotalMap.get(item.agency) || 0) + item.amount);
    });

    const agencySalesMap = new Map();
    supplierSpecificData.forEach(item => {
        if (!agencySalesMap.has(item.agency)) {
            agencySalesMap.set(item.agency, { agency: item.agency, region: item.region, amount: 0 });
        }
        agencySalesMap.get(item.agency).amount += item.amount;
    });
    
    let detailData = [...agencySalesMap.values()].map(item => {
        const totalAmount = agencyTotalMap.get(item.agency) || 0;
        return { ...item, totalAmount };
    });

    const renderDetailTable = () => {
        sortData(detailData, sortStates.detail);
        const tbody = detailPanel.querySelector('#supplierDetailTableBody');
        tbody.innerHTML = '';
        detailData.forEach(item => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td class="px-4 py-3">${item.agency}</td>
                <td class="px-4 py-3">${item.region}</td>
                <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
                <td class="px-4 py-3 text-right">${CommonUtils.formatCurrency(item.totalAmount)}</td>
            `;
        });
        updateSortIndicators('supplierDetailTable', sortStates.detail);
    };

    renderDetailTable();

    detailPanel.querySelector('#supplierDetailTable thead').addEventListener('click', e => {
        const th = e.target.closest('th');
        if (th && th.dataset.sortKey) {
            handleTableSort('detail', th.dataset.sortKey, th.dataset.sortType);
            renderDetailTable();
        }
    });

    detailPanel.querySelector('#backToListBtn').addEventListener('click', () => {
        detailPanel.classList.add('hidden');
        document.getElementById('supplierPanel').classList.remove('hidden');
    });

    detailPanel.querySelector('#printDetailBtn').addEventListener('click', () => printPanel(detailPanel));
    detailPanel.querySelector('#exportDetailBtn').addEventListener('click', () => CommonUtils.exportTableToCSV(detailPanel.querySelector('#supplierDetailTable'), `${supplierName}_상세내역.csv`));

    document.getElementById('supplierPanel').classList.add('hidden');
    detailPanel.classList.remove('hidden');
}

function handleTableSort(tableName, sortKey, sortType = 'string') {
    const sortState = sortStates[tableName];
    if (sortState.key === sortKey) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = sortKey;
        sortState.direction = 'desc';
    }
    sortState.type = sortType;
}

function sortData(data, sortState) {
    const { key, direction, type } = sortState;
    data.sort((a, b) => {
        const valA = a[key], valB = b[key];
        let comparison = 0;
        if (type === 'number') comparison = (Number(valA) || 0) - (Number(valB) || 0);
        else comparison = String(valA || '').localeCompare(String(valB || ''), 'ko');
        return direction === 'asc' ? comparison : -comparison;
    });
}

function updateSortIndicators(tableId, sortState) {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.querySelectorAll('thead th[data-sort-key]').forEach(th => {
        const span = th.querySelector('span');
        if (span) {
            span.textContent = span.textContent.replace(/ [▲▼]$/, '');
            if (th.dataset.sortKey === sortState.key) {
                span.textContent += sortState.direction === 'asc' ? ' ▲' : ' ▼';
            }
        }
    });
}

function printPanel(panel) {
    const printable = panel.querySelector('.printable-area');
    if (printable) {
        printable.classList.add('printing-now');
        window.print();
        setTimeout(() => {
            printable.classList.remove('printing-now');
        }, 500);
    } else {
        CommonUtils.showAlert('인쇄할 내용이 없습니다.', 'warning');
    }
}
