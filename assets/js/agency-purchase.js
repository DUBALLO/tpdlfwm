// agency-purchase.js

// 전역 변수
let allData = [];
let currentFilteredData = [];
let chartInstance = null;
let currentAgencyInDetailView = null;

let sortStates = {
    rank: { key: 'amount', direction: 'desc', type: 'number' },
    purchase: { key: 'amount', direction: 'desc', type: 'number' },
    contract: { key: 'date', direction: 'desc', type: 'string' }
};

document.addEventListener('DOMContentLoaded', async () => {
    showLoadingState(true, '데이터 로딩 중...');
    try {
        allData = await loadAndParseData();
        populateFilters(allData);
        setupEventListeners();
        await runAnalysis(true);
    } catch (error) {
        console.error("초기화 실패:", error);
        CommonUtils.showAlert("페이지 초기화 중 오류가 발생했습니다.", 'error');
    } finally {
        showLoadingState(false);
    }
});

function setupEventListeners() {
    document.getElementById('analyzeBtn').addEventListener('click', () => runAnalysis());
    document.getElementById('analysisYear').addEventListener('change', () => runAnalysis());
    document.getElementById('productFilter').addEventListener('change', () => runAnalysis());
    document.getElementById('regionFilter').addEventListener('change', () => {
        populateCityFilter();
        runAnalysis(true);
    });
    document.getElementById('cityFilter').addEventListener('change', () => runAnalysis(true));
    document.getElementById('agencyTypeFilter').addEventListener('change', () => runAnalysis(true));
    
    // ▼▼▼ [추가] 검색창 Enter 키 이벤트 리스너 ▼▼▼
    document.getElementById('agencySearchFilter').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            runAnalysis();
        }
    });
    // ▲▲▲ [추가] ▲▲▲
}

async function runAnalysis(forceList = false) {
    showLoadingState(true, '데이터 분석 중...');
    
    if (forceList) {
        currentAgencyInDetailView = null;
    }

    const year = document.getElementById('analysisYear').value;
    const product = document.getElementById('productFilter').value;
    const region = document.getElementById('regionFilter').value;
    const city = document.getElementById('cityFilter').value;
    const agencyType = document.getElementById('agencyTypeFilter').value;
    
    // ▼▼▼ [추가] 검색어 값 가져오기 ▼▼▼
    const agencySearch = document.getElementById('agencySearchFilter').value.trim().toLowerCase();
    // ▲▲▲ [추가] ▲▲▲

    currentFilteredData = allData.filter(item => 
        (year === 'all' || (item.date && item.date.startsWith(year))) &&
        (product === 'all' || item.product === product) &&
        (region === 'all' || item.region === region) &&
        (city === 'all' || item.city === city) &&
        (agencyType === 'all' || item.agencyType === agencyType) &&
        // ▼▼▼ [추가] 수요기관명 검색 조건 ▼▼▼
        (agencySearch === '' || item.agency.toLowerCase().includes(agencySearch))
        // ▲▲▲ [추가] ▲▲▲
    );

    if (currentAgencyInDetailView) {
        showAgencyDetail(currentAgencyInDetailView);
    } else {
        document.getElementById('agencyDetailPanel').classList.add('hidden');
        document.getElementById('agencyRankPanel').classList.remove('hidden');
        renderAgencyRankPanel(currentFilteredData);
    }
    
    showLoadingState(false);
}

async function loadAndParseData() {
    if (!window.sheetsAPI) throw new Error('sheets-api.js가 로드되지 않았습니다.');
    // ▼▼▼ [수정] 이 부분을 새로운 통합 함수로 변경합니다. ▼▼▼
    const rawData = await window.sheetsAPI.loadAllProcurementData();
    return rawData.map(item => {
        const fullRegion = (item['수요기관지역'] || '').trim();
        const regionParts = fullRegion.split(' ');
        return {
            agency: (item['수요기관명'] || '').trim(),
            supplier: (item['업체'] || '').trim(),
            region: regionParts[0] || '',
            city: regionParts[1] || '',
            agencyType: item['소관구분'] || '기타',
            product: (item['세부품명'] || '').trim(),
            amount: parseInt(String(item['공급금액']).replace(/[^\d]/g, '') || '0', 10),
            date: item['기준일자'] || '',
            contractName: (item['계약명'] || '').trim()
        };
    }).filter(item => item.agency && item.supplier && item.amount > 0);
}

