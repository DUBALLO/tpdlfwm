// customer-analysis.js

// 전역 변수
let allGovernmentData = [];        // 원본 라인 데이터
let currentFilteredRawData = [];   // 현재 필터 적용된 원본 라인 데이터
let currentFilteredData = [];      // 현재 필터 적용 + 계약 기준 집계 데이터
let currentDetailCustomer = null;  // 현재 상세 보기 중인 고객 이름

let sortStates = {
    customer: { key: 'amount', direction: 'desc', type: 'number' },
    region: { key: 'amount', direction: 'desc', type: 'number' },
    type: { key: 'amount', direction: 'desc', type: 'number' },
    detail: { key: 'contractDate', direction: 'desc', type: 'string' }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        allGovernmentData = await loadAndParseProcurementData();
        populateFilters(allGovernmentData);
        setupEventListeners();
        await analyzeCustomers();
    } catch (error) {
        console.error("초기화 실패:", error);
        alert("페이지 초기화 중 오류가 발생했습니다: " + error.message);
    }
});

async function loadAndParseProcurementData() {
    if (!window.sheetsAPI) throw new Error('sheets-api.js가 로드되지 않았습니다.');

    const parseSignedAmount = (value) => {
        const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
        if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return 0;
        return Number(cleaned) || 0;
    };

    const parseContractOrder = (item) => {
        const candidates = [
            item['계약차수'],
            item['계약변경차수'],
            item['계약납품통합변경차수'],
            item['cntrctDlvrReqChgOrd']
        ];

        for (const value of candidates) {
            const num = parseInt(String(value ?? '').replace(/[^\d]/g, ''), 10);
            if (!Number.isNaN(num) && num > 0) return num;
        }
        return 1;
    };

    const rawData = await window.sheetsAPI.loadAllProcurementData();

    return rawData
        .map(item => ({
            customer: (item['수요기관명'] || '').trim(),
            regionFull: (item['수요기관지역'] || '').trim(),
            region: (item['수요기관지역'] || '').trim().split(' ')[0],
            agencyType: (item['소관구분'] || '기타').trim(),
            amount: parseSignedAmount(item['공급금액']),
            contractDate: (item['기준일자'] || '').trim(),
            contractName: (item['계약명'] || '').trim(),
            product: (item['세부품명'] || '').trim(),
            supplier: (item['업체'] || '').trim(),
            rawAmount: String(item['공급금액'] ?? '').trim(),
            contractOrder: parseContractOrder(item)
        }))
        .filter(item =>
            item.supplier === '두발로 주식회사' &&
            item.customer &&
            item.contractDate &&
            item.contractName &&
            item.rawAmount !== '' &&
            !Number.isNaN(item.amount)
        );
}

function buildContractSummary(data, includeZeroAmount = false) {
    const contractMap = new Map();

    data.forEach(item => {
        const key = [
            item.customer,
            item.regionFull,
            item.agencyType,
            item.product,
            item.contractName
        ].join('||');

        if (!contractMap.has(key)) {
            contractMap.set(key, {
                customer: item.customer,
                regionFull: item.regionFull,
                region: item.region,
                agencyType: item.agencyType,
                product: item.product,
                contractName: item.contractName,
                amount: 0,
                contractDate: item.contractDate,
                firstContractDate: item.contractDate,
                latestContractDate: item.contractDate,
                lineCount: 0,
                contractOrder: item.contractOrder || 1
            });
        }

        const summary = contractMap.get(key);

        summary.amount += Number(item.amount) || 0;
        summary.lineCount += 1;

        if ((item.contractOrder || 1) > summary.contractOrder) {
            summary.contractOrder = item.contractOrder || 1;
        }

        if (item.contractDate < summary.firstContractDate) {
            summary.firstContractDate = item.contractDate;
        }

        if (item.contractDate > summary.latestContractDate) {
            summary.latestContractDate = item.contractDate;
            summary.contractDate = item.contractDate;
        }
    });

    let result = Array.from(contractMap.values());

    if (!includeZeroAmount) {
        result = result.filter(item => item.amount !== 0);
    }

    return result;
}

