// market-analysis.js — 시장 분석 통합 (수요기관 분석 / 업체 판매순위 / 트렌드 분석)
// 트랙 F: 3개 B소스(조달청) 페이지를 단일 페이지 탭으로 병합.
// 설계: 각 탭 = 독립 IIFE(전역/함수명 충돌 0), DOM은 자기 탭 root로 스코프($id).
//       B소스(loadAllProcurementData)는 오케스트레이터가 1회 로드해 3탭 공유.
//       트렌드는 두발로 필터 제거 → 시장 전체 추이. cross-link 업체↔수요기관.
console.log('%c[market-analysis.js v=20260619a — 시장 분석 통합(수요기관/업체/트렌드), B소스 1회 로드]', 'color:#0ea5e9; font-weight:bold');

/* =========================================================================
 * IIFE 1 — 수요기관 분석 (원 agency-purchase.js)
 * ========================================================================= */
(function () {
    let root, hub;
    let allData = [];
    let currentFilteredRawData = [];
    let currentFilteredData = [];
    let chartInstance = null;
    let currentAgencyInDetailView = null;
    let detailSectionsExpanded = { trend: true, contract: true };
    let sortStates = {
        rank: { key: 'amount', direction: 'desc', type: 'number' },
        purchase: { key: 'amount', direction: 'desc', type: 'number' },
        contract: { key: 'contractDate', direction: 'desc', type: 'string' }
    };

    const $id = id => root.querySelector('#' + id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function init(rootEl, rawData, hubRef) {
        root = rootEl; hub = hubRef;
        showLoadingState(true, '데이터 분석 중');
        try {
            allData = parseData(rawData);
            populateFilters(allData);
            setupEventListeners();
            runAnalysis(true);
        } catch (error) {
            console.error('수요기관 분석 초기화 실패:', error);
            CommonUtils.showAlert(`수요기관 분석 오류: ${error.message}`, 'error');
        } finally {
            showLoadingState(false);
        }
    }

    function setupEventListeners() {
        $id('analyzeBtn')?.addEventListener('click', () => runAnalysis());
        $id('analysisYear')?.addEventListener('change', () => runAnalysis(false));
        $id('productFilter')?.addEventListener('change', () => runAnalysis(false));
        $id('agencyTypeFilter')?.addEventListener('change', () => runAnalysis(false));
        $id('regionFilter')?.addEventListener('change', () => {
            populateCityFilter();
            runAnalysis(false);
        });
        $id('cityFilter')?.addEventListener('change', () => runAnalysis(false));
        $id('agencySearchFilter')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runAnalysis();
        });
    }

    function runAnalysis(forceList = false) {
        showLoadingState(true, '데이터 분석 중');
        if (forceList) currentAgencyInDetailView = null;

        const year = $id('analysisYear')?.value || 'all';
        const product = $id('productFilter')?.value || 'all';
        const region = $id('regionFilter')?.value || 'all';
        const city = $id('cityFilter')?.value || 'all';
        const agencyType = $id('agencyTypeFilter')?.value || 'all';
        const agencySearch = ($id('agencySearchFilter')?.value || '').trim().toLowerCase();

        currentFilteredRawData = allData.filter(item =>
            (year === 'all' || (item.date && item.date.startsWith(year))) &&
            (product === 'all' || item.product === product) &&
            (region === 'all' || item.region === region) &&
            (city === 'all' || item.city === city) &&
            (agencyType === 'all' || item.agencyType === agencyType) &&
            (agencySearch === '' || item.agency.toLowerCase().includes(agencySearch))
        );

        currentFilteredData = buildContractSummary(currentFilteredRawData, false);

        if (currentAgencyInDetailView) {
            showAgencyDetail(currentAgencyInDetailView);
        } else {
            $id('agencyDetailPanel')?.classList.add('hidden');
            $id('agencyRankPanel')?.classList.remove('hidden');
            renderAgencyRankPanel(currentFilteredData);
        }
        showLoadingState(false);
    }

    function parseData(rawData) {
        const parseSignedAmount = CommonUtils.parseSignedAmount;

        const parseContractOrder = (item) => {
            const candidates = [item['계약차수'], item['계약변경차수'], item['계약납품통합변경차수'], item['cntrctDlvrReqChgOrd']];
            for (const value of candidates) {
                const num = parseInt(String(value ?? '').replace(/[^\d]/g, ''), 10);
                if (!Number.isNaN(num) && num > 0) return num;
            }
            return 1;
        };

        const splitRegion = (regionFull) => {
            const text = String(regionFull || '').trim();
            const parts = text.split(/\s+/).filter(Boolean);
            return { region: parts[0] || '', city: parts.slice(1).join(' ') };
        };

        return rawData
            .map(item => {
                const regionFull = (item['수요기관지역'] || '').trim();
                const { region, city } = splitRegion(regionFull);
                return {
                    agency: (item['수요기관명'] || '').trim(),
                    regionFull, region, city,
                    agencyType: (item['소관구분'] || '기타').trim(),
                    amount: parseSignedAmount(item['공급금액']),
                    date: (item['기준일자'] || '').trim(),
                    contractName: (item['계약명'] || '').trim(),
                    contractNo: (item['계약납품통합번호'] || '').trim(),
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
                item.agency && item.date && item.contractName && item.supplier &&
                item.rawAmount !== '' && !Number.isNaN(item.amount)
            );
    }

    function buildContractSummary(data, includeZeroAmount = false) {
        const contractMap = new Map();
        data.forEach(item => {
            const key = [item.agency, item.regionFull, item.agencyType, item.product, item.supplier, item.contractNo || item.contractName].join('||');
            if (!contractMap.has(key)) {
                contractMap.set(key, {
                    agency: item.agency, regionFull: item.regionFull, region: item.region, city: item.city,
                    agencyType: item.agencyType, product: item.product, supplier: item.supplier,
                    contractName: item.contractName, contractNo: item.contractNo || '',
                    amount: 0, contractDate: item.date, firstContractDate: item.date, latestContractDate: item.date,
                    lineCount: 0, contractOrder: item.contractOrder || 1, lineItems: []
                });
            }
            const summary = contractMap.get(key);
            summary.amount += Number(item.amount) || 0;
            summary.lineCount += 1;
            summary.lineItems.push({
                fullProductName: item.fullProductName || '', product: item.product || '',
                quantity: Number(item.quantity) || 0, unitPrice: Number(item.unitPrice) || 0,
                amount: Number(item.amount) || 0, contractMethod: item.contractMethod || '', date: item.date || ''
            });
            if ((item.contractOrder || 1) > summary.contractOrder) summary.contractOrder = item.contractOrder || 1;
            if (item.date < summary.firstContractDate) summary.firstContractDate = item.date;
            if (item.date > summary.latestContractDate) { summary.latestContractDate = item.date; summary.contractDate = item.date; }
        });
        let result = Array.from(contractMap.values());
        if (!includeZeroAmount) result = result.filter(item => item.amount !== 0);
        return result;
    }

    function getSelectedBaseYear() {
        const v = $id('analysisYear')?.value || 'all';
        return v === 'all' ? new Date().getFullYear() : parseInt(v, 10);
    }
    function getFiveYearWindow(baseYear) {
        return Array.from({ length: 5 }, (_, i) => baseYear - i).sort();
    }

    function populateFilters(data) {
        const regions = [...new Set(data.map(item => item.region).filter(Boolean))].sort();
        const agencyTypes = [...new Set(data.map(item => item.agencyType).filter(Boolean))].sort();
        const regionFilter = $id('regionFilter');
        const agencyTypeFilter = $id('agencyTypeFilter');
        if (!regionFilter || !agencyTypeFilter) return;
        regionFilter.innerHTML = '<option value="all">전체</option>';
        agencyTypeFilter.innerHTML = '<option value="all">전체</option>';
        regions.forEach(region => regionFilter.add(new Option(region, region)));
        agencyTypes.forEach(type => agencyTypeFilter.add(new Option(type, type)));
        if (regionFilter.querySelector('option[value="경기도"]')) regionFilter.value = '경기도';
        if (agencyTypeFilter.querySelector('option[value="지방정부"]')) agencyTypeFilter.value = '지방정부';
        populateCityFilter();
    }

    function populateCityFilter() {
        const selectedRegion = $id('regionFilter')?.value || 'all';
        const cityFilter = $id('cityFilter');
        if (!cityFilter) return;
        cityFilter.innerHTML = '<option value="all">전체</option>';
        if (selectedRegion !== 'all') {
            const cities = [...new Set(allData.filter(item => item.region === selectedRegion && item.city).map(item => item.city))].sort();
            cities.forEach(city => cityFilter.add(new Option(city, city)));
        }
    }

    function renderAgencyRankPanel(data) {
        const panel = $id('agencyRankPanel');
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
                agencyMap.set(item.agency, { amount: 0, contracts: new Set(), suppliers: new Set(), fullRegion: item.regionFull });
            }
            const info = agencyMap.get(item.agency);
            info.amount += item.amount;
            info.contracts.add(`${item.supplier}||${item.contractNo || item.contractName}||${item.product}`);
            info.suppliers.add(item.supplier);
        });

        let rankedAgencies = [...agencyMap.entries()]
            .map(([agency, { amount, contracts, suppliers, fullRegion }]) => ({
                agency, amount, contractCount: contracts.size, supplierCount: suppliers.size, fullRegion, vsAvg: 0
            }))
            .filter(item => item.amount !== 0);

        const selectedYear = getSelectedBaseYear();
        rankedAgencies.forEach(agencyItem => {
            const years = getFiveYearWindow(selectedYear);
            const baseData = allData.filter(d => {
                if (d.agency !== agencyItem.agency) return false;
                if (!d.date) return false;
                const year = parseInt(String(d.date).slice(0, 4), 10);
                if (!years.includes(year)) return false;
                const product = $id('productFilter')?.value || 'all';
                return product === 'all' || d.product === product;
            });
            const summarized = buildContractSummary(baseData, false);
            const salesByYear = {};
            years.forEach(year => salesByYear[year] = 0);
            summarized.forEach(d => {
                const year = parseInt(String(d.contractDate).slice(0, 4), 10);
                if (salesByYear.hasOwnProperty(year)) salesByYear[year] += d.amount;
            });
            const actualYears = Object.values(salesByYear).filter(amount => amount > 0);
            const avgAmount = actualYears.length > 0 ? actualYears.reduce((sum, amount) => sum + amount, 0) / actualYears.length : 0;
            const selectedYearAmount = salesByYear[selectedYear] || 0;
            agencyItem.vsAvg = avgAmount > 0 ? ((selectedYearAmount / avgAmount) - 1) * 100 : 0;
        });

        sortData(rankedAgencies, sortStates.rank);
        rankedAgencies.forEach((item, index) => item.rank = index + 1);

        const tbody = $id('agencyRankBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (rankedAgencies.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">표시할 데이터가 없습니다.</td></tr>`;
        } else {
            rankedAgencies.forEach(item => {
                const row = tbody.insertRow();
                const diffText = item.vsAvg === 0 ? '-' : (item.vsAvg > 0 ? `▲ ${item.vsAvg.toFixed(1)}%` : `▼ ${Math.abs(item.vsAvg).toFixed(1)}%`);
                const diffColor = item.vsAvg > 0 ? 'text-red-500' : 'text-blue-500';
                row.innerHTML = `
                    <td class="px-4 py-3 text-center">${item.rank}</td>
                    <td class="px-4 py-3"><a href="#" data-agency="${esc(item.agency)}" class="text-blue-600 hover:underline">${esc(item.agency)}</a></td>
                    <td class="px-4 py-3">${esc(item.fullRegion)}</td>
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
        $id('agencyRankTable')?.querySelector('thead')?.addEventListener('click', e => {
            const th = e.target.closest('th');
            if (!th || !th.dataset.sortKey) return;
            handleTableSort('rank', th.dataset.sortKey, th.dataset.sortType);
            renderAgencyRankPanel(currentFilteredData);
        });
        $id('printRankBtn')?.addEventListener('click', () => printPanel(panel));
        $id('exportRankBtn')?.addEventListener('click', () => {
            CommonUtils.exportTableToCSV($id('agencyRankTable'), '수요기관_구매순위.csv');
        });
    }

    function showAgencyDetail(agencyName) {
        currentAgencyInDetailView = agencyName;
        const detailPanel = $id('agencyDetailPanel');
        const yearFilter = $id('analysisYear');
        const selectedYearText = yearFilter?.value === 'all' ? '전체 기간' : yearFilter.options[yearFilter.selectedIndex].text;
        if (!detailPanel) return;

        detailPanel.innerHTML = `
            <div id="comprehensiveReport" class="p-6 printable-area">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-gray-900">${esc(agencyName)} 분석 보고서 (${selectedYearText})</h3>
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
            $id(btn)?.addEventListener('click', (e) => {
                const contentEl = $id(content);
                const iconEl = e.currentTarget.querySelector('.toggle-icon');
                contentEl?.classList.toggle('hidden');
                const isHidden = contentEl?.classList.contains('hidden');
                if (iconEl) iconEl.textContent = isHidden ? '▼' : '▲';
                detailSectionsExpanded[key] = !isHidden;
                const allBtn = $id('toggleAllBtn');
                if (allBtn) allBtn.textContent = (detailSectionsExpanded.trend && detailSectionsExpanded.contract) ? '전체 접기' : '전체 펼치기';
            });
        });

        const toggleAllBtn = $id('toggleAllBtn');
        toggleAllBtn?.addEventListener('click', () => {
            const isExpanding = toggleAllBtn.textContent === '전체 펼치기';
            Object.entries(sections).forEach(([key, { btn, content }]) => {
                $id(content)?.classList.toggle('hidden', !isExpanding);
                const icon = $id(btn)?.querySelector('.toggle-icon');
                if (icon) icon.textContent = isExpanding ? '▲' : '▼';
                detailSectionsExpanded[key] = isExpanding;
            });
            toggleAllBtn.textContent = isExpanding ? '전체 접기' : '전체 펼치기';
        });

        $id('backToListBtn')?.addEventListener('click', () => {
            currentAgencyInDetailView = null;
            detailPanel.classList.add('hidden');
            $id('agencyRankPanel')?.classList.remove('hidden');
        });
        $id('printDetailBtn')?.addEventListener('click', () => printPanel($id('comprehensiveReport')));

        $id('agencyRankPanel')?.classList.add('hidden');
        detailPanel.classList.remove('hidden');
    }

    function renderPurchaseDetail(agencySummaryData) {
        const container = $id('purchaseDetail');
        if (!container) return;
        const productFilter = $id('productFilter');
        const selectedProductText = productFilter?.value === 'all' ? '전체 품목' : productFilter.options[productFilter.selectedIndex].text;

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
            if (!supplierMap.has(item.supplier)) supplierMap.set(item.supplier, { amount: 0, contracts: new Set() });
            const info = supplierMap.get(item.supplier);
            info.amount += item.amount;
            info.contracts.add(`${item.contractNo || item.contractName}||${item.product}`);
        });
        const agencyTotalAmount = agencySummaryData.reduce((sum, item) => sum + item.amount, 0);
        let data = [...supplierMap.entries()].map(([supplier, { amount, contracts }]) => ({
            supplier, amount, contractCount: contracts.size, share: agencyTotalAmount > 0 ? (amount / agencyTotalAmount) * 100 : 0
        }));
        sortData(data, sortStates.purchase);
        data.forEach((item, index) => item.rank = index + 1);

        const tbody = $id('purchaseDetailBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">표시할 데이터가 없습니다.</td></tr>`;
        } else {
            data.forEach(item => {
                const row = tbody.insertRow();
                row.innerHTML = `
                    <td class="px-4 py-3 text-center">${item.rank}</td>
                    <td class="px-4 py-3"><a href="#" class="text-blue-600 hover:underline" data-supplier="${esc(item.supplier)}">${esc(item.supplier)}</a></td>
                    <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.contractCount)}</td>
                    <td class="px-4 py-3 text-right font-medium">${item.share.toFixed(1)}%</td>
                    <td class="px-4 py-3 text-right font-medium whitespace-nowrap">${CommonUtils.formatCurrency(item.amount)}</td>
                `;
            });
            // cross-link: 업체명 클릭 → 업체 판매순위 탭 + 해당 업체 상세
            tbody.querySelectorAll('a[data-supplier]').forEach(a => {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    hub?.gotoSupplier(a.dataset.supplier);
                });
            });
        }

        updateSortIndicators('purchaseDetailTable', sortStates.purchase);
        $id('purchaseDetailTable')?.querySelector('thead')?.addEventListener('click', e => {
            const th = e.target.closest('th');
            if (!th || !th.dataset.sortKey) return;
            handleTableSort('purchase', th.dataset.sortKey, th.dataset.sortType);
            renderPurchaseDetail(agencySummaryData);
        });
    }

    function renderContractDetail(agencyRawData) {
        const container = $id('contractDetail');
        if (!container) return;
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

        const tbody = $id('contractDetailBody');
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
                    <td class="px-4 py-3"><a href="#" class="text-blue-600 hover:underline contract-name-link" data-idx="${idx}">${esc(item.contractName)}</a></td>
                    <td class="px-4 py-3">${esc(item.supplier)}</td>
                    <td class="px-4 py-3 text-right font-medium whitespace-nowrap">${CommonUtils.formatCurrency(item.amount)}</td>
                `;
            });
            tbody.querySelectorAll('.contract-name-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    showContractItemsPopup(data[Number(link.dataset.idx)]);
                });
            });
        }

        updateSortIndicators('contractDetailTable', sortStates.contract);
        $id('contractDetailTable')?.querySelector('thead')?.addEventListener('click', e => {
            const th = e.target.closest('th');
            if (!th || !th.dataset.sortKey) return;
            handleTableSort('contract', th.dataset.sortKey, th.dataset.sortType);
            renderContractDetail(agencyRawData);
        });
    }

    function showContractItemsPopup(summary) {
        if (!summary) return;
        const items = Array.isArray(summary.lineItems) ? summary.lineItems : [];
        let contentHtml = `<p class="text-sm text-gray-600 mb-3">
            <span class="font-medium">${esc(summary.agency)}</span> · ${esc(summary.supplier)} ·
            총 ${items.length}개 라인 · 합계 ${CommonUtils.formatCurrency(summary.amount)}
        </p>`;
        if (items.length === 0) {
            contentHtml += '<p class="text-center text-gray-500 py-4">이 계약에는 등록된 품목 정보가 없습니다.</p>';
        } else {
            contentHtml += `<div class="overflow-x-auto"><table class="w-full text-sm text-left">
                <thead class="bg-gray-50"><tr>
                    <th class="p-2">모델</th><th class="p-2">규격</th><th class="p-2 text-right">수량</th><th class="p-2 text-right">단가</th><th class="p-2 text-right">합계액</th>
                </tr></thead><tbody>`;
            const sorted = [...items].sort((a, b) => (b.amount || 0) - (a.amount || 0));
            sorted.forEach(line => {
                const { model, spec, raw } = CommonUtils.parseProductIdentName(line.fullProductName);
                const specCell = (spec === '-' && raw) ? `<span class="text-gray-500" title="원본">${esc(raw)}</span>` : esc(spec);
                contentHtml += `<tr class="border-b">
                    <td class="p-2 whitespace-nowrap">${esc(model)}</td>
                    <td class="p-2">${specCell}</td>
                    <td class="p-2 text-right">${CommonUtils.formatNumber(line.quantity) || '-'}</td>
                    <td class="p-2 text-right">${line.unitPrice ? CommonUtils.formatCurrency(line.unitPrice) : '-'}</td>
                    <td class="p-2 text-right font-medium">${CommonUtils.formatCurrency(line.amount)}</td>
                </tr>`;
            });
            contentHtml += '</tbody></table></div>';
        }
        CommonUtils.showModal(`'${esc(summary.contractName)}' 품목 상세 내역`, contentHtml, { width: '900px' });
    }

    function renderTrendDetail(agencyName) {
        const container = $id('trendDetail');
        if (!container) return;
        container.innerHTML = `
            <h4 class="text-md font-semibold mb-2">연도별 구매 추이</h4>
            <div class="flex flex-col md:flex-row gap-6">
                <div class="md:w-1/2 p-4" style="min-height:320px;"><canvas id="trendChart"></canvas></div>
                <div class="md:w-1/2 p-4">
                    <h5 class="text-sm font-semibold mb-2">주요 지표 요약</h5>
                    <table id="trendSummaryTable" class="min-w-full text-sm"><tbody></tbody></table>
                </div>
            </div>
        `;
        const baseYear = getSelectedBaseYear();
        const chartYears = getFiveYearWindow(baseYear);
        const product = $id('productFilter')?.value || 'all';
        const yearlyRaw = allData.filter(d => {
            if (d.agency !== agencyName) return false;
            if (!d.date) return false;
            const year = parseInt(String(d.date).slice(0, 4), 10);
            if (!chartYears.includes(year)) return false;
            return product === 'all' || d.product === product;
        });
        const yearlySummary = buildContractSummary(yearlyRaw, false);
        const salesByYear = {}, countByYear = {};
        chartYears.forEach(year => { salesByYear[year] = 0; countByYear[year] = 0; });
        yearlySummary.forEach(d => {
            const year = parseInt(String(d.contractDate).slice(0, 4), 10);
            if (salesByYear.hasOwnProperty(year)) { salesByYear[year] += d.amount; countByYear[year] += 1; }
        });

        if (chartInstance) chartInstance.destroy();
        const canvas = $id('trendChart');
        if (!canvas) return;

        const selectedYearRaw = $id('analysisYear')?.value || 'all';
        const selectedYearNum = selectedYearRaw === 'all' ? null : parseInt(selectedYearRaw, 10);
        const isHighlightMode = selectedYearNum !== null && chartYears.includes(selectedYearNum);
        const barBgColors = chartYears.map(year => !isHighlightMode ? 'rgba(16, 185, 129, 0.6)' : (year === selectedYearNum ? 'rgba(16, 185, 129, 0.95)' : 'rgba(16, 185, 129, 0.25)'));
        const barBorderColors = chartYears.map(year => !isHighlightMode ? 'rgba(16, 185, 129, 1)' : (year === selectedYearNum ? 'rgba(5, 150, 105, 1)' : 'rgba(16, 185, 129, 0.5)'));

        const ctx = canvas.getContext('2d');
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: chartYears.map(String), datasets: [{ label: '연간 구매액', data: chartYears.map(year => salesByYear[year]), backgroundColor: barBgColors, borderColor: barBorderColors, borderWidth: 1 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                onClick: (evt, elements) => {
                    if (!elements || elements.length === 0) return;
                    const clickedYear = chartYears[elements[0].index];
                    if (clickedYear == null) return;
                    const yearFilter = $id('analysisYear');
                    if (!yearFilter) return;
                    yearFilter.value = (selectedYearNum === clickedYear) ? 'all' : String(clickedYear);
                    runAnalysis(false);
                },
                onHover: (evt, elements) => {
                    const target = evt?.native?.target;
                    if (target && target.style) target.style.cursor = elements && elements.length > 0 ? 'pointer' : 'default';
                },
                scales: { y: { beginAtZero: true, ticks: { callback: value => CommonUtils.formatCurrency(value) } } },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const count = countByYear[context.label] || 0;
                                return [`구매액: ${CommonUtils.formatCurrency(context.parsed.y)}`, `유효계약수: ${count}건`];
                            },
                            afterLabel: function (context) {
                                return parseInt(context.label, 10) === selectedYearNum ? '✓ 현재 선택' : '클릭하여 전환';
                            }
                        }
                    }
                }
            }
        });

        const summaryYear = baseYear;
        const yearAmounts = chartYears.map(year => salesByYear[year]);
        const actualTransactionYears = yearAmounts.filter(amount => amount > 0);
        const totalAmount = actualTransactionYears.reduce((sum, amount) => sum + amount, 0);
        const avgAmount = actualTransactionYears.length > 0 ? totalAmount / actualTransactionYears.length : 0;
        const peakAmount = Math.max(...yearAmounts, 0);
        const peakYear = peakAmount > 0 ? chartYears[yearAmounts.indexOf(peakAmount)] : '-';
        const summaryYearAmount = salesByYear[summaryYear] || 0;
        const vsAvgRatio = avgAmount > 0 ? ((summaryYearAmount / avgAmount) - 1) * 100 : 0;
        const diffText = vsAvgRatio === 0 ? '-' : (vsAvgRatio > 0 ? `▲ ${vsAvgRatio.toFixed(1)}%` : `▼ ${Math.abs(vsAvgRatio).toFixed(1)}%`);
        const diffColor = vsAvgRatio > 0 ? 'text-red-500' : 'text-blue-500';

        const summaryBody = $id('trendSummaryTable')?.querySelector('tbody');
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
        if (sortState.key === sortKey) sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        else { sortState.key = sortKey; sortState.direction = 'desc'; }
        sortState.type = sortType;
    }

    function sortData(data, sortState) {
        const { key, direction, type } = sortState;
        data.sort((a, b) => {
            const valA = a[key], valB = b[key];
            let comparison = (type === 'number') ? (Number(valA) || 0) - (Number(valB) || 0) : String(valA || '').localeCompare(String(valB || ''), 'ko');
            return direction === 'asc' ? comparison : -comparison;
        });
    }

    function updateSortIndicators(tableId, sortState) {
        const table = $id(tableId);
        if (!table) return;
        table.querySelectorAll('thead th[data-sort-key]').forEach(th => {
            const span = th.querySelector('span');
            if (span) {
                span.textContent = span.textContent.replace(/ [▲▼]$/, '');
                if (th.dataset.sortKey === sortState.key) span.textContent += sortState.direction === 'asc' ? ' ▲' : ' ▼';
            }
        });
    }

    function showLoadingState(isLoading, text = '분석 중') {
        const button = $id('analyzeBtn');
        if (!button) return;
        button.disabled = isLoading;
        button.innerHTML = isLoading ? `<div class="loading-spinner mr-2"></div> ${text}...` : '분석';
    }

    function printPanel(panel) {
        if (!panel) { CommonUtils.showAlert('인쇄할 내용이 없습니다.', 'warning'); return; }
        const style = document.createElement('style');
        style.id = 'print-style';
        style.innerHTML = `
            @media print {
                .report-section { margin-top: 3rem !important; page-break-inside: avoid !important; }
                .no-print { display: none !important; }
                #trendDetail .flex { display: flex !important; flex-direction: row !important; width: 100%; }
                #trendDetail .flex > div { padding: 0 !important; }
                #trendDetail .flex > div:first-child { width: 60% !important; }
                #trendDetail .flex > div:last-child { width: 40% !important; padding-left: 1rem !important; }
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

    // cross-link 진입: 지역/소관/검색 필터를 풀어 대상 기관이 보이게(연도·품목은 현재값 유지)
    function focusAgency(name) {
        const region = $id('regionFilter'), city = $id('cityFilter'), atype = $id('agencyTypeFilter'), search = $id('agencySearchFilter');
        if (region) region.value = 'all';
        populateCityFilter();
        if (city) city.value = 'all';
        if (atype) atype.value = 'all';
        if (search) search.value = '';
        runAnalysis(true);
        showAgencyDetail(name);
    }

    window.__mAgency = { init, showDetail: showAgencyDetail, focusAgency };
})();