function populateFilters(data) {
    const regions = [...new Set(data.map(item => item.region).filter(Boolean))].sort();
    const agencyTypes = [...new Set(data.map(item => item.agencyType).filter(Boolean))].sort();
    const regionFilter = document.getElementById('regionFilter');
    const agencyTypeFilter = document.getElementById('agencyTypeFilter');

    regions.forEach(region => regionFilter.add(new Option(region, region)));
    agencyTypes.forEach(type => agencyTypeFilter.add(new Option(type, type)));
    
    if (regionFilter.querySelector('option[value="경기도"]')) {
        regionFilter.value = '경기도';
    }
    populateCityFilter();
}

function populateCityFilter() {
    const selectedRegion = document.getElementById('regionFilter').value;
    const cityFilter = document.getElementById('cityFilter');
    cityFilter.innerHTML = '<option value="all">전체</option>';

    if (selectedRegion !== 'all') {
        const cities = [...new Set(allData
            .filter(item => item.region === selectedRegion && item.city)
            .map(item => item.city))]
            .sort();
        cities.forEach(city => cityFilter.add(new Option(city, city)));
    }
}

function renderAgencyRankPanel(data) {
    const panel = document.getElementById('agencyRankPanel');
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
                    <thead class="bg-gray-50"><tr>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="rank" data-sort-type="number"><span>순위</span></th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="agency" data-sort-type="string"><span>수요기관명</span></th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="fullRegion" data-sort-type="string"><span>지역</span></th>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractCount" data-sort-type="number"><span>거래건수</span></th>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="supplierCount" data-sort-type="number"><span>거래처 수</span></th>
                        <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>총 구매액</span></th>
                        <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="vsAvg" data-sort-type="number"><span>평균 대비</span></th>
                    </tr></thead>
                    <tbody id="agencyRankBody"></tbody>
                </table>
            </div>
        </div>`;

    const agencyMap = new Map();
    data.forEach(item => {
        if (!agencyMap.has(item.agency)) {
            agencyMap.set(item.agency, { amount: 0, contracts: new Set(), suppliers: new Set(), region: item.region, city: item.city });
        }
        const agencyInfo = agencyMap.get(item.agency);
        agencyInfo.amount += item.amount;
        agencyInfo.contracts.add(item.contractName);
        agencyInfo.suppliers.add(item.supplier);
    });

    let rankedAgencies = [...agencyMap.entries()].map(([agency, { amount, contracts, suppliers, region, city }]) => {
        const fullRegion = city ? `${region} ${city}` : region;
        return {
            agency, amount,
            contractCount: contracts.size,
            supplierCount: suppliers.size,
            fullRegion
        };
    });
    
    const selectedYearValue = document.getElementById('analysisYear').value;
    const selectedYear = selectedYearValue === 'all' ? new Date().getFullYear() : parseInt(selectedYearValue);

    rankedAgencies.forEach(agency => {
        const lastFiveYears = Array.from({length: 5}, (_, i) => selectedYear - i).sort();
        const agencyAllData = allData.filter(d => d.agency === agency.agency && d.date && lastFiveYears.includes(new Date(d.date).getFullYear()));
        
        const salesByYear = {};
        lastFiveYears.forEach(year => salesByYear[year] = 0);
        agencyAllData.forEach(d => {
            const year = new Date(d.date).getFullYear();
            if (salesByYear.hasOwnProperty(year)) salesByYear[year] += d.amount;
        });

        const actualTransactionYears = Object.values(salesByYear).filter(amount => amount > 0);
        const totalAmount = actualTransactionYears.reduce((sum, amount) => sum + amount, 0);
        const avgAmount = actualTransactionYears.length > 0 ? totalAmount / actualTransactionYears.length : 0;
        const selectedYearAmount = salesByYear[selectedYear] || 0;
        
        agency.vsAvg = avgAmount > 0 ? ((selectedYearAmount / avgAmount) - 1) * 100 : 0;
    });

    sortData(rankedAgencies, sortStates.rank);
    rankedAgencies.forEach((item, index) => item.rank = index + 1);

    const tbody = document.getElementById('agencyRankBody');
    tbody.innerHTML = '';
    if (rankedAgencies.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-3 text-center py-8 text-gray-500">표시할 데이터가 없습니다.</td></tr>`;
    } else {
        rankedAgencies.forEach(item => {
            const row = tbody.insertRow();
            const diffText = item.vsAvg === 0 ? '-' : (item.vsAvg > 0 ? `▲ ${item.vsAvg.toFixed(1)}%` : `▼ ${Math.abs(item.vsAvg).toFixed(1)}%`);
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
            row.querySelector('a').addEventListener('click', (e) => {
                e.preventDefault();
                showAgencyDetail(e.target.dataset.agency);
            });
        });
    }
    updateSortIndicators('agencyRankTable', sortStates.rank);
    document.getElementById('agencyRankTable').querySelector('thead').addEventListener('click', e => {
        const th = e.target.closest('th');
        if (!th || !th.dataset.sortKey) return;
        
        handleTableSort('rank', th.dataset.sortKey, th.dataset.sortType);
        renderAgencyRankPanel(currentFilteredData);
    });
    document.getElementById('printRankBtn').addEventListener('click', () => printPanel(panel));
    document.getElementById('exportRankBtn').addEventListener('click', () => CommonUtils.exportTableToCSV(document.getElementById('agencyRankTable'), '수요기관_구매순위.csv'));
}

