// agency-purchase.js

// 전역 변수
let allData = [];                 // 원본 라인 데이터
let currentFilteredRawData = [];  // 현재 필터 적용된 원본 데이터
let currentFilteredData = [];     // 현재 필터 적용 + 계약 기준 집계 데이터
let chartInstance = null;
let currentAgencyInDetailView = null;

// 기관 상세 화면의 섹션 펼침 상태. 차트 클릭/필터 변경으로 재렌더돼도 유지.
// 기본값: 둘 다 펼쳐서 첫 진입에서 바로 차트·표 보이게.
let detailSectionsExpanded = { trend: true, contract: true };

let sortStates = {
    rank: { key: 'amount', direction: 'desc', type: 'number' },
    purchase: { key: 'amount', direction: 'desc', type: 'number' },
    contract: { key: 'contractDate', direction: 'desc', type: 'string' }
};

document.addEventListener('DOMContentLoaded', async () => {
    showLoadingState(true, '데이터 로딩 중');
    try {
        allData = await loadAndParseData();
        populateFilters(allData);
        setupEventListeners();
        await runAnalysis(true);
    } catch (error) {
        console.error('초기화 실패:', error);
        CommonUtils.showAlert(`페이지 초기화 중 오류가 발생했습니다: ${error.message}`, 'error');
    } finally {
        showLoadingState(false);
    }
});

function setupEventListeners() {
    document.getElementById('analyzeBtn')?.addEventListener('click', () => runAnalysis());

    // 필터 변경 시 상세 화면(있으면) 유지하고 데이터만 재집계.
    // forceList=false → currentAgencyInDetailView 보존, runAnalysis가 showAgencyDetail 재호출.
    document.getElementById('analysisYear')?.addEventListener('change', () => runAnalysis(false));
    document.getElementById('productFilter')?.addEventListener('change', () => runAnalysis(false));
    document.getElementById('agencyTypeFilter')?.addEventListener('change', () => runAnalysis(false));

    document.getElementById('regionFilter')?.addEventListener('change', () => {
        populateCityFilter();
        runAnalysis(false);
    });

    document.getElementById('cityFilter')?.addEventListener('change', () => runAnalysis(false));

    document.getElementById('agencySearchFilter')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runAnalysis();
    });
}

async function runAnalysis(forceList = false) {
    showLoadingState(true, '데이터 분석 중');

    if (forceList) {
        currentAgencyInDetailView = null;
    }

    const year = document.getElementById('analysisYear')?.value || 'all';
    const product = document.getElementById('productFilter')?.value || 'all';
    const region = document.getElementById('regionFilter')?.value || 'all';
    const city = document.getElementById('cityFilter')?.value || 'all';
    const agencyType = document.getElementById('agencyTypeFilter')?.value || 'all';
    const agencySearch = (document.getElementById('agencySearchFilter')?.value || '').trim().toLowerCase();

    currentFilteredRawData = allData.filter(item =>
        (year === 'all' || (item.date && item.date.startsWith(year))) &&
        (product === 'all' || item.product === product) &&
        (region === 'all' || item.region === region) &&
        (city === 'all' || item.city === city) &&
        (agencyType === 'all' || item.agencyType === agencyType) &&
        (agencySearch === '' || item.agency.toLowerCase().includes(agencySearch))
    );

    // 요약 화면은 계약 기준 순액 집계, 0원 상쇄 계약 제외
    currentFilteredData = buildContractSummary(currentFilteredRawData, false);

    if (currentAgencyInDetailView) {
        showAgencyDetail(currentAgencyInDetailView);
    } else {
        document.getElementById('agencyDetailPanel')?.classList.add('hidden');
        document.getElementById('agencyRankPanel')?.classList.remove('hidden');
        renderAgencyRankPanel(currentFilteredData);
    }

    showLoadingState(false);
}