/* =========================================================================
 * IIFE 2 — 업체 판매순위 (원 supplier-ranking.js)
 * ========================================================================= */
(function () {
    let root, hub;
    let allData = [];
    let currentFilteredData = [];
    let sortStates = {
        main: { key: 'amount', direction: 'desc', type: 'number' },
        detail: { key: 'amount', direction: 'desc', type: 'number' }
    };

    const $id = id => root.querySelector('#' + id);
    const supplierKey = item => item.bizno || item.supplier;

    const GAS_WRITE_URL = 'https://script.google.com/macros/s/AKfycbxM128rPA6TSQltBIOuiB2zGQB--n9S-V93jNLGxTLJZnwBpUMfgiG1BMZDwCXufW2f/exec';
    const ORDER_DB_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRum7_WBDKTJSA8B1ATxqpd3BtvjXnPLNQXuMpQsx0q4HVmwm_-JRQLCjy-FrYryIBPuxYkhV7F1nWq/pub';
    const SUPPLIER_INFO_GID = 1770790299;
    let supplierInfoMap = new Map();
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const infoOf = bizno => supplierInfoMap.get(String(bizno || '').replace(/[^\d]/g, ''));

    async function callGAS(action, payload = {}) {
        const _requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const res = await fetch(GAS_WRITE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action, _requestId, ...payload })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }

    function parseCSVText(text) {
        const rows = []; let row = [], cell = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i], n = text[i + 1];
            if (c === '"') { if (inQ && n === '"') { cell += '"'; i++; } else inQ = !inQ; }
            else if (c === ',' && !inQ) { row.push(cell); cell = ''; }
            else if ((c === '\n' || c === '\r') && !inQ) { if (c === '\r' && n === '\n') i++; if (cell !== '' || row.length) { row.push(cell); rows.push(row); } row = []; cell = ''; }
            else cell += c;
        }
        if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
        if (!rows.length) return [];
        const h = rows[0].map(x => x.trim());
        return rows.slice(1).filter(r => r.some(x => String(x).trim())).map(r => { const o = {}; h.forEach((k, i) => o[k] = (r[i] || '').trim()); return o; });
    }

    async function loadSupplierInfo() {
        try {
            const res = await fetch(`${ORDER_DB_BASE}?gid=${SUPPLIER_INFO_GID}&single=true&output=csv`, { cache: 'no-store' });
            if (!res.ok) return;
            const rows = parseCSVText(await res.text());
            supplierInfoMap = new Map(rows.map(r => [String(r['사업자번호'] || '').replace(/[^\d]/g, ''), r]).filter(([k]) => k));
            console.log(`[업체정보] ${supplierInfoMap.size}개 로드`);
        } catch (e) { console.warn('[업체정보] 로드 실패(소재지 생략):', e.message); }
    }

    function populateRegionFilter() {
        const sel = $id('regionFilter');
        if (!sel) return;
        const sidos = [...new Set([...supplierInfoMap.values()].map(r => r['시도']).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
        sel.innerHTML = '<option value="all">전체</option>' + sidos.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    }

    async function refreshSupplierInfo() {
        if (!confirm('업체정보를 갱신할까요? 조달청 MAS에서 다시 수집하며 최대 1~2분 걸릴 수 있습니다.')) return;
        const btn = $id('refreshSupplierBtn');
        CommonUtils.toggleLoading(btn, true);
        try {
            const r = await callGAS('buildSupplierInfo', {});
            if (r && r.ok) {
                CommonUtils.showAlert(`업체정보 ${CommonUtils.formatNumber(r.업체수 || 0)}곳 갱신 완료. 새 소재지·인증은 잠시 후(시트 게시 반영) 보입니다.`, 'success');
                await loadSupplierInfo();
                populateRegionFilter();
                analyzeData();
            } else {
                CommonUtils.showAlert('업체정보 갱신 실패: ' + ((r && r.error) || '알 수 없는 오류'), 'error');
            }
        } catch (e) {
            CommonUtils.showAlert('업체정보 갱신 실패: ' + e.message, 'error');
        } finally {
            CommonUtils.toggleLoading(btn, false);
        }
    }

    async function init(rootEl, rawData, hubRef) {
        root = rootEl; hub = hubRef;
        try {
            allData = parseData(rawData);
            await loadSupplierInfo();
            populateRegionFilter();
            $id('analyzeBtn')?.addEventListener('click', analyzeData);
            $id('refreshSupplierBtn')?.addEventListener('click', refreshSupplierInfo);
            analyzeData();
        } catch (error) {
            console.error('업체 순위 초기화 실패:', error);
            CommonUtils.showAlert('업체 순위 초기화 중 오류가 발생했습니다.', 'error');
        }
    }

    function parseData(rawData) {
        return rawData.map(item => {
            const amount = CommonUtils.parseSignedAmount(item['공급금액']);
            return {
                agency: (item['수요기관명'] || '').trim(),
                supplier: (item['업체'] || '').trim(),
                bizno: String(item['업체사업자등록번호'] || '').replace(/[^\d]/g, ''),
                region: (item['수요기관지역'] || '').trim().split(' ')[0],
                agencyType: item['소관구분'] || '기타',
                product: (item['세부품명'] || '').trim(),
                amount,
                date: item['기준일자'] || '',
                contractName: (item['계약명'] || '').trim()
            };
        }).filter(item => item.supplier && item.agency && item.amount > 0);
    }

    function analyzeData() {
        $id('supplierDetailPanel').classList.add('hidden');
        $id('supplierPanel').classList.remove('hidden');

        const year = $id('analysisYear').value;
        const product = $id('productFilter').value;
        const region = $id('regionFilter').value;

        currentFilteredData = allData.filter(item => {
            if (year !== 'all' && !(item.date && item.date.startsWith(year))) return false;
            if (product !== 'all' && item.product !== product) return false;
            if (region !== 'all') { const inf = infoOf(item.bizno); if (!inf || inf['시도'] !== region) return false; }
            return true;
        });

        updateSummaryStats(currentFilteredData);
        renderSupplierTable(currentFilteredData);
    }

    function updateSummaryStats(data) {
        const totalSuppliers = new Set(data.map(supplierKey)).size;
        const totalContracts = data.length;
        const totalSales = data.reduce((sum, item) => sum + item.amount, 0);
        $id('totalSuppliers').textContent = CommonUtils.formatNumber(totalSuppliers) + '개';
        $id('totalContracts').textContent = CommonUtils.formatNumber(totalContracts) + '건';
        $id('totalSales').textContent = CommonUtils.formatCurrency(totalSales);
    }

    function renderSupplierTable(data) {
        const panel = $id('supplierPanel');
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
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="locplcSort" data-sort-type="string"><span>소재지</span></th>
                            <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractCount" data-sort-type="number"><span>계약건수</span></th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>총 판매액</span></th>
                        </tr></thead>
                        <tbody id="supplierTableBody"></tbody>
                    </table>
                </div>
            </div>`;

        const supplierMap = new Map();
        data.forEach(item => {
            const key = supplierKey(item);
            if (!supplierMap.has(key)) supplierMap.set(key, { key, bizno: item.bizno, supplier: item.supplier, amount: 0, contractCount: 0 });
            const info = supplierMap.get(key);
            info.amount += item.amount;
            info.contractCount++;
        });

        let supplierData = [...supplierMap.values()];
        supplierData.forEach(s => {
            const inf = infoOf(s.bizno);
            s.locplc = inf ? ((inf['시도'] || '') + (inf['시군'] ? ' ' + inf['시군'] : '')).trim() : '';
            s.locplcSort = s.locplc || '￿';
        });
        sortData(supplierData, sortStates.main);
        supplierData.forEach((item, index) => item.rank = index + 1);

        const tbody = panel.querySelector('#supplierTableBody');
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
        if (supplierData.length === 0) return;

        tbody.innerHTML = '';
        supplierData.forEach(item => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td class="px-4 py-3 text-center">${item.rank}</td>
                <td class="px-4 py-3"><a href="#" data-key="${esc(item.key)}" class="text-blue-600 hover:underline">${esc(item.supplier)}</a></td>
                <td class="px-4 py-3 text-gray-600">${item.locplc ? esc(item.locplc) : '<span class="text-gray-300">-</span>'}</td>
                <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.contractCount)}</td>
                <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
            `;
            row.querySelector('a').addEventListener('click', e => {
                e.preventDefault();
                showSupplierDetail(e.currentTarget.dataset.key);
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

    function showSupplierDetail(key) {
        const supplierName = (currentFilteredData.find(item => supplierKey(item) === key) || {}).supplier || key;
        const detailPanel = $id('supplierDetailPanel');
        const inf = infoOf(key);
        const infoBlock = inf ? `
                <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 text-sm">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                        <div><span class="text-gray-500 mr-1">본사소재지</span>${esc(inf['본사소재지']) || '-'}</div>
                        <div><span class="text-gray-500 mr-1">공장소재지</span>${esc(inf['공장소재지']) || '-'}</div>
                        <div><span class="text-gray-500 mr-1">기업규모</span>${esc(inf['기업규모']) || '-'}</div>
                        <div><span class="text-gray-500 mr-1">담당부서</span>${esc(inf['담당부서']) || '-'} ${esc(inf['담당전화'])}</div>
                        <div><span class="text-gray-500 mr-1">우선구매대상</span>${esc(inf['우선구매인증']) || '-'}</div>
                        <div><span class="text-gray-500 mr-1">의무구매대상</span>${esc(inf['의무구매인증']) || '-'}</div>
                        <div class="md:col-span-2"><span class="text-gray-500 mr-1">품질인증</span>${esc(inf['품질인증']) || '-'}</div>
                        <div class="md:col-span-2"><span class="text-gray-500 mr-1">제품인증</span>${esc(inf['제품인증']) || '-'}</div>
                    </div>
                    <div class="text-xs text-gray-400 mt-2">출처: 조달청 종합쇼핑몰 다수공급자계약(MAS) · 갱신 ${esc(inf['갱신일'])}</div>
                </div>` : `
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-700">조달청 종합쇼핑몰(MAS) 미등록 — 업체 소재지·인증 정보 없음</div>`;
        detailPanel.innerHTML = `
            <div class="p-6 printable-area">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg"><strong class="font-bold">${esc(supplierName)}</strong> <span class="font-normal">판매 상세 내역</span></h3>
                    <div class="flex items-center space-x-2 no-print">
                        <button id="printDetailBtn" class="btn btn-secondary btn-sm">인쇄</button>
                        <button id="exportDetailBtn" class="btn btn-secondary btn-sm">CSV 내보내기</button>
                        <button id="backToListBtn" class="btn btn-secondary btn-sm">목록으로</button>
                    </div>
                </div>
                ${infoBlock}
                <div class="overflow-x-auto">
                    <table id="supplierDetailTable" class="min-w-full divide-y divide-gray-200 data-table">
                        <thead class="bg-gray-50"><tr>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="agency" data-sort-type="string"><span>수요기관명</span></th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="region" data-sort-type="string"><span>수요기관 지역</span></th>
                            <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>업체 판매금액</span></th>
                            <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="totalAmount" data-sort-type="number"><span>수요기관 전체 구매액</span></th>
                        </tr></thead>
                        <tbody id="supplierDetailTableBody"></tbody>
                    </table>
                </div>
            </div>`;

        const supplierSpecificData = currentFilteredData.filter(item => supplierKey(item) === key);
        const agencyTotalMap = new Map();
        currentFilteredData.forEach(item => agencyTotalMap.set(item.agency, (agencyTotalMap.get(item.agency) || 0) + item.amount));

        const agencySalesMap = new Map();
        supplierSpecificData.forEach(item => {
            if (!agencySalesMap.has(item.agency)) agencySalesMap.set(item.agency, { agency: item.agency, region: item.region, amount: 0 });
            agencySalesMap.get(item.agency).amount += item.amount;
        });
        let detailData = [...agencySalesMap.values()].map(item => ({ ...item, totalAmount: agencyTotalMap.get(item.agency) || 0 }));

        const renderDetailTable = () => {
            sortData(detailData, sortStates.detail);
            const tbody = detailPanel.querySelector('#supplierDetailTableBody');
            tbody.innerHTML = '';
            detailData.forEach(item => {
                const row = tbody.insertRow();
                row.innerHTML = `
                    <td class="px-4 py-3"><a href="#" class="text-blue-600 hover:underline" data-agency="${esc(item.agency)}">${esc(item.agency)}</a></td>
                    <td class="px-4 py-3">${esc(item.region)}</td>
                    <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
                    <td class="px-4 py-3 text-right">${CommonUtils.formatCurrency(item.totalAmount)}</td>
                `;
            });
            // cross-link: 수요기관명 클릭 → 수요기관 분석 탭 + 해당 기관 상세 (데드엔드 해소)
            tbody.querySelectorAll('a[data-agency]').forEach(a => {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    hub?.gotoAgency(a.dataset.agency);
                });
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
            $id('supplierPanel').classList.remove('hidden');
        });
        detailPanel.querySelector('#printDetailBtn').addEventListener('click', () => printPanel(detailPanel));
        detailPanel.querySelector('#exportDetailBtn').addEventListener('click', () => CommonUtils.exportTableToCSV(detailPanel.querySelector('#supplierDetailTable'), `${supplierName}_상세내역.csv`));

        $id('supplierPanel').classList.add('hidden');
        detailPanel.classList.remove('hidden');
    }

    // cross-link 진입: 업체명으로 상세 열기 (수요기관 탭에서 호출)
    function showDetailByName(name) {
        const hit = currentFilteredData.find(i => i.supplier === name);
        if (hit) showSupplierDetail(supplierKey(hit));
        else CommonUtils.showAlert(`'${name}' 업체의 현재 필터(기간/품목/지역) 내 판매 데이터가 없습니다.`, 'warning');
    }

    function handleTableSort(tableName, sortKey, sortType = 'string') {
        const sortState = sortStates[tableName];
        if (sortState.key === sortKey) sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        else { sortState.key = sortKey; sortState.direction = 'desc'; }
        sortState.type = sortType;
    }

    function sortData(data, sortState) {
        const { key, direction, type } = sortState;
        data.sort((a, b) => {
            const valA = a[key], valB = b[key];
            let comparison = (type === 'number') ? (Number(valA) || 0) - (Number(valB) || 0) : String(valA || '').localeCompare(String(valB || ''), 'ko');
            return direction === 'asc' ? comparison : -comparison;
        });
    }

    function updateSortIndicators(tableId, sortState) {
        const table = $id(tableId);
        if (!table) return;
        table.querySelectorAll('thead th[data-sort-key]').forEach(th => {
            const span = th.querySelector('span');
            if (span) {
                span.textContent = span.textContent.replace(/ [▲▼]$/, '');
                if (th.dataset.sortKey === sortState.key) span.textContent += sortState.direction === 'asc' ? ' ▲' : ' ▼';
            }
        });
    }

    function printPanel(panel) {
        const printable = panel.querySelector('.printable-area');
        if (printable) {
            printable.classList.add('printing-now');
            window.print();
            setTimeout(() => printable.classList.remove('printing-now'), 500);
        } else {
            CommonUtils.showAlert('인쇄할 내용이 없습니다.', 'warning');
        }
    }

    // cross-link 진입: 소재지 필터를 풀어 대상 업체가 보이게(연도·품목은 현재값 유지)
    function focusSupplier(name) {
        const region = $id('regionFilter');
        if (region) region.value = 'all';
        analyzeData();
        showDetailByName(name);
    }

    window.__mSupplier = { init, showDetail: showSupplierDetail, showDetailByName, focusSupplier };
})();

/* =========================================================================
 * IIFE 3 — 트렌드 분석 (원 trend-analysis.js) — 두발로 필터 제거 = 시장 전체
 * ========================================================================= */
(function () {
    let root;
    let allData = [];
    let chartInstances = {};

    const $id = id => root.querySelector('#' + id);

    const colors = {
        base: { bg: 'rgba(255, 99, 132, 0.2)', border: 'rgba(255, 99, 132, 1)' },
        comparison: { bg: 'rgba(54, 162, 235, 0.2)', border: 'rgba(54, 162, 235, 1)' }
    };

    function init(rootEl, rawData) {
        root = rootEl;
        showLoadingState(true, '데이터 분석 중...');
        try {
            allData = parseData(rawData);
            populateYearFilters();
            $id('analyzeBtn')?.addEventListener('click', analyzeTrends);
            setupTabs();
            analyzeTrends();
        } catch (error) {
            console.error('트렌드 분석 초기화 실패:', error);
            showAlert('데이터 분석 중 오류가 발생했습니다.', 'error');
        } finally {
            showLoadingState(false);
        }
    }

    function parseData(rawData) {
        const parseSignedAmount = CommonUtils.parseSignedAmount;
        return rawData
            .map(item => ({
                customer: (item['수요기관명'] || '').trim(),
                regionFull: (item['수요기관지역'] || '').trim(),
                region: (item['수요기관지역'] || '').trim().split(' ')[0],
                agencyType: (item['소관구분'] || '기타').trim(),
                amount: parseSignedAmount(item['공급금액']),
                date: item['기준일자'] || '',
                contractName: (item['계약명'] || '').trim(),
                product: (item['세부품명'] || '').trim(),
                supplier: (item['업체'] || '').trim(),
                rawAmount: String(item['공급금액'] ?? '').trim()
            }))
            // 트랙 F: 두발로 필터 제거 → 시장 전체 추이 (자사만 아님)
            .filter(item =>
                item.customer && item.date && item.rawAmount !== '' && !Number.isNaN(item.amount)
            );
    }

    function populateYearFilters() {
        const baseYearEl = $id('baseYear');
        const comparisonYearEl = $id('comparisonYear');
        if (!baseYearEl || !comparisonYearEl) return;
        let years = [...new Set(allData.map(d => new Date(d.date).getFullYear()))];
        const currentYear = new Date().getFullYear();
        if (!years.includes(currentYear)) years.push(currentYear);
        years = years.filter(y => !Number.isNaN(y)).sort((a, b) => b - a);
        baseYearEl.innerHTML = '<option value="all_avg">전체(평균)</option>';
        comparisonYearEl.innerHTML = '';
        years.forEach(year => {
            baseYearEl.add(new Option(`${year}년`, year));
            comparisonYearEl.add(new Option(`${year}년`, year));
        });
        baseYearEl.value = 'all_avg';
        comparisonYearEl.value = currentYear;
    }

    function setupTabs() {
        const tabs = $id('trendTabs');
        if (!tabs) return;
        tabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const tabName = btn.dataset.tab;
            tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            root.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
            $id(tabName + 'Tab')?.classList.remove('hidden');
        });
    }

    function analyzeTrends() {
        showLoadingState(true, '데이터 분석 및 그래프 생성 중...');
        const baseYear = $id('baseYear').value;
        const comparisonYear = $id('comparisonYear').value;
        const product = $id('productFilter').value;

        if (baseYear === comparisonYear) {
            showAlert('기준연도와 분석연도는 같을 수 없습니다.', 'warning');
            showLoadingState(false);
            return;
        }

        const productFilteredData = allData.filter(item => (product === 'all') || (item.product === product));
        const comparisonData = productFilteredData.filter(d => new Date(d.date).getFullYear().toString() === comparisonYear);

        let baseData, baseLabel;
        const yearsInData = [...new Set(productFilteredData.map(d => new Date(d.date).getFullYear()))];
        if (baseYear === 'all_avg') {
            const avgYears = yearsInData.filter(y => y.toString() !== comparisonYear);
            baseData = productFilteredData.filter(d => avgYears.includes(new Date(d.date).getFullYear()));
            baseLabel = `전체 평균 (${avgYears.length}년)`;
        } else {
            baseData = productFilteredData.filter(d => new Date(d.date).getFullYear().toString() === baseYear);
            baseLabel = `${baseYear}년`;
        }

        renderMonthlyTrend(baseData, comparisonData, baseLabel, `${comparisonYear}년`, baseYear);
        renderRegionalTrend(baseData, comparisonData, baseLabel, `${comparisonYear}년`, baseYear);
        renderAgencyTypeTrend(baseData, comparisonData, baseLabel, `${comparisonYear}년`, baseYear);
        showLoadingState(false);
    }

    function renderChart(canvasId, type, labels, datasets) {
        if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
        const ctx = $id(canvasId).getContext('2d');
        chartInstances[canvasId] = new Chart(ctx, {
            type: type,
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { callback: value => CommonUtils.formatCurrency(value) } } },
                plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${CommonUtils.formatCurrency(context.parsed.y)}` } } }
            }
        });
    }

    function renderMonthlyTrend(base, comparison, baseLabel, compLabel, baseYear) {
        const aggregate = (data) => {
            const monthly = Array(12).fill(0);
            data.forEach(item => { monthly[new Date(item.date).getMonth()] += item.amount; });
            return monthly;
        };
        let baseMonthly = aggregate(base);
        if (baseYear === 'all_avg') {
            const numYears = [...new Set(base.map(d => new Date(d.date).getFullYear()))].length;
            if (numYears > 0) baseMonthly = baseMonthly.map(val => val / numYears);
        }
        const compMonthly = aggregate(comparison);
        const labels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
        renderChart('monthlyChart', 'line', labels, [
            { label: baseLabel, data: baseMonthly, backgroundColor: colors.base.bg, borderColor: colors.base.border, borderWidth: 1, fill: true },
            { label: compLabel, data: compMonthly, backgroundColor: colors.comparison.bg, borderColor: colors.comparison.border, borderWidth: 1, fill: true }
        ]);
        $id('printMonthlyBtn').onclick = () => printPanel('monthlyTab');

        const generateTableRows = (label, dataArr) => {
            const sum = dataArr.reduce((a, b) => a + b, 0);
            const formatMoney = (val) => window.CommonUtils ? CommonUtils.formatCurrency(val) : val.toLocaleString() + '원';
            const cols = dataArr.map(val => `
                <td class="px-2 py-2 whitespace-nowrap text-right text-sm">
                    <div class="font-medium text-gray-900">${formatMoney(val)}</div>
                    <div class="text-xs text-gray-500 mt-1">${sum > 0 ? ((val / sum) * 100).toFixed(1) : '0'}%</div>
                </td>`).join('');
            return `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-700 bg-gray-50/50">${label}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-right font-bold text-gray-900 border-r-2">${formatMoney(sum)}</td>
                    ${cols}
                </tr>`;
        };
        const tableHTML = `
            <table class="min-w-full divide-y divide-gray-200 border">
                <thead class="bg-gray-100">
                    <tr>
                        <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">구분</th>
                        <th scope="col" class="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r-2 w-40">연간 합계</th>
                        ${labels.map(L => `<th scope="col" class="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">${L}</th>`).join('')}
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    ${generateTableRows(baseLabel, baseMonthly)}
                    ${generateTableRows(compLabel, compMonthly)}
                </tbody>
            </table>`;
        const tableContainer = $id('monthlyDataTable');
        if (tableContainer) tableContainer.innerHTML = tableHTML;
    }

    function renderRegionalTrend(base, comparison, baseLabel, compLabel, baseYear) {
        const aggregate = (data) => {
            const regional = {};
            data.forEach(item => { if (item.region) regional[item.region] = (regional[item.region] || 0) + item.amount; });
            return regional;
        };
        const allLabels = [...new Set([...base.map(d => d.region), ...comparison.map(d => d.region)])].filter(Boolean).sort();
        const baseAgg = aggregate(base), compAgg = aggregate(comparison);
        let baseRegional = allLabels.map(label => baseAgg[label] || 0);
        if (baseYear === 'all_avg') {
            const numYears = [...new Set(base.map(d => new Date(d.date).getFullYear()))].length;
            if (numYears > 0) baseRegional = baseRegional.map(val => val / numYears);
        }
        const compRegional = allLabels.map(label => compAgg[label] || 0);
        renderChart('regionalChart', 'bar', allLabels, [
            { label: baseLabel, data: baseRegional, backgroundColor: colors.base.bg, borderColor: colors.base.border, borderWidth: 1 },
            { label: compLabel, data: compRegional, backgroundColor: colors.comparison.bg, borderColor: colors.comparison.border, borderWidth: 1 }
        ]);
        $id('printRegionalBtn').onclick = () => printPanel('regionalTab');
    }

    function renderAgencyTypeTrend(base, comparison, baseLabel, compLabel, baseYear) {
        const aggregate = (data) => {
            const byType = {};
            data.forEach(item => { byType[item.agencyType] = (byType[item.agencyType] || 0) + item.amount; });
            return byType;
        };
        const allLabels = [...new Set([...base.map(d => d.agencyType), ...comparison.map(d => d.agencyType)])].filter(Boolean).sort();
        const baseAgg = aggregate(base), compAgg = aggregate(comparison);
        let baseByType = allLabels.map(label => baseAgg[label] || 0);
        if (baseYear === 'all_avg') {
            const numYears = [...new Set(base.map(d => new Date(d.date).getFullYear()))].length;
            if (numYears > 0) baseByType = baseByType.map(val => val / numYears);
        }
        const compByType = allLabels.map(label => compAgg[label] || 0);
        renderChart('agencyTypeChart', 'bar', allLabels, [
            { label: baseLabel, data: baseByType, backgroundColor: colors.base.bg, borderColor: colors.base.border, borderWidth: 1 },
            { label: compLabel, data: compByType, backgroundColor: colors.comparison.bg, borderColor: colors.comparison.border, borderWidth: 1 }
        ]);
        $id('printAgencyTypeBtn').onclick = () => printPanel('agencyTypeTab');
    }

    function printPanel(elementId) {
        const panel = $id(elementId);
        if (panel) {
            panel.classList.add('printable-area');
            Chart.defaults.animation = false;
            window.print();
            Chart.defaults.animation = true;
            panel.classList.remove('printable-area');
        }
    }

    function showLoadingState(isLoading, text = '분석 중...') {
        const button = $id('analyzeBtn');
        if (button) {
            button.disabled = isLoading;
            button.innerHTML = isLoading ? `<div class="loading-spinner"></div> ${text}` : '분석';
        }
    }

    function showAlert(message, type = 'info') {
        if (window.CommonUtils && CommonUtils.showAlert) window.CommonUtils.showAlert(message, type);
        else alert(message);
    }

    window.__mTrend = { init };
})();

/* =========================================================================
 * 오케스트레이터 — 상위 탭 전환 + B소스 1회 로드 + 지연 init + cross-link 허브
 * ========================================================================= */
(function () {
    const Hub = window.MarketHub = {};
    let rawProcurement = null;
    let dataPromise = null;
    const loaded = { agencyTab: false, supplierTab: false, trendTab: false };

    function ensureData() {
        if (!dataPromise) {
            dataPromise = (async () => {
                if (!window.sheetsAPI || typeof window.sheetsAPI.loadAllProcurementData !== 'function') {
                    throw new Error('sheets-api.js가 로드되지 않았습니다.');
                }
                rawProcurement = await window.sheetsAPI.loadAllProcurementData();
                console.log(`[통합 로드] 조달 raw ${rawProcurement.length}건 (3탭 공유)`);
                return rawProcurement;
            })();
        }
        return dataPromise;
    }

    function showGlobalLoading(on) {
        const el = document.getElementById('marketLoading');
        if (el) el.classList.toggle('hidden', !on);
    }

    async function activate(tab) {
        const nav = document.getElementById('marketTabs');
        nav.querySelectorAll('.market-tab').forEach(b => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('border-blue-600', on);
            b.classList.toggle('text-blue-600', on);
            b.classList.toggle('border-transparent', !on);
            b.classList.toggle('text-gray-500', !on);
        });
        ['agencyTab', 'supplierTab', 'trendTab'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', id !== tab);
        });

        if (!loaded[tab]) {
            if (!rawProcurement) showGlobalLoading(true);
            try {
                await ensureData();
            } catch (e) {
                showGlobalLoading(false);
                CommonUtils.showAlert('조달 데이터 로딩 실패: ' + e.message, 'error');
                return;
            }
            showGlobalLoading(false);
            const root = document.getElementById(tab);
            if (tab === 'agencyTab') window.__mAgency.init(root, rawProcurement, Hub);
            else if (tab === 'supplierTab') await window.__mSupplier.init(root, rawProcurement, Hub);
            else if (tab === 'trendTab') window.__mTrend.init(root, rawProcurement, Hub);
            loaded[tab] = true;
        }
    }

    // cross-link 허브: 다른 탭으로 전환 + 해당 상세 열기 (대상 탭 미로드 시 먼저 init)
    Hub.gotoAgency = async function (agencyName) {
        await activate('agencyTab');
        window.__mAgency.focusAgency(agencyName);
    };
    Hub.gotoSupplier = async function (supplierName) {
        await activate('supplierTab');
        window.__mSupplier.focusSupplier(supplierName);
    };

    document.addEventListener('DOMContentLoaded', () => {
        const nav = document.getElementById('marketTabs');
        if (nav) nav.addEventListener('click', e => {
            const btn = e.target.closest('button[data-tab]');
            if (btn) activate(btn.dataset.tab);
        });
        activate('agencyTab');   // 첫 탭 기본 로드
    });
})();