function populateFilters(data) {
    const regions = [...new Set(data.map(item => item.region).filter(Boolean))].sort();
    const agencyTypes = [...new Set(data.map(item => item.agencyType).filter(Boolean))].sort();
    const regionFilter = document.getElementById('regionFilter');
    const agencyTypeFilter = document.getElementById('agencyTypeFilter');

    regions.forEach(region => regionFilter.add(new Option(region, region)));
    agencyTypes.forEach(type => agencyTypeFilter.add(new Option(type, type)));
}

function setupEventListeners() {
    document.getElementById('analyzeBtn').addEventListener('click', analyzeCustomers);

    const tabs = ['customer', 'region', 'type'];
    tabs.forEach(tab => {
        document.getElementById(`${tab}Tab`)?.addEventListener('click', () => showTab(tab));

        const exportBtn = document.getElementById(`export${capitalize(tab)}Btn`);
        const table = document.getElementById(`${tab}Table`);
        if (exportBtn && table) {
            exportBtn.addEventListener('click', () => CommonUtils.exportTableToCSV(table, `관급매출_${tab}.csv`));
        }

        const printBtn = document.getElementById(`print${capitalize(tab)}Btn`);
        if (printBtn) printBtn.addEventListener('click', printCurrentView);
    });

    ['customer', 'region', 'type'].forEach(tableName => {
        const table = document.getElementById(`${tableName}Table`);
        table?.querySelector('thead').addEventListener('click', (e) => {
            const th = e.target.closest('th');
            if (th && th.dataset.sortKey) {
                handleTableSort(tableName, th.dataset.sortKey, th.dataset.sortType);
            }
        });
    });
}

