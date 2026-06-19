// customer-analysis.js
console.log('%c[customer-analysis.js v=20260619c — 관급분석 인쇄(제목+KPI+리스트, 전용영역)]', 'color:#0ea5e9; font-weight:bold');

// 전역 변수
let allGovernmentData = [];        // 원본 라인 데이터
let currentFilteredRawData = [];   // 현재 필터 적용된 원본 라인 데이터
let currentFilteredData = [];      // 현재 필터 적용 + 계약 기준 집계 데이터
let currentDetailCustomer = null;  // 현재 상세 보기 중인 고객 이름
let govBucket = 'all';             // 비율카드 소관 버킷: all | 국가기관 | 지방정부 | 기타기관
let govInited = false;             // 이벤트 바인딩 1회
let govLoaded = false;             // B소스 데이터 로드 완료(세션 1회)
let govLoadingInFlight = false;    // 로딩 중 재클릭 시 중복 fetch 방지

let sortStates = {
    customer: { key: 'amount', direction: 'desc', type: 'number' },
    region: { key: 'amount', direction: 'desc', type: 'number' },
    type: { key: 'amount', direction: 'desc', type: 'number' },      // 레거시 스탠드얼론(소관기관별)
    product: { key: 'amount', direction: 'desc', type: 'number' },   // 품목별 분석
    detail: { key: 'contractDate', direction: 'desc', type: 'string' }
};

// [관급분석] 탭 진입점 — 매출분석 페이지 탭 첫 열림(지연로드) 또는 스탠드얼론 페이지 로드 시 호출
async function initGovTab() {
    if (!govInited) { govInited = true; setupEventListeners(); }
    if (govLoaded) return;
    await loadGovData();
}

async function loadGovData() {
    if (govLoadingInFlight) return;   // 느린 조달청 로드 중 재클릭 → 중복 fetch 방지
    govLoadingInFlight = true;
    showGovLoading(true);
    try {
        allGovernmentData = await loadAndParseProcurementData();
        populateFilters(allGovernmentData);
        await analyzeCustomers();
        govLoaded = true;
    } catch (error) {
        console.error("관급분석 초기화 실패:", error);
        CommonUtils.showAlert("관급분석 데이터 로딩 중 오류: " + error.message, 'error');
    } finally {
        govLoadingInFlight = false;
        showGovLoading(false);
    }
}

function refreshGovData() {
    govLoaded = false;
    loadGovData();   // loadAllProcurementData가 매번 fresh fetch
}

function showGovLoading(on) {
    const el = document.getElementById('govLoading');
    if (el) el.classList.toggle('hidden', !on);
}

window.initGovTab = initGovTab;   // monthly-sales.js(탭 전환)·스탠드얼론에서 호출

async function loadAndParseProcurementData() {
    if (!window.sheetsAPI) throw new Error('sheets-api.js가 로드되지 않았습니다.');

    const parseSignedAmount = CommonUtils.parseSignedAmount;  // 공통추출(common.js)

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
            contractOrder: parseContractOrder(item),
            fullProductName: (item['물품식별명'] || '').trim(),
            quantity: parseSignedAmount(item['계약납품수량']),
            unitPrice: parseSignedAmount(item['계약납품단가']),
            contractMethod: (item['계약방법'] || '').trim()
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
                contractOrder: item.contractOrder || 1,
                supplier: item.supplier,
                lineItems: []
            });
        }

        const summary = contractMap.get(key);

        summary.amount += Number(item.amount) || 0;
        summary.lineCount += 1;
        summary.lineItems.push({
            fullProductName: item.fullProductName || '',
            product: item.product || '',
            quantity: Number(item.quantity) || 0,
            unitPrice: Number(item.unitPrice) || 0,
            amount: Number(item.amount) || 0,
            contractMethod: item.contractMethod || '',
            date: item.contractDate || ''
        });

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
    const regionFilter = document.getElementById('regionFilter');
    if (regionFilter) {
        regionFilter.length = 1;   // '전체'만 남기고 리셋(새로고침 시 중복 방지)
        regions.forEach(region => regionFilter.add(new Option(region, region)));
    }
    // 소관구분 드롭다운은 비율카드로 대체됨 — 있으면(레거시 스탠드얼론) 채우고, 없으면 skip
    const agencyTypeFilter = document.getElementById('agencyTypeFilter');
    if (agencyTypeFilter) {
        agencyTypeFilter.length = 1;
        [...new Set(data.map(item => item.agencyType).filter(Boolean))].sort()
            .forEach(type => agencyTypeFilter.add(new Option(type, type)));
    }
}