function showAgencyDetail(agencyName) {
    currentAgencyInDetailView = agencyName;
    const detailPanel = document.getElementById('agencyDetailPanel');
    const yearFilter = document.getElementById('analysisYear');
    const selectedYearText = yearFilter.value === 'all' ? '전체 기간' : yearFilter.options[yearFilter.selectedIndex].text;
    
    detailPanel.innerHTML = `
        <div id="comprehensiveReport" class="p-6 printable-area">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-gray-900">${agencyName} 분석 보고서 (${selectedYearText})</h3>
                <div class="flex items-center space-x-2 no-print">
                    <button id="toggleAllBtn" class="btn btn-secondary btn-sm">전체 펼치기</button>
                    <button id="printDetailBtn" class="btn btn-secondary btn-sm">보고서 인쇄</button>
                    <button id="backToListBtn" class="btn btn-secondary btn-sm">목록으로</button>
                </div>
            </div>
            <div id="purchaseDetail" class="report-section"></div>
            <div class="mt-12 no-print">
                <button id="toggleTrendBtn" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 rounded-md flex justify-between items-center">
                    <span class="font-semibold">연도별 추이</span>
                    <span class="toggle-icon">▼</span>
                </button>
            </div>
            <div id="trendDetail" class="mt-4 hidden report-section"></div>
            <div class="mt-4 no-print">
                <button id="toggleContractBtn" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 rounded-md flex justify-between items-center">
                    <span class="font-semibold">계약 상세</span>
                    <span class="toggle-icon">▼</span>
                </button>
            </div>
            <div id="contractDetail" class="mt-4 hidden report-section"></div>
        </div>`;
    
    const agencyData = currentFilteredData.filter(item => item.agency === agencyName);
    
    renderPurchaseDetail(agencyData);
    renderContractDetail(agencyData);
    renderTrendDetail(agencyName);

    const sections = {
        trend: { btn: 'toggleTrendBtn', content: 'trendDetail' },
        contract: { btn: 'toggleContractBtn', content: 'contractDetail' }
    };

    Object.values(sections).forEach(({ btn, content }) => {
        document.getElementById(btn).addEventListener('click', (e) => {
            const contentEl = document.getElementById(content);
            const iconEl = e.currentTarget.querySelector('.toggle-icon');
            contentEl.classList.toggle('hidden');
            iconEl.textContent = contentEl.classList.contains('hidden') ? '▼' : '▲';
        });
    });

    const toggleAllBtn = document.getElementById('toggleAllBtn');
    toggleAllBtn.addEventListener('click', () => {
        const isExpanding = toggleAllBtn.textContent === '전체 펼치기';
        Object.values(sections).forEach(({ btn, content }) => {
            document.getElementById(content).classList.toggle('hidden', !isExpanding);
            document.getElementById(btn).querySelector('.toggle-icon').textContent = isExpanding ? '▲' : '▼';
        });
        toggleAllBtn.textContent = isExpanding ? '전체 접기' : '전체 펼치기';
    });

    document.getElementById('backToListBtn').addEventListener('click', () => {
        currentAgencyInDetailView = null;
        detailPanel.classList.add('hidden');
        document.getElementById('agencyRankPanel').classList.remove('hidden');
    });

    document.getElementById('printDetailBtn').addEventListener('click', () => printPanel(document.getElementById('comprehensiveReport')));
    
    document.getElementById('agencyRankPanel').classList.add('hidden');
    detailPanel.classList.remove('hidden');
}