function showTab(tabName) {
    document.querySelectorAll('.analysis-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
    document.getElementById(`${tabName}Tab`)?.classList.add('active');
    document.getElementById(`${tabName}Panel`)?.classList.remove('hidden');
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

    if (tableName === 'customer') renderCustomerTable(currentFilteredData);
    else if (tableName === 'region') renderRegionTable(currentFilteredData);
    else if (tableName === 'type') renderTypeTable(currentFilteredData);
    else if (tableName === 'detail') renderDetailTable();
}

async function analyzeCustomers() {
    currentDetailCustomer = null;
    document.getElementById('customerDetailPanel').classList.add('hidden');
    document.getElementById('analysisPanel').classList.remove('hidden');

    const year = document.getElementById('analysisYear').value;
    const product = document.getElementById('productType').value;
    const region = document.getElementById('regionFilter').value;
    const agencyType = document.getElementById('agencyTypeFilter').value;

    currentFilteredRawData = allGovernmentData.filter(item =>
        (year === 'all' || (item.contractDate && item.contractDate.startsWith(year))) &&
        (product === 'all' || item.product === product) &&
        (region === 'all' || item.region === region) &&
        (agencyType === 'all' || item.agencyType === agencyType)
    );

    currentFilteredData = buildContractSummary(currentFilteredRawData, false);

    if (currentFilteredData.length === 0) {
        CommonUtils.showAlert('선택된 조건에 해당하는 유효 계약 데이터가 없습니다.', 'warning');
    }

    updateSummaryStats(currentFilteredData);
    renderCustomerTable(currentFilteredData);
    renderRegionTable(currentFilteredData);
    renderTypeTable(currentFilteredData);
}

function updateSummaryStats(data) {
    const totalCustomers = new Set(data.map(item => item.customer)).size;
    const totalContracts = data.length;
    const totalSales = data.reduce((sum, item) => sum + item.amount, 0);

    document.getElementById('totalCustomers').textContent = CommonUtils.formatNumber(totalCustomers) + '곳';
    document.getElementById('totalContracts').textContent = CommonUtils.formatNumber(totalContracts) + '건';
    document.getElementById('totalSales').textContent = CommonUtils.formatCurrency(totalSales);
}

function sortData(data, sortState) {
    const { key, direction, type } = sortState;

    data.sort((a, b) => {
        const valA = a[key];
        const valB = b[key];
        let comparison = 0;

        if (type === 'number') {
            comparison = (Number(valA) || 0) - (Number(valB) || 0);
        } else {
            comparison = String(valA || '').localeCompare(String(valB || ''), 'ko');
        }

        return direction === 'asc' ? comparison : -comparison;
    });
}

function renderCustomerTable(data) {
    const customerMap = new Map();

    data.forEach(item => {
        if (!customerMap.has(item.customer)) {
            customerMap.set(item.customer, {
                contracts: [],
                amount: 0,
                region: item.regionFull,
                agencyType: item.agencyType
            });
        }

        const info = customerMap.get(item.customer);
        info.contracts.push(item);
        info.amount += item.amount;
    });

    let customerData = Array.from(customerMap.entries())
        .map(([customer, { contracts, amount, region, agencyType }]) => ({
            customer,
            region,
            agencyType,
            count: contracts.length,
            amount
        }))
        .filter(item => item.amount !== 0);

    const totalAmount = customerData.reduce((sum, item) => sum + item.amount, 0);

    customerData = customerData.map(item => ({
        ...item,
        share: totalAmount > 0 ? (item.amount / totalAmount) * 100 : 0
    }));

    sortData(customerData, sortStates.customer);
    customerData.forEach((item, index) => item.rank = index + 1);

    const tbody = document.getElementById('customerTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
    if (customerData.length === 0) return;

    tbody.innerHTML = '';
    customerData.forEach((item) => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td class="px-4 py-3 text-center">${item.rank}</td>
            <td class="px-4 py-3"><a href="#" class="text-blue-600 hover:underline" data-customer="${item.customer}">${item.customer}</a></td>
            <td class="px-4 py-3 text-center">${item.region}</td>
            <td class="px-4 py-3 text-center">${item.agencyType}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.count)}</td>
            <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
            <td class="px-4 py-3 text-right">${item.share.toFixed(1)}%</td>
        `;

        row.querySelector('a').addEventListener('click', (e) => {
            e.preventDefault();
            showCustomerDetail(e.target.dataset.customer);
        });
    });

    updateSortIndicators('customerTable', sortStates.customer);
}

function renderRegionTable(data) {
    const regionMap = new Map();

    data.forEach(item => {
        if (!regionMap.has(item.region)) {
            regionMap.set(item.region, { customers: new Set(), contracts: [], amount: 0 });
        }

        const info = regionMap.get(item.region);
        info.customers.add(item.customer);
        info.contracts.push(item);
        info.amount += item.amount;
    });

    let regionData = Array.from(regionMap.entries())
        .map(([region, { customers, contracts, amount }]) => ({
            region,
            customerCount: customers.size,
            contractCount: contracts.length,
            amount
        }))
        .filter(item => item.amount !== 0);

    const totalAmount = regionData.reduce((sum, item) => sum + item.amount, 0);

    regionData = regionData.map(item => ({
        ...item,
        share: totalAmount > 0 ? (item.amount / totalAmount) * 100 : 0
    }));

    sortData(regionData, sortStates.region);
    regionData.forEach((item, index) => item.rank = index + 1);

    const tbody = document.getElementById('regionTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
    if (regionData.length === 0) return;

    tbody.innerHTML = '';
    regionData.forEach((item) => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td class="px-4 py-3 text-center">${item.rank}</td>
            <td class="px-4 py-3">${item.region}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.customerCount)}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.contractCount)}</td>
            <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
            <td class="px-4 py-3 text-right">${item.share.toFixed(1)}%</td>
        `;
    });

    updateSortIndicators('regionTable', sortStates.region);
}