async function loadAndParseData() {
    if (!window.sheetsAPI) throw new Error('sheets-api.js가 로드되지 않았습니다.');
    if (typeof window.sheetsAPI.loadAllProcurementData !== 'function') {
        throw new Error('sheetsAPI.loadAllProcurementData 함수를 찾을 수 없습니다.');
    }

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

    const splitRegion = (regionFull) => {
        const text = String(regionFull || '').trim();
        const parts = text.split(/\s+/).filter(Boolean);
        return {
            region: parts[0] || '',
            city: parts.slice(1).join(' ')
        };
    };

    const rawData = await window.sheetsAPI.loadAllProcurementData();

    const parsed = rawData
        .map(item => {
            const regionFull = (item['수요기관지역'] || '').trim();
            const { region, city } = splitRegion(regionFull);

            return {
                agency: (item['수요기관명'] || '').trim(),
                regionFull,
                region,
                city,
                agencyType: (item['소관구분'] || '기타').trim(),
                amount: parseSignedAmount(item['공급금액']),
                date: (item['기준일자'] || '').trim(),
                contractName: (item['계약명'] || '').trim(),
                product: (item['세부품명'] || '').trim(),
                supplier: (item['업체'] || '').trim(),
                rawAmount: String(item['공급금액'] ?? '').trim(),
                contractOrder: parseContractOrder(item),
                fullProductName: (item['물품식별명'] || '').trim(),
                quantity: parseSignedAmount(item['계약납품수량']),
                unitPrice: parseSignedAmount(item['계약납품단가']),
                contractMethod: (item['계약방법'] || '').trim()
            };
        })
        .filter(item =>
            item.agency &&
            item.date &&
            item.contractName &&
            item.supplier &&
            item.rawAmount !== '' &&
            !Number.isNaN(item.amount)
        );

    return parsed;
}