function renderPurchaseDetail(agencyData) {
    const container = document.getElementById('purchaseDetail');
    const productFilter = document.getElementById('productFilter');
    const selectedProductText = productFilter.value === 'all' ? '전체 품목' : productFilter.options[productFilter.selectedIndex].text;

    container.innerHTML = `
        <h4 class="text-md font-semibold mb-2">${selectedProductText} 구매 내역 요약</h4>
        <table id="purchaseDetailTable" class="min-w-full divide-y divide-gray-200 data-table">
            <thead class="bg-gray-50"><tr>
                <th class="w-1/12 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="rank" data-sort-type="number"><span>순위</span></th>
                <th class="w-5/12 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="supplier" data-sort-type="string"><span>업체명</span></th>
                <th class="w-2/12 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractCount" data-sort-type="number"><span>거래건수</span></th>
                <th class="w-2/12 px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="share" data-sort-type="number"><span>점유율</span></th>
                <th class="w-2/12 px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>구매금액</span></th>
            </tr></thead>
            <tbody id="purchaseDetailBody"></tbody>
        </table>`;
    
    const supplierMap = new Map();
    agencyData.forEach(item => {
        if (!supplierMap.has(item.supplier)) supplierMap.set(item.supplier, { amount: 0, contracts: new Set() });
        const info = supplierMap.get(item.supplier);
        info.amount += item.amount;
        info.contracts.add(item.contractName);
    });

    const agencyTotalAmount = agencyData.reduce((sum, item) => sum + item.amount, 0);
    let data = [...supplierMap.entries()].map(([supplier, { amount, contracts }]) => ({ 
        supplier, amount, contractCount: contracts.size,
        share: agencyTotalAmount > 0 ? (amount / agencyTotalAmount) * 100 : 0
    }));

    sortData(data, sortStates.purchase);
    data.forEach((item, index) => item.rank = index + 1);
    
    const tbody = document.getElementById('purchaseDetailBody');
    tbody.innerHTML = '';
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

    updateSortIndicators('purchaseDetailTable', sortStates.purchase);
    document.getElementById('purchaseDetailTable').querySelector('thead').addEventListener('click', e => {
        const th = e.target.closest('th');
        if (th && th.dataset.sortKey) {
            handleTableSort('purchase', th.dataset.sortKey, th.dataset.sortType);
            renderPurchaseDetail(agencyData);
        }
    });
}