function renderTypeTable(data) {
    const typeMap = new Map();

    data.forEach(item => {
        if (!typeMap.has(item.agencyType)) {
            typeMap.set(item.agencyType, { customers: new Set(), contracts: [], amount: 0 });
        }

        const info = typeMap.get(item.agencyType);
        info.customers.add(item.customer);
        info.contracts.push(item);
        info.amount += item.amount;
    });

    let typeData = Array.from(typeMap.entries())
        .map(([agencyType, { customers, contracts, amount }]) => ({
            agencyType,
            customerCount: customers.size,
            contractCount: contracts.length,
            amount
        }))
        .filter(item => item.amount !== 0);

    const totalAmount = typeData.reduce((sum, item) => sum + item.amount, 0);

    typeData = typeData.map(item => ({
        ...item,
        share: totalAmount > 0 ? (item.amount / totalAmount) * 100 : 0
    }));

    sortData(typeData, sortStates.type);
    typeData.forEach((item, index) => item.rank = index + 1);

    const tbody = document.getElementById('typeTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
    if (typeData.length === 0) return;

    tbody.innerHTML = '';
    typeData.forEach((item) => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td class="px-4 py-3 text-center">${item.rank}</td>
            <td class="px-4 py-3">${item.agencyType}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.customerCount)}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.contractCount)}</td>
            <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
            <td class="px-4 py-3 text-right">${item.share.toFixed(1)}%</td>
        `;
    });

    updateSortIndicators('typeTable', sortStates.type);
}

function showCustomerDetail(customerName) {
    currentDetailCustomer = customerName;
    const detailPanel = document.getElementById('customerDetailPanel');

    detailPanel.innerHTML = `
        <div class="p-6 printable-area">
            <div class="flex justify-between items-center mb-4 no-print">
                <h3 class="text-lg font-semibold text-gray-900">${customerName} - 상세 거래 내역</h3>
                <button id="backToListBtn" class="btn btn-secondary btn-sm">목록으로</button>
            </div>
            <div class="overflow-x-auto">
                <table id="detailTable" class="min-w-full divide-y divide-gray-200 data-table">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractDate" data-sort-type="string"><span>최종일자</span></th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractName" data-sort-type="string"><span>계약명</span></th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractOrder" data-sort-type="number"><span>계약차수</span></th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="product" data-sort-type="string"><span>품목</span></th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>최종금액</span></th>
                        </tr>
                    </thead>
                    <tbody id="detailTableBody"></tbody>
                </table>
            </div>
        </div>
    `;

    renderDetailTable();

    detailPanel.classList.remove('hidden');
    document.getElementById('analysisPanel').classList.add('hidden');

    document.getElementById('backToListBtn').addEventListener('click', () => {
        currentDetailCustomer = null;
        detailPanel.classList.add('hidden');
        document.getElementById('analysisPanel').classList.remove('hidden');
    });

    document.getElementById('detailTable').querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('th');
        if (th && th.dataset.sortKey) {
            handleTableSort('detail', th.dataset.sortKey, th.dataset.sortType);
        }
    });
}

function renderDetailTable() {
    if (!currentDetailCustomer) return;

    const customerRawData = currentFilteredRawData.filter(item => item.customer === currentDetailCustomer);

    // 상세 화면은 상쇄된 계약도 보여줌
    const detailData = buildContractSummary(customerRawData, true);

    sortData(detailData, sortStates.detail);

    const tbody = document.getElementById('detailTableBody');
    tbody.innerHTML = '';

    if (detailData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
        updateSortIndicators('detailTable', sortStates.detail);
        return;
    }

    detailData.forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td class="px-4 py-3">${item.contractDate}</td>
                <td class="px-4 py-3">${item.contractName}</td>
                <td class="px-4 py-3">${item.contractOrder}차</td>
                <td class="px-4 py-3">${item.product}</td>
                <td class="px-4 py-3 text-right">${CommonUtils.formatCurrency(item.amount)}</td>
            </tr>
        `;
    });

    updateSortIndicators('detailTable', sortStates.detail);
}

function printCurrentView() {
    let activePanel;

    if (currentDetailCustomer) {
        activePanel = document.getElementById('customerDetailPanel');
    } else {
        activePanel = document.querySelector('.tab-panel:not(.hidden)');
    }

    if (activePanel) {
        activePanel.classList.add('printable-area');

        if (!currentDetailCustomer) {
            document.querySelector('.stats-grid').classList.add('printable-area');
        }

        window.print();

        activePanel.classList.remove('printable-area');
        if (!currentDetailCustomer) {
            document.querySelector('.stats-grid').classList.remove('printable-area');
        }
    } else {
        CommonUtils.showAlert('인쇄할 내용이 없습니다.', 'warning');
    }
}

function capitalize(s) {
    if (typeof s !== 'string') return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
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