function buildContractSummary(data, includeZeroAmount = false) {
    const contractMap = new Map();

    data.forEach(item => {
        const key = [
            item.agency,
            item.regionFull,
            item.agencyType,
            item.product,
            item.supplier,
            item.contractName
        ].join('||');

        if (!contractMap.has(key)) {
            contractMap.set(key, {
                agency: item.agency,
                regionFull: item.regionFull,
                region: item.region,
                city: item.city,
                agencyType: item.agencyType,
                product: item.product,
                supplier: item.supplier,
                contractName: item.contractName,
                amount: 0,
                contractDate: item.date,
                firstContractDate: item.date,
                latestContractDate: item.date,
                lineCount: 0,
                contractOrder: item.contractOrder || 1,
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
            date: item.date || ''
        });

        if ((item.contractOrder || 1) > summary.contractOrder) {
            summary.contractOrder = item.contractOrder || 1;
        }

        if (item.date < summary.firstContractDate) {
            summary.firstContractDate = item.date;
        }

        if (item.date > summary.latestContractDate) {
            summary.latestContractDate = item.date;
            summary.contractDate = item.date;
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

    if (!regionFilter || !agencyTypeFilter) return;

    regionFilter.innerHTML = '<option value="all">전체</option>';
    agencyTypeFilter.innerHTML = '<option value="all">전체</option>';

    regions.forEach(region => regionFilter.add(new Option(region, region)));
    agencyTypes.forEach(type => agencyTypeFilter.add(new Option(type, type)));

    if (regionFilter.querySelector('option[value="경기도"]')) {
        regionFilter.value = '경기도';
    }
    if (agencyTypeFilter.querySelector('option[value="지방정부"]')) {
        agencyTypeFilter.value = '지방정부';
    }

    populateCityFilter();
}

function populateCityFilter() {
    const selectedRegion = document.getElementById('regionFilter')?.value || 'all';
    const cityFilter = document.getElementById('cityFilter');
    if (!cityFilter) return;

    cityFilter.innerHTML = '<option value="all">전체</option>';

    if (selectedRegion !== 'all') {
        const cities = [...new Set(
            allData
                .filter(item => item.region === selectedRegion && item.city)
                .map(item => item.city)
        )].sort();

        cities.forEach(city => cityFilter.add(new Option(city, city)));
    }
}

function renderAgencyRankPanel(data) {
    const panel = document.getElementById('agencyRankPanel');
    if (!panel) return;

    panel.innerHTML = `
        <div class="p-6 printable-area">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-900">수요기관 구매 순위</h3>
                <div class="flex space-x-2 no-print">
                    <button id="printRankBtn" class="btn btn-secondary btn-sm">인쇄</button>
                    <button id="exportRankBtn" class="btn btn-secondary btn-sm">CSV 내보내기</button>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table id="agencyRankTable" class="min-w-full divide-y divide-gray-200 data-table">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="rank" data-sort-type="number"><span>순위</span></th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="agency" data-sort-type="string"><span>수요기관명</span></th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="fullRegion" data-sort-type="string"><span>지역</span></th>
                            <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractCount" data-sort-type="number"><span>거래건수</span></th>
                            <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="supplierCount" data-sort-type="number"><span>거래처 수</span></th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>총 구매액</span></th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="vsAvg" data-sort-type="number"><span>평균 대비</span></th>
                        </tr>
                    </thead>
                    <tbody id="agencyRankBody"></tbody>
                </table>
            </div>
        </div>
    `;

    const agencyMap = new Map();

    data.forEach(item => {
        if (!agencyMap.has(item.agency)) {
            agencyMap.set(item.agency, {
                amount: 0,
                contracts: new Set(),
                suppliers: new Set(),
                fullRegion: item.regionFull
            });
        }

        const info = agencyMap.get(item.agency);
        info.amount += item.amount;
        info.contracts.add(`${item.supplier}||${item.contractName}||${item.product}`);
        info.suppliers.add(item.supplier);
    });

    let rankedAgencies = [...agencyMap.entries()]
        .map(([agency, { amount, contracts, suppliers, fullRegion }]) => ({
            agency,
            amount,
            contractCount: contracts.size,
            supplierCount: suppliers.size,
            fullRegion,
            vsAvg: 0
        }))
        .filter(item => item.amount !== 0);

    const selectedYearValue = document.getElementById('analysisYear')?.value || 'all';
    const selectedYear = selectedYearValue === 'all'
        ? new Date().getFullYear()
        : parseInt(selectedYearValue, 10);

    rankedAgencies.forEach(agencyItem => {
        const years = Array.from({ length: 5 }, (_, i) => selectedYear - i).sort();

        const baseData = allData.filter(d => {
            if (d.agency !== agencyItem.agency) return false;
            if (!d.date) return false;
            const year = parseInt(String(d.date).slice(0, 4), 10);
            if (!years.includes(year)) return false;

            const product = document.getElementById('productFilter')?.value || 'all';
            return product === 'all' || d.product === product;
        });

        const summarized = buildContractSummary(baseData, false);

        const salesByYear = {};
        years.forEach(year => salesByYear[year] = 0);

        summarized.forEach(d => {
            const year = parseInt(String(d.contractDate).slice(0, 4), 10);
            if (salesByYear.hasOwnProperty(year)) {
                salesByYear[year] += d.amount;
            }
        });

        const actualYears = Object.values(salesByYear).filter(amount => amount > 0);
        const avgAmount = actualYears.length > 0
            ? actualYears.reduce((sum, amount) => sum + amount, 0) / actualYears.length
            : 0;

        const selectedYearAmount = salesByYear[selectedYear] || 0;
        agencyItem.vsAvg = avgAmount > 0 ? ((selectedYearAmount / avgAmount) - 1) * 100 : 0;
    });

    sortData(rankedAgencies, sortStates.rank);
    rankedAgencies.forEach((item, index) => item.rank = index + 1);

    const tbody = document.getElementById('agencyRankBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (rankedAgencies.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">표시할 데이터가 없습니다.</td></tr>`;
    } else {
        rankedAgencies.forEach(item => {
            const row = tbody.insertRow();
            const diffText = item.vsAvg === 0
                ? '-'
                : (item.vsAvg > 0 ? `▲ ${item.vsAvg.toFixed(1)}%` : `▼ ${Math.abs(item.vsAvg).toFixed(1)}%`);
            const diffColor = item.vsAvg > 0 ? 'text-red-500' : 'text-blue-500';

            row.innerHTML = `
                <td class="px-4 py-3 text-center">${item.rank}</td>
                <td class="px-4 py-3"><a href="#" data-agency="${item.agency}" class="text-blue-600 hover:underline">${item.agency}</a></td>
                <td class="px-4 py-3">${item.fullRegion}</td>
                <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.contractCount)}</td>
                <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.supplierCount)}</td>
                <td class="px-4 py-3 text-right font-medium whitespace-nowrap">${CommonUtils.formatCurrency(item.amount)}</td>
                <td class="px-4 py-3 text-right font-medium ${diffColor}">${diffText}</td>
            `;

            row.querySelector('a')?.addEventListener('click', (e) => {
                e.preventDefault();
                showAgencyDetail(e.target.dataset.agency);
            });
        });
    }

    updateSortIndicators('agencyRankTable', sortStates.rank);

    document.getElementById('agencyRankTable')?.querySelector('thead')?.addEventListener('click', e => {
        const th = e.target.closest('th');
        if (!th || !th.dataset.sortKey) return;

        handleTableSort('rank', th.dataset.sortKey, th.dataset.sortType);
        renderAgencyRankPanel(currentFilteredData);
    });

    document.getElementById('printRankBtn')?.addEventListener('click', () => printPanel(panel));
    document.getElementById('exportRankBtn')?.addEventListener('click', () => {
        CommonUtils.exportTableToCSV(document.getElementById('agencyRankTable'), '수요기관_구매순위.csv');
    });
}

function showAgencyDetail(agencyName) {
    currentAgencyInDetailView = agencyName;

    const detailPanel = document.getElementById('agencyDetailPanel');
    const yearFilter = document.getElementById('analysisYear');
    const selectedYearText = yearFilter?.value === 'all'
        ? '전체 기간'
        : yearFilter.options[yearFilter.selectedIndex].text;

    if (!detailPanel) return;

    detailPanel.innerHTML = `
        <div id="comprehensiveReport" class="p-6 printable-area">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-gray-900">${agencyName} 분석 보고서 (${selectedYearText})</h3>
                <div class="flex items-center space-x-2 no-print">
                    <button id="toggleAllBtn" class="btn btn-secondary btn-sm">${(detailSectionsExpanded.trend && detailSectionsExpanded.contract) ? '전체 접기' : '전체 펼치기'}</button>
                    <button id="printDetailBtn" class="btn btn-secondary btn-sm">보고서 인쇄</button>
                    <button id="backToListBtn" class="btn btn-secondary btn-sm">목록으로</button>
                </div>
            </div>

            <div id="purchaseDetail" class="report-section"></div>

            <div class="mt-12 no-print">
                <button id="toggleTrendBtn" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 rounded-md flex justify-between items-center">
                    <span class="font-semibold">연도별 추이</span>
                    <span class="toggle-icon">${detailSectionsExpanded.trend ? '▲' : '▼'}</span>
                </button>
            </div>
            <div id="trendDetail" class="mt-4 ${detailSectionsExpanded.trend ? '' : 'hidden'} report-section"></div>

            <div class="mt-4 no-print">
                <button id="toggleContractBtn" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 rounded-md flex justify-between items-center">
                    <span class="font-semibold">계약 상세</span>
                    <span class="toggle-icon">${detailSectionsExpanded.contract ? '▲' : '▼'}</span>
                </button>
            </div>
            <div id="contractDetail" class="mt-4 ${detailSectionsExpanded.contract ? '' : 'hidden'} report-section"></div>
        </div>
    `;

    const agencyRawData = currentFilteredRawData.filter(item => item.agency === agencyName);
    const agencySummaryData = buildContractSummary(agencyRawData, false);

    renderPurchaseDetail(agencySummaryData);
    renderContractDetail(agencyRawData);
    renderTrendDetail(agencyName);

    const sections = {
        trend: { btn: 'toggleTrendBtn', content: 'trendDetail' },
        contract: { btn: 'toggleContractBtn', content: 'contractDetail' }
    };

    Object.entries(sections).forEach(([key, { btn, content }]) => {
        document.getElementById(btn)?.addEventListener('click', (e) => {
            const contentEl = document.getElementById(content);
            const iconEl = e.currentTarget.querySelector('.toggle-icon');
            contentEl?.classList.toggle('hidden');
            const isHidden = contentEl?.classList.contains('hidden');
            if (iconEl) iconEl.textContent = isHidden ? '▼' : '▲';
            detailSectionsExpanded[key] = !isHidden;
            // 전체 버튼 텍스트도 동기화
            const allBtn = document.getElementById('toggleAllBtn');
            if (allBtn) {
                allBtn.textContent = (detailSectionsExpanded.trend && detailSectionsExpanded.contract)
                    ? '전체 접기' : '전체 펼치기';
            }
        });
    });

    const toggleAllBtn = document.getElementById('toggleAllBtn');
    toggleAllBtn?.addEventListener('click', () => {
        const isExpanding = toggleAllBtn.textContent === '전체 펼치기';

        Object.entries(sections).forEach(([key, { btn, content }]) => {
            document.getElementById(content)?.classList.toggle('hidden', !isExpanding);
            const icon = document.getElementById(btn)?.querySelector('.toggle-icon');
            if (icon) icon.textContent = isExpanding ? '▲' : '▼';
            detailSectionsExpanded[key] = isExpanding;
        });

        toggleAllBtn.textContent = isExpanding ? '전체 접기' : '전체 펼치기';
    });

    document.getElementById('backToListBtn')?.addEventListener('click', () => {
        currentAgencyInDetailView = null;
        detailPanel.classList.add('hidden');
        document.getElementById('agencyRankPanel')?.classList.remove('hidden');
    });

    document.getElementById('printDetailBtn')?.addEventListener('click', () => {
        printPanel(document.getElementById('comprehensiveReport'));
    });

    document.getElementById('agencyRankPanel')?.classList.add('hidden');
    detailPanel.classList.remove('hidden');
}

function renderPurchaseDetail(agencySummaryData) {
    const container = document.getElementById('purchaseDetail');
    if (!container) return;

    const productFilter = document.getElementById('productFilter');
    const selectedProductText = productFilter?.value === 'all'
        ? '전체 품목'
        : productFilter.options[productFilter.selectedIndex].text;

    container.innerHTML = `
        <h4 class="text-md font-semibold mb-2">${selectedProductText} 구매 내역 요약</h4>
        <table id="purchaseDetailTable" class="min-w-full divide-y divide-gray-200 data-table">
            <thead class="bg-gray-50">
                <tr>
                    <th class="w-1/12 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="rank" data-sort-type="number"><span>순위</span></th>
                    <th class="w-5/12 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="supplier" data-sort-type="string"><span>업체명</span></th>
                    <th class="w-2/12 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractCount" data-sort-type="number"><span>거래건수</span></th>
                    <th class="w-2/12 px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="share" data-sort-type="number"><span>점유율</span></th>
                    <th class="w-2/12 px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>구매금액</span></th>
                </tr>
            </thead>
            <tbody id="purchaseDetailBody"></tbody>
        </table>
    `;

    const supplierMap = new Map();

    agencySummaryData.forEach(item => {
        if (!supplierMap.has(item.supplier)) {
            supplierMap.set(item.supplier, { amount: 0, contracts: new Set() });
        }

        const info = supplierMap.get(item.supplier);
        info.amount += item.amount;
        info.contracts.add(`${item.contractName}||${item.product}`);
    });

    const agencyTotalAmount = agencySummaryData.reduce((sum, item) => sum + item.amount, 0);

    let data = [...supplierMap.entries()].map(([supplier, { amount, contracts }]) => ({
        supplier,
        amount,
        contractCount: contracts.size,
        share: agencyTotalAmount > 0 ? (amount / agencyTotalAmount) * 100 : 0
    }));

    sortData(data, sortStates.purchase);
    data.forEach((item, index) => item.rank = index + 1);

    const tbody = document.getElementById('purchaseDetailBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">표시할 데이터가 없습니다.</td></tr>`;
    } else {
        data.forEach(item => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td class="px-4 py-3 text-center">${item.rank}</td>
                <td class="px-4 py-3">${item.supplier}</td>
                <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.contractCount)}</td>
                <td class="px-4 py-3 text-right font-medium">${item.share.toFixed(1)}%</td>
                <td class="px-4 py-3 text-right font-medium whitespace-nowrap">${CommonUtils.formatCurrency(item.amount)}</td>
            `;
        });
    }

    updateSortIndicators('purchaseDetailTable', sortStates.purchase);

    document.getElementById('purchaseDetailTable')?.querySelector('thead')?.addEventListener('click', e => {
        const th = e.target.closest('th');
        if (!th || !th.dataset.sortKey) return;

        handleTableSort('purchase', th.dataset.sortKey, th.dataset.sortType);
        renderPurchaseDetail(agencySummaryData);
    });
}

function renderContractDetail(agencyRawData) {
    const container = document.getElementById('contractDetail');
    if (!container) return;

    // 상세는 상쇄건도 보이게 includeZero=true
    let data = buildContractSummary(agencyRawData, true);

    container.innerHTML = `
        <h4 class="text-md font-semibold mb-2">계약별 상세 내역</h4>
        <table id="contractDetailTable" class="min-w-full divide-y divide-gray-200 data-table">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="rank" data-sort-type="number"><span>순번</span></th>
                    <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractDate" data-sort-type="string"><span>최종일자</span></th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractName" data-sort-type="string"><span>계약명</span></th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="supplier" data-sort-type="string"><span>업체명</span></th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>최종금액</span></th>
                </tr>
            </thead>
            <tbody id="contractDetailBody"></tbody>
        </table>
    `;

    sortData(data, sortStates.contract);
    data.forEach((item, index) => item.rank = index + 1);

    const tbody = document.getElementById('contractDetailBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">표시할 데이터가 없습니다.</td></tr>`;
    } else {
        data.forEach((item, idx) => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td class="px-4 py-3 text-center">${item.rank}</td>
                <td class="px-4 py-3 text-center">${item.contractDate}</td>
                <td class="px-4 py-3"><a href="#" class="text-blue-600 hover:underline contract-name-link" data-idx="${idx}">${item.contractName}</a></td>
                <td class="px-4 py-3">${item.supplier}</td>
                <td class="px-4 py-3 text-right font-medium whitespace-nowrap">${CommonUtils.formatCurrency(item.amount)}</td>
            `;
        });

        tbody.querySelectorAll('.contract-name-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const idx = Number(link.dataset.idx);
                showContractItemsPopup(data[idx]);
            });
        });
    }

    updateSortIndicators('contractDetailTable', sortStates.contract);

    document.getElementById('contractDetailTable')?.querySelector('thead')?.addEventListener('click', e => {
        const th = e.target.closest('th');
        if (!th || !th.dataset.sortKey) return;

        handleTableSort('contract', th.dataset.sortKey, th.dataset.sortType);
        renderContractDetail(agencyRawData);
    });
}

// 물품식별명 파싱: "세부품명, 업체단축명, 모델, 규격..." 구조 가정.
// parts[0]==세부품명은 전수 검증 완료(54,581건 mismatch 0). 1/3-part는 통짜 또는 모델만.
function parseProductIdentName(fullName) {
    const raw = String(fullName || '').trim();
    if (!raw) return { model: '-', spec: '-', raw: '' };
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const n = parts.length;
    if (n >= 4) return { model: parts[2], spec: parts.slice(3).join(', '), raw };
    if (n === 3) return { model: parts[2], spec: '-', raw };
    if (n === 2) return { model: '-', spec: parts[1], raw };
    return { model: '-', spec: '-', raw }; // 통짜(수의계약 일부) — raw 표시 fallback
}

function showContractItemsPopup(summary) {
    if (!summary) return;
    const items = Array.isArray(summary.lineItems) ? summary.lineItems : [];

    let contentHtml = `<p class="text-sm text-gray-600 mb-3">
        <span class="font-medium">${summary.agency}</span> · ${summary.supplier} ·
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
            const { model, spec, raw } = parseProductIdentName(line.fullProductName);
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

function renderTrendDetail(agencyName) {
    const container = document.getElementById('trendDetail');
    if (!container) return;

    container.innerHTML = `
        <h4 class="text-md font-semibold mb-2">연도별 구매 추이</h4>
        <div class="flex flex-col md:flex-row gap-6">
            <div class="md:w-1/2 p-4" style="min-height:320px;">
                <canvas id="trendChart"></canvas>
            </div>
            <div class="md:w-1/2 p-4">
                <h5 class="text-sm font-semibold mb-2">주요 지표 요약</h5>
                <table id="trendSummaryTable" class="min-w-full text-sm">
                    <tbody></tbody>
                </table>
            </div>
        </div>
    `;

    const currentSystemYear = new Date().getFullYear();
    const chartYears = Array.from({ length: 5 }, (_, i) => currentSystemYear - i).sort();

    const product = document.getElementById('productFilter')?.value || 'all';

    const yearlyRaw = allData.filter(d => {
        if (d.agency !== agencyName) return false;
        if (!d.date) return false;

        const year = parseInt(String(d.date).slice(0, 4), 10);
        if (!chartYears.includes(year)) return false;

        return product === 'all' || d.product === product;
    });

    const yearlySummary = buildContractSummary(yearlyRaw, false);

    const salesByYear = {};
    const countByYear = {};
    chartYears.forEach(year => {
        salesByYear[year] = 0;
        countByYear[year] = 0;
    });

    yearlySummary.forEach(d => {
        const year = parseInt(String(d.contractDate).slice(0, 4), 10);
        if (salesByYear.hasOwnProperty(year)) {
            salesByYear[year] += d.amount;
            countByYear[year] += 1;
        }
    });

    if (chartInstance) chartInstance.destroy();

    const canvas = document.getElementById('trendChart');
    if (!canvas) return;

    // 현재 상단 드롭다운에 선택된 연도 = 강조할 막대.
    // '전체' 또는 5년 차트 범위 밖이면 전 막대 기본 색.
    const selectedYearRaw = document.getElementById('analysisYear')?.value || 'all';
    const selectedYearNum = selectedYearRaw === 'all' ? null : parseInt(selectedYearRaw, 10);
    const isHighlightMode = selectedYearNum !== null && chartYears.includes(selectedYearNum);

    const barBgColors = chartYears.map(year => {
        if (!isHighlightMode) return 'rgba(16, 185, 129, 0.6)';
        return year === selectedYearNum ? 'rgba(16, 185, 129, 0.95)' : 'rgba(16, 185, 129, 0.25)';
    });
    const barBorderColors = chartYears.map(year => {
        if (!isHighlightMode) return 'rgba(16, 185, 129, 1)';
        return year === selectedYearNum ? 'rgba(5, 150, 105, 1)' : 'rgba(16, 185, 129, 0.5)';
    });

    const ctx = canvas.getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartYears.map(String),
            datasets: [{
                label: '연간 구매액',
                data: chartYears.map(year => salesByYear[year]),
                backgroundColor: barBgColors,
                borderColor: barBorderColors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // 막대 클릭 = 상단 드롭다운 값 변경 + 상세 화면 유지하며 재집계
            onClick: (evt, elements) => {
                if (!elements || elements.length === 0) return;
                const idx = elements[0].index;
                const clickedYear = chartYears[idx];
                if (clickedYear == null) return;
                const yearFilter = document.getElementById('analysisYear');
                if (!yearFilter) return;
                // 같은 연도 다시 클릭하면 '전체'로 토글, 아니면 그 해로 변경
                yearFilter.value = (selectedYearNum === clickedYear) ? 'all' : String(clickedYear);
                runAnalysis(false);
            },
            onHover: (evt, elements) => {
                const target = evt?.native?.target;
                if (target && target.style) {
                    target.style.cursor = elements && elements.length > 0 ? 'pointer' : 'default';
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: value => CommonUtils.formatCurrency(value)
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const year = context.label;
                            const amount = context.parsed.y;
                            const count = countByYear[year] || 0;
                            return [`구매액: ${CommonUtils.formatCurrency(amount)}`, `유효계약수: ${count}건`];
                        },
                        afterLabel: function (context) {
                            const year = parseInt(context.label, 10);
                            return year === selectedYearNum ? '✓ 현재 선택' : '클릭하여 전환';
                        }
                    }
                }
            }
        }
    });

    const selectedYearValue = document.getElementById('analysisYear')?.value || 'all';
    const summaryYear = selectedYearValue === 'all' ? currentSystemYear : parseInt(selectedYearValue, 10);

    const yearAmounts = chartYears.map(year => salesByYear[year]);
    const actualTransactionYears = yearAmounts.filter(amount => amount > 0);
    const totalAmount = actualTransactionYears.reduce((sum, amount) => sum + amount, 0);
    const avgAmount = actualTransactionYears.length > 0 ? totalAmount / actualTransactionYears.length : 0;

    const peakAmount = Math.max(...yearAmounts, 0);
    const peakYear = peakAmount > 0 ? chartYears[yearAmounts.indexOf(peakAmount)] : '-';

    const summaryYearAmount = salesByYear[summaryYear] || 0;
    const vsAvgRatio = avgAmount > 0 ? ((summaryYearAmount / avgAmount) - 1) * 100 : 0;
    const diffText = vsAvgRatio === 0
        ? '-'
        : (vsAvgRatio > 0 ? `▲ ${vsAvgRatio.toFixed(1)}%` : `▼ ${Math.abs(vsAvgRatio).toFixed(1)}%`);
    const diffColor = vsAvgRatio > 0 ? 'text-red-500' : 'text-blue-500';

    const summaryBody = document.getElementById('trendSummaryTable')?.querySelector('tbody');
    if (!summaryBody) return;

    summaryBody.innerHTML = `
        <tr class="border-b"><td class="py-2 font-semibold">5년 평균 구매액</td><td class="py-2 text-right">${CommonUtils.formatCurrency(avgAmount)}</td></tr>
        <tr class="border-b"><td class="py-2 font-semibold">최고 구매 연도</td><td class="py-2 text-right">${peakYear}</td></tr>
        <tr class="border-b"><td class="py-2 font-semibold">최고 구매액</td><td class="py-2 text-right">${CommonUtils.formatCurrency(peakAmount)}</td></tr>
        <tr class="border-b"><td class="py-2 font-semibold">${summaryYear}년 구매액</td><td class="py-2 text-right">${CommonUtils.formatCurrency(summaryYearAmount)}</td></tr>
        <tr><td class="py-2 font-semibold">평균 대비 증감</td><td class="py-2 text-right font-bold ${diffColor}">${diffText}</td></tr>
    `;
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

function showLoadingState(isLoading, text = '분석 중') {
    const button = document.getElementById('analyzeBtn');
    if (!button) return;

    button.disabled = isLoading;

    const svgIcon = `
        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z">
            </path>
        </svg>`;

    button.innerHTML = isLoading
        ? `<div class="loading-spinner mr-2"></div> ${text}...`
        : `${svgIcon}분석`;
}

function printPanel(panel) {
    if (!panel) {
        CommonUtils.showAlert('인쇄할 내용이 없습니다.', 'warning');
        return;
    }

    const style = document.createElement('style');
    style.id = 'print-style';
    style.innerHTML = `
        @media print {
            .report-section {
                margin-top: 3rem !important;
                page-break-inside: avoid !important;
            }
            .no-print {
                display: none !important;
            }
            #trendDetail .flex {
                display: flex !important;
                flex-direction: row !important;
                width: 100%;
            }
            #trendDetail .flex > div {
                padding: 0 !important;
            }
            #trendDetail .flex > div:first-child {
                width: 60% !important;
            }
            #trendDetail .flex > div:last-child {
                width: 40% !important;
                padding-left: 1rem !important;
            }
        }
    `;
    document.head.appendChild(style);

    panel.classList.add('printing-now');
    window.print();

    setTimeout(() => {
        panel.classList.remove('printing-now');
        document.getElementById('print-style')?.remove();
    }, 500);
}