function setupEventListeners() {
    document.getElementById('analyzeBtn')?.addEventListener('click', analyzeCustomers);
    document.getElementById('govPrintBtn')?.addEventListener('click', printGovView);

    // type = 레거시 스탠드얼론(소관기관별), product = 매출분석 탭(품목별). 없는 건 ?. 가드로 skip
    ['customer', 'region', 'type', 'product'].forEach(tab => {
        document.getElementById(`${tab}Tab`)?.addEventListener('click', () => showTab(tab));

        const exportBtn = document.getElementById(`export${capitalize(tab)}Btn`);
        const table = document.getElementById(`${tab}Table`);
        if (exportBtn && table) {
            exportBtn.addEventListener('click', () => CommonUtils.exportTableToCSV(table, `관급매출_${tab}.csv`));
        }
        document.getElementById(`print${capitalize(tab)}Btn`)?.addEventListener('click', printCurrentView);

        const thead = table && table.querySelector('thead');
        if (thead) thead.addEventListener('click', (e) => {
            const th = e.target.closest('th');
            if (th && th.dataset.sortKey) handleTableSort(tab, th.dataset.sortKey, th.dataset.sortType);
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
    else if (tableName === 'product') renderProductTable(currentFilteredData);
    else if (tableName === 'detail') renderDetailTable();
}

async function analyzeCustomers() {
    currentDetailCustomer = null;
    document.getElementById('customerDetailPanel').classList.add('hidden');
    document.getElementById('analysisPanel').classList.remove('hidden');

    const year = document.getElementById('analysisYear').value;
    const product = document.getElementById('productType').value;
    const region = document.getElementById('regionFilter').value;

    currentFilteredRawData = allGovernmentData.filter(item =>
        (year === 'all' || (item.contractDate && item.contractDate.startsWith(year))) &&
        (product === 'all' || item.product === product) &&
        (region === 'all' || item.region === region) &&
        matchesAgencyType(item.agencyType, govBucket)   // 비율카드 소관 버킷
    );

    currentFilteredData = buildContractSummary(currentFilteredRawData, false);

    if (currentFilteredData.length === 0) {
        CommonUtils.showAlert('선택된 조건에 해당하는 유효 계약 데이터가 없습니다.', 'warning');
    }

    updateSummaryStats(currentFilteredData);
    renderGovRatioCards();
    renderCustomerTable(currentFilteredData);
    renderRegionTable(currentFilteredData);
    renderTypeTable(currentFilteredData);       // 레거시 스탠드얼론(소관기관별) — 매출분석엔 표 없어 guard로 skip
    renderProductTable(currentFilteredData);    // 품목별 분석
}

// 소관 버킷 분류 (카르텔 워치 companies.js 패턴): 원본에 '국가기관'/'지방정부' 존재, 나머지=기타기관
function matchesAgencyType(agencyType, bucket) {
    if (bucket === 'all') return true;
    if (bucket === '기타기관') return agencyType !== '국가기관' && agencyType !== '지방정부';
    return agencyType === bucket;
}

// 국가/지방/기타 클릭형 비율카드 — 매출액 기준 비율, 클릭→버킷 토글→리스트(표) 필터
function renderGovRatioCards() {
    const el = document.getElementById('govRatioCards');
    if (!el) return;   // 컨테이너 없으면 skip(레거시 스탠드얼론 안전)

    // 비율 기준 = 버킷 제외한 현재 필터(기간/품목/지역) 전체
    const year = document.getElementById('analysisYear').value;
    const product = document.getElementById('productType').value;
    const region = document.getElementById('regionFilter').value;
    const baseRaw = allGovernmentData.filter(item =>
        (year === 'all' || (item.contractDate && item.contractDate.startsWith(year))) &&
        (product === 'all' || item.product === product) &&
        (region === 'all' || item.region === region)
    );
    let nat = 0, loc = 0, oth = 0, total = 0;
    buildContractSummary(baseRaw, false).forEach(c => {
        const a = c.amount; total += a;
        if (c.agencyType === '국가기관') nat += a;
        else if (c.agencyType === '지방정부') loc += a;
        else oth += a;
    });
    const pct = n => total > 0 ? (n / total * 100).toFixed(1) + '%' : '0.0%';
    const card = (bucket, val) => `
        <div class="bg-white rounded-lg shadow-md p-4 cursor-pointer gov-ratio-card${govBucket === bucket ? ' ring-2 ring-blue-500' : ''}" data-bucket="${bucket}">
            <p class="text-sm font-medium text-gray-600">${bucket} 비율</p>
            <p class="text-xl font-bold text-gray-900">${pct(val)}</p>
            <p class="text-xs text-gray-500 mt-1">${CommonUtils.formatCurrency(val)}</p>
        </div>`;
    el.innerHTML = card('국가기관', nat) + card('지방정부', loc) + card('기타기관', oth);
    el.querySelectorAll('.gov-ratio-card').forEach(c => c.addEventListener('click', () => {
        const b = c.dataset.bucket;
        govBucket = (govBucket === b) ? 'all' : b;   // 재클릭 해제(토글)
        analyzeCustomers();
    }));
}

function updateSummaryStats(data) {
    const totalCustomers = new Set(data.map(item => item.customer)).size;
    const totalContracts = data.length;
    const totalSales = data.reduce((sum, item) => sum + item.amount, 0);

    document.getElementById('totalCustomers').textContent = CommonUtils.formatNumber(totalCustomers) + '곳';
    document.getElementById('totalContracts').textContent = CommonUtils.formatNumber(totalContracts) + '건';
    document.getElementById('totalSales').textContent = (totalSales / 1e8).toFixed(1) + '억원';   // 억원(소수1)
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
                region: item.region,  // 광역만(지역별/소관 탭과 단위 통일; 시군은 수요기관명에 포함)
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
    if (!document.getElementById('typeTableBody')) return;   // 매출분석 탭엔 소관기관별 표 없음(레거시 스탠드얼론 전용)
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

// 품목별 분석 — currentFilteredData를 품목(세부품명)으로 그룹(기존 필터 그대로 적용; 품목=전체면 전 품목)
function renderProductTable(data) {
    const tbody = document.getElementById('productTableBody');
    if (!tbody) return;   // 매출분석 탭 전용(스탠드얼론엔 없음)
    data = data || currentFilteredData;

    const map = new Map();
    data.forEach(item => {
        const key = item.product || '(미분류)';
        if (!map.has(key)) map.set(key, { customers: new Set(), contracts: [], amount: 0 });
        const info = map.get(key);
        info.customers.add(item.customer);
        info.contracts.push(item);
        info.amount += item.amount;
    });

    let rows = Array.from(map.entries())
        .map(([product, { customers, contracts, amount }]) => ({ product, customerCount: customers.size, contractCount: contracts.length, amount }))
        .filter(i => i.amount !== 0);
    const total = rows.reduce((s, i) => s + i.amount, 0);
    rows = rows.map(i => ({ ...i, share: total > 0 ? (i.amount / total) * 100 : 0 }));
    sortData(rows, sortStates.product);
    rows.forEach((i, idx) => i.rank = idx + 1);

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
        updateSortIndicators('productTable', sortStates.product);
        return;
    }
    rows.forEach(i => {
        const r = tbody.insertRow();
        r.innerHTML = `
            <td class="px-4 py-3 text-center">${i.rank}</td>
            <td class="px-4 py-3">${i.product}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(i.customerCount)}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(i.contractCount)}</td>
            <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(i.amount)}</td>
            <td class="px-4 py-3 text-right">${i.share.toFixed(1)}%</td>`;
    });
    updateSortIndicators('productTable', sortStates.product);
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
                <table id="gaDetailTable" class="min-w-full divide-y divide-gray-200 data-table">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractDate" data-sort-type="string"><span>최종일자</span></th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractName" data-sort-type="string"><span>계약명</span></th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="product" data-sort-type="string"><span>품목</span></th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>최종금액</span></th>
                        </tr>
                    </thead>
                    <tbody id="gaDetailTableBody"></tbody>
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

    document.getElementById('gaDetailTable').querySelector('thead').addEventListener('click', (e) => {
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

    const tbody = document.getElementById('gaDetailTableBody');
    tbody.innerHTML = '';

    if (detailData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
        updateSortIndicators('gaDetailTable', sortStates.detail);
        return;
    }

    detailData.forEach((item, idx) => {
        tbody.innerHTML += `
            <tr>
                <td class="px-4 py-3">${item.contractDate}</td>
                <td class="px-4 py-3"><a href="#" class="text-blue-600 hover:underline contract-name-link" data-idx="${idx}">${item.contractName}</a></td>
                <td class="px-4 py-3">${item.product}</td>
                <td class="px-4 py-3 text-right">${CommonUtils.formatCurrency(item.amount)}</td>
            </tr>
        `;
    });

    tbody.querySelectorAll('.contract-name-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const idx = Number(link.dataset.idx);
            showContractItemsPopup(detailData[idx]);
        });
    });

    updateSortIndicators('gaDetailTable', sortStates.detail);
}

function showContractItemsPopup(summary) {
    if (!summary) return;
    const items = Array.isArray(summary.lineItems) ? summary.lineItems : [];

    let contentHtml = `<p class="text-sm text-gray-600 mb-3">
        <span class="font-medium">${summary.customer}</span> · ${summary.supplier || '-'} ·
        총 ${items.length}개 라인 · 합계 ${CommonUtils.formatCurrency(summary.amount)}
    </p>`;

    if (items.length === 0) {
        contentHtml += '<p class="text-center text-gray-500 py-4">이 계약에는 등록된 품목 정보가 없습니다.</p>';
    } else {
        contentHtml += `<div class="overflow-x-auto"><table class="w-full text-sm text-left">
            <thead class="bg-gray-50"><tr>
                <th class="p-2">모델</th>
                <th class="p-2">규격</th>
                <th class="p-2 text-right">수량</th>
                <th class="p-2 text-right">단가</th>
                <th class="p-2 text-right">합계액</th>
            </tr></thead><tbody>`;

        const sorted = [...items].sort((a, b) => (b.amount || 0) - (a.amount || 0));
        sorted.forEach(line => {
            const { model, spec, raw } = CommonUtils.parseProductIdentName(line.fullProductName);
            const specCell = (spec === '-' && raw)
                ? `<span class="text-gray-500" title="원본">${raw}</span>`
                : spec;
            contentHtml += `<tr class="border-b">
                <td class="p-2 whitespace-nowrap">${model}</td>
                <td class="p-2">${specCell}</td>
                <td class="p-2 text-right">${CommonUtils.formatNumber(line.quantity) || '-'}</td>
                <td class="p-2 text-right">${line.unitPrice ? CommonUtils.formatCurrency(line.unitPrice) : '-'}</td>
                <td class="p-2 text-right font-medium">${CommonUtils.formatCurrency(line.amount)}</td>
            </tr>`;
        });
        contentHtml += '</tbody></table></div>';
    }

    CommonUtils.showModal(`'${summary.contractName}' 품목 상세 내역`, contentHtml, { width: '900px' });
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

// 매출 분석 [관급분석] 인쇄: 제목 + KPI 3 + 현재 탭 리스트 → #printArea 한 컨테이너만 출력(겹침 방지)
function buildGovTitle() {
    const year = document.getElementById('analysisYear').value;
    const product = document.getElementById('productType').value;
    const region = document.getElementById('regionFilter').value;
    const parts = [];
    parts.push(govBucket === 'all' ? '전체 소관' : govBucket);
    parts.push(year === 'all' ? '전체 기간' : `${year}년`);
    parts.push(product === 'all' ? '전체 품목' : product);
    if (region !== 'all') parts.push(region);
    return `관급매출 현황 — ${parts.join(' · ')}`;
}

function printGovView() {
    const area = document.getElementById('printArea');
    if (!area) return;
    const kpi = `
        <div style="display:flex; gap:28px; margin:6px 0 14px; font-size:13px;">
            <div>총 고객 수 <b>${document.getElementById('totalCustomers').textContent}</b></div>
            <div>총 계약 건수 <b>${document.getElementById('totalContracts').textContent}</b></div>
            <div>총 거래액 <b>${document.getElementById('totalSales').textContent}</b></div>
        </div>`;
    const activePanel = document.querySelector('#analysisPanel .tab-panel:not(.hidden)');
    const table = activePanel ? activePanel.querySelector('table') : null;
    const tableHtml = table ? table.outerHTML : '<p>표가 없습니다.</p>';
    area.innerHTML = `<h2 style="font-size:18px; font-weight:700; margin-bottom:2px;">${buildGovTitle()}</h2>${kpi}${tableHtml}`;
    area.classList.remove('hidden');
    document.body.classList.add('printing');
    window.print();
    document.body.classList.remove('printing');
    area.classList.add('hidden');
    area.innerHTML = '';
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