function renderContractDetail(agencyData) {
    const container = document.getElementById('contractDetail');
    container.innerHTML = `
        <h4 class="text-md font-semibold mb-2">계약별 상세 내역</h4>
        <table id="contractDetailTable" class="min-w-full divide-y divide-gray-200 data-table">
            <thead class="bg-gray-50"><tr>
                <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="rank" data-sort-type="number"><span>순번</span></th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="date" data-sort-type="string"><span>거래일자</span></th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractName" data-sort-type="string"><span>계약명</span></th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="supplier" data-sort-type="string"><span>업체명</span></th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>공급금액</span></th>
            </tr></thead>
            <tbody id="contractDetailBody"></tbody>
        </table>`;
    
    let data = [...agencyData];
    sortData(data, sortStates.contract);
    data.forEach((item, index) => item.rank = index + 1);
    
    const tbody = document.getElementById('contractDetailBody');
    tbody.innerHTML = '';
    data.forEach(item => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td class="px-4 py-3 text-center">${item.rank}</td>
            <td class="px-4 py-3 text-center">${item.date}</td>
            <td class="px-4 py-3">${item.contractName}</td>
            <td class="px-4 py-3">${item.supplier}</td>
            <td class="px-4 py-3 text-right font-medium whitespace-nowrap">${CommonUtils.formatCurrency(item.amount)}</td>
        `;
    });

    updateSortIndicators('contractDetailTable', sortStates.contract);
    document.getElementById('contractDetailTable').querySelector('thead').addEventListener('click', e => {
        const th = e.target.closest('th');
        if (th && th.dataset.sortKey) {
            handleTableSort('contract', th.dataset.sortKey, th.dataset.sortType);
            renderContractDetail(agencyData);
        }
    });
}

// ▼▼▼ [수정됨] renderTrendDetail 함수 전체 변경 ▼▼▼
function renderTrendDetail(agencyName) {
    const container = document.getElementById('trendDetail');
    // [수정] 인쇄 레이아웃을 위해 flex 구조 및 그래프/지표 너비 조정
    container.innerHTML = `
        <h4 class="text-md font-semibold mb-2">연도별 구매 추이</h4>
        <div class="flex flex-col md:flex-row gap-6">
            <div class="md:w-1/2 p-4">
                <canvas id="trendChart"></canvas>
            </div>
            <div class="md:w-1/2 p-4">
                 <h5 class="text-sm font-semibold mb-2">주요 지표 요약</h5>
                <table id="trendSummaryTable" class="min-w-full text-sm"><tbody></tbody></table>
            </div>
        </div>`;

    // [수정] 그래프는 항상 현재 연도 기준, 요약 지표는 드롭다운 기준
    const currentSystemYear = new Date().getFullYear();
    const chartYears = Array.from({length: 5}, (_, i) => currentSystemYear - i).sort();

    const selectedYearValue = document.getElementById('analysisYear').value;
    const summaryYear = selectedYearValue === 'all' ? currentSystemYear : parseInt(selectedYearValue);
    
    const yearlyData = allData.filter(d => d.agency === agencyName && d.date && chartYears.includes(new Date(d.date).getFullYear()));
    
    const salesByYear = {};
    chartYears.forEach(year => {
        salesByYear[year] = { amount: 0, contracts: new Set() };
    });
    yearlyData.forEach(d => {
        const year = new Date(d.date).getFullYear();
        if (salesByYear.hasOwnProperty(year)) {
            salesByYear[year].amount += d.amount;
            salesByYear[year].contracts.add(d.contractName);
        }
    });

    if(chartInstance) chartInstance.destroy();
    const ctx = document.getElementById('trendChart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartYears.map(String),
            datasets: [{
                label: '연간 구매액',
                data: chartYears.map(year => salesByYear[year].amount),
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { callback: value => CommonUtils.formatCurrency(value) } } },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const year = context.label;
                            const amount = context.parsed.y;
                            const count = salesByYear[year].contracts.size;
                            return [ `구매액: ${CommonUtils.formatCurrency(amount)}`, `구매건수: ${count}건` ];
                        }
                    }
                }
            }
        }
    });

    const yearAmounts = chartYears.map(year => salesByYear[year].amount);
    const actualTransactionYears = yearAmounts.filter(amount => amount > 0);
    const totalAmount = actualTransactionYears.reduce((sum, amount) => sum + amount, 0);
    const avgAmount = actualTransactionYears.length > 0 ? totalAmount / actualTransactionYears.length : 0;
    
    let peakAmount = Math.max(...yearAmounts);
    let peakYear = peakAmount > 0 ? chartYears[yearAmounts.indexOf(peakAmount)] : '-';
    
    const summaryYearAmount = salesByYear[summaryYear] ? salesByYear[summaryYear].amount : 0;
    const vsAvgRatio = avgAmount > 0 ? ((summaryYearAmount / avgAmount) - 1) * 100 : 0;
    const diffText = vsAvgRatio === 0 ? '-' : (vsAvgRatio > 0 ? `▲ ${vsAvgRatio.toFixed(1)}%` : `▼ ${Math.abs(vsAvgRatio).toFixed(1)}%`);
    const diffColor = vsAvgRatio > 0 ? 'text-red-500' : 'text-blue-500';

    const summaryBody = document.getElementById('trendSummaryTable').querySelector('tbody');
    summaryBody.innerHTML = `
        <tr class="border-b"><td class="py-2 font-semibold">5년 평균 구매액</td><td class="py-2 text-right">${CommonUtils.formatCurrency(avgAmount)}</td></tr>
        <tr class="border-b"><td class="py-2 font-semibold">최고 구매 연도</td><td class="py-2 text-right">${peakYear}</td></tr>
        <tr class="border-b"><td class="py-2 font-semibold">최고 구매액</td><td class="py-2 text-right">${CommonUtils.formatCurrency(peakAmount)}</td></tr>
        <tr class="border-b"><td class="py-2 font-semibold">${summaryYear}년 구매액</td><td class="py-2 text-right">${CommonUtils.formatCurrency(summaryYearAmount)}</td></tr>
        <tr><td class="py-2 font-semibold">평균 대비 증감</td><td class="py-2 text-right font-bold ${diffColor}">${diffText}</td></tr>
    `;
}

// ... 이하 handleTableSort, sortData, updateSortIndicators, showLoadingState 함수는 이전과 동일 ...
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

function showLoadingState(isLoading, text = '분석 중...') {
    const button = document.getElementById('analyzeBtn');
    if (button) {
        button.disabled = isLoading;
        const svgIcon = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>';
        button.innerHTML = isLoading ? `<div class="loading-spinner mr-2"></div> ${text}...` : `${svgIcon}분석`;
    }
}


// ▼▼▼ [수정됨] printPanel 함수 전체를 아래 코드로 교체하세요. ▼▼▼
function printPanel(panel) {
    if (!panel) {
        CommonUtils.showAlert('인쇄할 내용이 없습니다.', 'warning');
        return;
    }

    // [수정] 인쇄 레이아웃을 위한 전용 스타일 대폭 강화
    const style = document.createElement('style');
    style.id = 'print-style';
    style.innerHTML = `
        @media print {
            /* 보고서 섹션 간의 간격 및 페이지 나누기 방지 */
            .report-section {
                margin-top: 3rem !important;
                page-break-inside: avoid !important;
            }
            .no-print {
                display: none !important;
            }
            /* [핵심 수정] 연도별 추이 섹션의 레이아웃을 강제 */
            #trendDetail .flex {
                display: flex !important;
                flex-direction: row !important;
                width: 100%;
            }
            #trendDetail .flex > div {
                padding: 0 !important; /* 내부 여백 제거 */
            }
            /* 그래프 60%, 지표 40%로 너비 재조정 */
            #trendDetail .flex > div:first-child {
                width: 60% !important;
            }
            #trendDetail .flex > div:last-child {
                width: 40% !important;
                padding-left: 1rem !important; /* 지표 왼쪽에만 약간의 여백 */
            }
        }
    `;
    document.head.appendChild(style);
    
    panel.classList.add('printing-now');
    window.print();
    
    // 인쇄 후 동적으로 추가한 스타일과 클래스 제거
    setTimeout(() => {
        panel.classList.remove('printing-now');
        const printStyle = document.getElementById('print-style');
        if (printStyle) {
            printStyle.remove();
        }
    }, 500);
}
