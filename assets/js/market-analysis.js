// market-analysis.js — 시장 분석 통합 (수요기관 분석 / 업체 판매순위 / 트렌드 분석)
// 트랙 F: 3개 B소스(조달청) 페이지를 단일 페이지 탭으로 병합.
// 설계: 각 탭 = 독립 IIFE(전역/함수명 충돌 0), DOM은 자기 탭 root로 스코프($id).
//       B소스(loadAllProcurementData)는 오케스트레이터가 1회 로드해 3탭 공유.
//       트렌드는 두발로 필터 제거 → 시장 전체 추이. cross-link 업체↔수요기관.
console.log('%c[market-analysis.js v=20260728a — 시장 분석 5탭(수요기관/업체/트렌드/월간주문내역/가격 경쟁력: 연도 선택·정렬 토글), B소스 1회 로드]', 'color:#0ea5e9; font-weight:bold');

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
 * IIFE 4 — 월간 주문내역 (조달청 전체, 납품요구 단위 주문을 월별로)
 *   1 주문 = 계약납품통합번호(납품요구) 1건. 라인(모델/규격)을 한 주문으로 묶어
 *   기준일자(대표=최신) 기준 월별 그룹핑, 최신순. 행 클릭 = 품목 상세 팝업.
 *   단일 테이블(table-layout:fixed + colgroup)로 열 정렬 고정. 검색 결과 총합 표시 + 인쇄.
 *   ※ 내부 id/함수명은 legacy(weeklyOrderTab/__mWeekly) 유지 — 화면 라벨만 '월간 주문내역'.
 * ========================================================================= */
(function () {
    let root, hub;
    let orders = [];        // 납품요구 단위로 묶은 주문 배열
    let rendered = [];       // 현재 렌더된 주문(행 data-idx → 주문) 조회용

    const $id = id => root.querySelector('#' + id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function init(rootEl, rawData, hubRef) {
        root = rootEl; hub = hubRef;
        try {
            orders = groupOrders(parseRows(rawData));
            populateFilters();
            $id('woYear').addEventListener('change', render);
            $id('woProduct').addEventListener('change', render);
            $id('woSearch').addEventListener('input', render);
            $id('woPrint').addEventListener('click', doPrint);
            $id('weeklyList').addEventListener('click', onRowClick);
            render();
        } catch (error) {
            console.error('월간 주문내역 초기화 실패:', error);
            CommonUtils.showAlert(`월간 주문내역 오류: ${error.message}`, 'error');
        }
    }

    // rawData(dedup 완료 rows) → 필요한 필드만 뽑은 라인 배열
    function parseRows(rawData) {
        const rows = [];
        (rawData || []).forEach(r => {
            const date = (r['기준일자'] || '').trim();
            const agency = (r['수요기관명'] || '').trim();
            const supplier = (r['업체'] || '').trim();
            if (!date || !agency || !supplier) return;   // 결손 행 제외
            rows.push({
                date,
                agency,
                supplier,
                product: (r['세부품명'] || '').trim(),
                amount: Number(CommonUtils.parseSignedAmount(r['공급금액'])) || 0,
                contractNo: (r['계약납품통합번호'] || '').trim(),
                contractName: (r['계약명'] || '').trim(),
                fullProductName: (r['물품식별명'] || '').trim(),
                quantity: Number(CommonUtils.parseSignedAmount(r['계약납품수량'])) || 0,
                unitPrice: Number(CommonUtils.parseSignedAmount(r['계약납품단가'])) || 0
            });
        });
        return rows;
    }

    // 라인 → 납품요구(계약) 단위 주문으로 묶기
    function groupOrders(rows) {
        const map = new Map();
        rows.forEach(r => {
            // 납품요구번호 우선, 결손 시 계약명+업체+수요기관+날짜로 분리
            const key = r.contractNo || ('명|' + r.contractName + '|' + r.supplier + '|' + r.agency + '|' + r.date);
            let o = map.get(key);
            if (!o) {
                o = { date: r.date, agency: r.agency, supplier: r.supplier, contractName: r.contractName,
                      amount: 0, productSet: new Set(), lineItems: [] };
                map.set(key, o);
            }
            o.amount += r.amount;
            if (r.product) o.productSet.add(r.product);
            if (r.date > o.date) o.date = r.date;   // 대표 = 그룹 내 최신 기준일자
            o.lineItems.push({ fullProductName: r.fullProductName, quantity: r.quantity, unitPrice: r.unitPrice, amount: r.amount });
        });
        return [...map.values()].map(o => {
            o.productList = [...o.productSet];
            o.product = o.productList.length ? o.productList.join(', ') : '-';
            delete o.productSet;
            return o;
        });
    }

    function populateFilters() {
        const years = [...new Set(orders.map(o => o.date.slice(0, 4)).filter(Boolean))].sort().reverse();
        const ySel = $id('woYear');
        ySel.innerHTML = years.map(y => `<option value="${y}">${y}년</option>`).join('');
        if (years.length) ySel.value = years[0];

        const products = [...new Set(orders.flatMap(o => o.productList))].filter(Boolean).sort();
        const pSel = $id('woProduct');
        pSel.innerHTML = products.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
        pSel.value = products.find(p => p.includes('보행')) || products[0] || '';   // 디폴트 보행매트
    }

    function render() {
        const year = $id('woYear').value;
        const prod = $id('woProduct').value;
        const rawQ = $id('woSearch').value.trim();
        const q = rawQ.toLowerCase();
        const filtered = orders.filter(o =>
            (!year || o.date.slice(0, 4) === year) &&
            (!prod || o.productList.includes(prod)) &&
            (!q || `${o.agency} ${o.supplier} ${o.contractName || ''}`.toLowerCase().includes(q))
        );

        // 검색 결과 총 합계 (현재 필터 전체)
        const grandTotal = filtered.reduce((s, o) => s + (o.amount || 0), 0);
        const ctx = [year ? `${year}년` : null, prod || null, rawQ ? `검색 '${rawQ}'` : null].filter(Boolean).join(' · ');
        $id('woSummary').innerHTML =
            `<span class="wo-sum-ctx">${esc(ctx || '전체')}</span>` +
            `<span class="wo-sum-total">${filtered.length}건 · 합계 ${CommonUtils.formatCurrency(grandTotal)}</span>`;

        const container = $id('weeklyList');
        rendered = [];

        const months = bucketByMonth(filtered);
        if (!months.length) {
            container.innerHTML = '<div class="wo-empty">해당 조건의 주문이 없습니다.</div>';
            return;
        }

        // 단일 테이블(table-layout:fixed + colgroup)로 그려 월이 달라도 열 너비가 정확히 일치
        let body = '';
        months.forEach(m => {
            body += `<tr class="wo-month"><td colspan="4">${m.label}<span class="wo-month-meta">${m.orders.length}건 · 합계 ${CommonUtils.formatCurrency(m.total)}</span></td></tr>`;
            m.orders.forEach(o => {
                const idx = rendered.length;
                rendered.push(o);
                body += `<tr data-idx="${idx}">` +
                    `<td class="wo-date">${fmtDate(o.date)}</td>` +
                    `<td>${esc(o.agency)}</td>` +
                    `<td>${esc(o.supplier)}</td>` +
                    `<td class="wo-amt">${CommonUtils.formatCurrency(o.amount)}</td>` +
                    '</tr>';
            });
        });

        container.innerHTML =
            '<table class="wo-table">' +
            '<colgroup><col class="wo-c-date"><col class="wo-c-agency"><col class="wo-c-supplier"><col class="wo-c-amt"></colgroup>' +
            '<thead><tr><th>날짜</th><th>수요기관</th><th>업체</th><th class="wo-amt">금액</th></tr></thead>' +
            `<tbody>${body}</tbody></table>`;
    }

    function onRowClick(e) {
        const tr = e.target.closest('tr[data-idx]');
        if (!tr) return;
        const o = rendered[Number(tr.dataset.idx)];
        if (o) showOrderPopup(o);
    }

    // 인쇄 — 이 탭은 세로 리스트라 페이지 공통 @page(landscape)를 세로로 덮어씀(인쇄 후 원복)
    function doPrint() {
        const style = document.createElement('style');
        style.id = 'wo-print-orientation';
        style.textContent = '@media print { @page { size: A4 portrait; margin: 1.2cm; } }';
        document.head.appendChild(style);
        const cleanup = () => {
            const s = document.getElementById('wo-print-orientation');
            if (s) s.remove();
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
        // afterprint 미지원 브라우저 폴백
        setTimeout(cleanup, 3000);
    }

    // 계약 상세 팝업 (agency-purchase.js showContractItemsPopup 동일 로직)
    function showOrderPopup(o) {
        const items = Array.isArray(o.lineItems) ? o.lineItems : [];
        let html = `<p class="text-sm text-gray-600 mb-3"><span class="font-medium">${esc(o.agency)}</span> · ${esc(o.supplier)} · 총 ${items.length}개 라인 · 합계 ${CommonUtils.formatCurrency(o.amount)}</p>`;
        if (items.length === 0) {
            html += '<p class="text-center text-gray-500 py-4">이 주문에는 등록된 품목 정보가 없습니다.</p>';
        } else {
            html += '<div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="bg-gray-50"><tr>' +
                '<th class="p-2">모델</th><th class="p-2">규격</th><th class="p-2 text-right">수량</th><th class="p-2 text-right">단가</th><th class="p-2 text-right">합계액</th>' +
                '</tr></thead><tbody>';
            [...items].sort((a, b) => (b.amount || 0) - (a.amount || 0)).forEach(line => {
                const { model, spec, raw } = CommonUtils.parseProductIdentName(line.fullProductName);
                const specCell = (spec === '-' && raw) ? `<span class="text-gray-500" title="원본">${esc(raw)}</span>` : esc(spec);
                html += `<tr class="border-b"><td class="p-2 whitespace-nowrap">${esc(model)}</td><td class="p-2">${specCell}</td>` +
                    `<td class="p-2 text-right">${CommonUtils.formatNumber(line.quantity) || '-'}</td>` +
                    `<td class="p-2 text-right">${line.unitPrice ? CommonUtils.formatCurrency(line.unitPrice) : '-'}</td>` +
                    `<td class="p-2 text-right font-medium">${CommonUtils.formatCurrency(line.amount)}</td></tr>`;
            });
            html += '</tbody></table></div>';
        }
        CommonUtils.showModal(`'${esc(o.contractName || '주문')}' 품목 상세 내역`, html, { width: '900px' });
    }

    // 월별 버킷 — 최신 월 먼저, 월 내부도 최신순
    function bucketByMonth(list) {
        const map = new Map();
        list.forEach(o => {
            const ym = String(o.date).slice(0, 7);   // YYYY-MM
            let m = map.get(ym);
            if (!m) { m = { ym, orders: [], total: 0 }; map.set(ym, m); }
            m.orders.push(o);
            m.total += o.amount;
        });
        const months = [...map.values()];
        months.sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : 0));
        months.forEach(m => {
            m.orders.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
            const p = m.ym.split('-');
            m.label = p.length === 2 ? `${p[0]}년 ${Number(p[1])}월` : m.ym;
        });
        return months;
    }

    function fmtDate(dateStr) {
        const p = String(dateStr).split('-');
        return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : dateStr;
    }

    window.__mWeekly = { init };
})();

/* =========================================================================
 * 탭 5: 가격 경쟁력 — 종합쇼핑몰 '등록가' 기준으로 두발로의 시장 내 위치 산출
 *
 *  왜 등록가인가: 실거래가는 2단계경쟁·수의계약 할인이 섞여 같은 제품도 크게 널뛴다.
 *  수요기관이 쇼핑몰에서 비교하며 보는 값이자 우리가 직접 조정하는 레버는 '등록가'다.
 *
 *  단가는 원/m 그대로 쓴다(㎡ 환산 없음). 조달은 m 단위로 계약·거래되고,
 *  규격이 같으면 폭도 같으므로 원/m 직접 비교가 정확하다.
 *
 *  데이터 2종을 모델코드로 조인:
 *   - 등록가  /api/mall (getShoppingMallPrdctInfoList) — 버튼으로 온디맨드 갱신
 *   - 실거래  이미 4탭이 공유하는 조달 데이터 → 누적 판매액·거래건수
 *
 *  ⚠️ 등록가 API 주의: 품목 필터는 '세부품명 한글 문자열'(dtilPrdctClsfcNoNm)이다.
 *     숫자 코드(dtilPrdctClsfcNo)는 조용히 무시된다(실거래 API와 반대).
 *     조회 기간은 1년 초과 시 거부 → 연도별로 나눠 호출한다.
 * ========================================================================= */
(function () {
    const DUBALLO_BIZNO = '7698601460';        // 두발로 주식회사 (769-86-01460)
    const TARGET_PRODUCT = '보행매트';
    const CACHE_KEY = 'mallRegPrices_v1';
    const YEARS_BACK = 2;                      // 올해 포함 3개년 (계약기간이 1~2년이라 충분)
    const SPEC_RE = /^(\d+)\s*[×xX]\s*t(\d+)\s*mm$/;

    let root, hub;
    let salesByModel = new Map();   // 물품식별번호 → { total:{amount,count}, byYear: Map(연도 → {amount,count}) }
    let salesYears = [];            // 실거래에 존재하는 연도 (내림차순)
    let reg = [];                   // 현재 유효한 등록가 레코드
    let ranking = [];
    let chart = null;
    // 표 정렬 상태. 순위 컬럼은 항상 '등록가 오름차순 순위'로 고정하고(이 탭의 주제),
    // 정렬은 화면 표시 순서만 바꾼다.
    let sortState = { key: 'price', dir: 'asc' };

    const $id = id => root.querySelector('#' + id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = v => Number(CommonUtils.parseSignedAmount(v)) || 0;
    const won = n => CommonUtils.formatNumber(Math.round(n)) + '원';
    const eok = n => n >= 100000000 ? (n / 100000000).toFixed(1) + '억' : (n >= 10000 ? Math.round(n / 10000).toLocaleString('ko-KR') + '만' : String(Math.round(n)));
    const splitIdent = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
    // 조인·식별 키 = 물품식별번호. 같은 업체가 같은 규격에 여러 모델을 등록하는 경우가 실제로 있어
    // (예: 1000×t35mm 2종 이상) 업체나 모델명으로 묶으면 서로 다른 상품이 뭉개진다.
    const idntKey = v => String(v || '').trim();

    function median(arr) {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const n = s.length;
        return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    }
    const todayStr = () => {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    };

    function init(rootEl, rawData, hubRef) {
        root = rootEl; hub = hubRef;
        try {
            salesByModel = buildSalesIndex(rawData);
            populateYears();
            $id('pcRefresh').addEventListener('click', refresh);
            ['pcYear', 'pcThickness', 'pcWidth', 'pcType'].forEach(id => $id(id).addEventListener('change', render));
            $id('pcTableWrap').addEventListener('click', onRowClick);
            $id('pcPrint').addEventListener('click', () => window.print());

            const cached = loadCache();
            if (cached) { reg = cached.items; showStamp(cached.ts); populateFilters(); render(); }
            else showEmpty('등록가를 아직 불러오지 않았습니다. [등록가 갱신]을 누르세요.');
        } catch (error) {
            console.error('가격 경쟁력 초기화 실패:', error);
            CommonUtils.showAlert(`가격 경쟁력 오류: ${error.message}`, 'error');
        }
    }

    // 실거래(조달 B소스) → 물품식별번호별 누적 판매액·거래건수 (전체 + 연도별)
    // 등록가는 '현재 유효한 계약'이라 연도와 무관하므로 연도 선택은 이 집계 범위만 바꾼다.
    function buildSalesIndex(rawData) {
        const map = new Map();
        const years = new Set();
        let noIdnt = 0;
        (rawData || []).forEach(r => {
            if ((r['세부품명'] || '').trim() !== TARGET_PRODUCT) return;
            const k = idntKey(r['물품식별번호']);
            if (!k) { noIdnt++; return; }
            let c = map.get(k);
            if (!c) { c = { total: { amount: 0, count: 0 }, byYear: new Map() }; map.set(k, c); }
            const amt = num(r['공급금액']);
            c.total.amount += amt;
            c.total.count += 1;
            const y = String(r['기준일자'] || '').trim().slice(0, 4);
            if (/^\d{4}$/.test(y)) {
                years.add(y);
                let cy = c.byYear.get(y);
                if (!cy) { cy = { amount: 0, count: 0 }; c.byYear.set(y, cy); }
                cy.amount += amt;
                cy.count += 1;
            }
        });
        salesYears = [...years].sort((a, b) => b.localeCompare(a));
        console.log(`[가격 경쟁력] 실거래 물품식별번호 ${map.size}종 · 연도 ${salesYears.join(',')}${noIdnt ? ` (식별번호 결손 ${noIdnt}행 제외)` : ''}`);
        return map;
    }

    // 선택 연도 기준 판매 집계. 'all'이면 전체 누적.
    function salesOf(key) {
        const c = salesByModel.get(key);
        if (!c) return { amount: 0, count: 0 };
        const y = $id('pcYear').value;
        if (!y || y === 'all') return c.total;
        return c.byYear.get(y) || { amount: 0, count: 0 };
    }
    const yearLabel = () => {
        const y = $id('pcYear').value;
        return (!y || y === 'all') ? '전체 기간' : `${y}년`;
    };

    function populateYears() {
        const sel = $id('pcYear');
        sel.innerHTML = `<option value="all">전체(누적)</option>`
            + salesYears.map(y => `<option value="${esc(y)}">${esc(y)}년</option>`).join('');
    }

    // ---- 등록가 수집 (버튼) ----
    async function refresh() {
        const btn = $id('pcRefresh');
        btn.disabled = true;
        const label = btn.textContent;
        try {
            const year = new Date().getFullYear();
            const items = [];
            for (let y = year - YEARS_BACK; y <= year; y++) {
                btn.textContent = `${y}년 조회 중…`;
                const first = await fetchMall(y, 1);
                if (!first) continue;
                items.push(...(first.items || []));
                const pages = Math.ceil(Number(first.totalCount || 0) / 999);
                for (let p = 2; p <= pages; p++) {
                    const b = await fetchMall(y, p);
                    if (b && b.items) items.push(...b.items);
                }
            }
            if (!items.length) throw new Error('등록가를 한 건도 받지 못했습니다.');
            reg = normalize(items);
            const ts = Date.now();
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts, items: reg })); } catch (e) {}
            showStamp(ts);
            populateFilters();
            render();
        } catch (e) {
            console.error('등록가 갱신 실패:', e);
            CommonUtils.showAlert('등록가 갱신 실패: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = label;
        }
    }

    async function fetchMall(year, pageNo) {
        const url = `/api/mall?itemName=${encodeURIComponent(TARGET_PRODUCT)}&bgnDate=${year}0101&endDate=${year}1231&pageNo=${pageNo}`;
        const res = await fetch(url, { cache: 'no-store' });
        const json = await res.json();
        const head = json?.response?.header;
        if (head && head.resultCode !== '00') {
            console.warn(`[등록가 ${year} p${pageNo}] ${head.resultMsg}`);
            return null;
        }
        return json?.response?.body || null;
    }

    // 원본 → 현재 유효한 매트만 남기고 규격 파싱 (부품·만료계약 제외, 업체+모델 최신 1건)
    function normalize(items) {
        const today = todayStr();
        const best = new Map();
        items.forEach(i => {
            const spec = String(i.prdctSpecNm || '');
            if (spec.includes('(부품)')) return;                       // 고정핀 = 단위 '개'
            if (String(i.cntrctEndDate || '') < today) return;         // 만료 계약
            const p = splitIdent(spec);
            const m = p.length >= 4 ? String(p[3]).match(SPEC_RE) : null;
            if (!m) return;
            const price = Number(i.cntrctPrceAmt) || 0;
            if (price <= 0) return;
            const k = idntKey(i.prdctIdntNo);
            if (!k) return;
            const prev = best.get(k);
            if (prev && prev.bgn >= String(i.cntrctBgnDate || '')) return;   // 같은 상품의 갱신분만 채택
            best.set(k, {
                key: k,
                idnt: k,
                corp: (i.cntrctCorpNm || '').trim(),
                bizno: String(i.cntrctCorpBizno || '').replace(/[^\d]/g, ''),
                model: p[2],
                width: Number(m[1]),
                thickness: Number(m[2]),
                type: p[4] || '(미표기)',
                price,
                unit: (i.prdctUnit || 'm').trim(),
                bgn: String(i.cntrctBgnDate || ''),
                end: String(i.cntrctEndDate || '')
            });
        });
        const out = [...best.values()];
        console.log(`[가격 경쟁력] 등록가 ${items.length}건 → 현재 유효 매트 ${out.length}건 / 업체 ${new Set(out.map(r => r.bizno)).size}곳`);
        return out;
    }

    function loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const o = JSON.parse(raw);
            return (o && Array.isArray(o.items) && o.items.length) ? o : null;
        } catch (e) { return null; }
    }
    function showStamp(ts) {
        const d = new Date(ts);
        $id('pcStamp').textContent = `등록가 기준 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 갱신 · 현재 유효한 계약만`;
    }
    function showEmpty(msg) {
        $id('pcSummary').innerHTML = `<div class="pc-empty">${esc(msg)}</div>`;
        $id('pcTableWrap').innerHTML = '';
        $id('pcChartWrap').classList.add('hidden');
    }

    function populateFilters() {
        const fill = (id, vals, fmt, all) => {
            const sel = $id(id), prev = sel.value;
            sel.innerHTML = (all ? `<option value="all">${all}</option>` : '')
                + vals.map(v => `<option value="${esc(String(v))}">${esc(fmt(v))}</option>`).join('');
            if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
        };
        // ⚠️ 두께·폭은 '전체' 없이 반드시 고정한다. 단가가 원/m이라 폭이 다르면 비교 자체가 성립 안 됨
        //    (600mm 17,500원과 2000mm 45,000원을 한 줄로 세우면 폭 작은 제품이 싼 것처럼 보인다).
        fill('pcThickness', [...new Set(reg.map(r => r.thickness))].sort((a, b) => a - b), t => t + 't', null);
        fill('pcWidth', [...new Set(reg.map(r => r.width))].sort((a, b) => a - b), w => w + 'mm', null);
        fill('pcType', [...new Set(reg.map(r => r.type))].sort(), t => t, '전체');

        // 최초 1회만 기본값 지정 = 표본이 가장 많은 조합
        if (!$id('pcThickness').dataset.touched) {
            const top = (keyFn) => {
                const c = {}; reg.forEach(r => { c[keyFn(r)] = (c[keyFn(r)] || 0) + 1; });
                return Object.keys(c).sort((a, b) => c[b] - c[a])[0];
            };
            const t = top(r => r.thickness); if (t) $id('pcThickness').value = t;
            const w = top(r => r.width); if (w) $id('pcWidth').value = w;
        }
    }

    function render() {
        if (!reg.length) return;
        const th = $id('pcThickness').value;
        const width = $id('pcWidth').value;
        const type = $id('pcType').value;
        $id('pcThickness').dataset.touched = '1';

        const g = reg.filter(r => String(r.thickness) === String(th)
            && String(r.width) === String(width)
            && (type === 'all' || r.type === type));

        const ctx = `${width}×t${th}mm · ${type === 'all' ? '종류 전체' : type}`;

        if (g.length < 3) { showEmpty(`${ctx} — 등록 상품이 ${g.length}개뿐이라 비교하지 않습니다.`); return; }
        $id('pcChartWrap').classList.remove('hidden');

        // 순위는 등록가 오름차순으로 먼저 확정한다(정렬을 바꿔도 순위 번호는 그대로).
        ranking = g.map(r => {
            const s = salesOf(r.key);
            return { ...r, dub: r.bizno === DUBALLO_BIZNO, amount: s.amount, count: s.count };
        }).sort((a, b) => a.price - b.price).map((r, i) => ({ ...r, rank: i + 1 }));
        applySort();

        const prices = ranking.map(r => r.price);
        const mktMed = median(prices);
        const me = ranking.find(r => r.dub);

        renderSummary(ctx, mktMed, me, ranking.length);
        renderTable();
        renderChart(me, mktMed);
    }

    function renderSummary(ctx, mktMed, me, n) {
        const card = (label, value, sub, cls) =>
            `<div class="pc-card"><div class="pc-card-label">${esc(label)}</div>
             <div class="pc-card-value ${cls}">${esc(value)}</div>
             <div class="pc-card-sub">${esc(sub)}</div></div>`;
        let cards;
        if (me) {
            const gap = (me.price / mktMed - 1) * 100;
            cards = card('두발로 등록가', won(me.price) + '/m', me.model, 'text-gray-900')
                + card('시장 중위 대비', (gap > 0 ? '+' : '') + gap.toFixed(1) + '%', `시장 중위 ${won(mktMed)}/m`, gap <= 0 ? 'text-blue-600' : 'text-red-600')
                + card('등록가 순위', `${me.rank}위 / ${n}개 상품`, `${yearLabel()} 판매 ${eok(me.amount)}원 · ${me.count}건`, 'text-gray-900');
        } else {
            cards = card('두발로 등록가', '해당 규격 없음', ctx, 'text-gray-400')
                + card('시장 중위', won(mktMed) + '/m', `${n}개 상품`, 'text-gray-900')
                + card('최저', won(Math.min(...ranking.map(r => r.price))) + '/m', ranking[0].corp, 'text-gray-900');
        }
        const corps = new Set(ranking.map(r => r.bizno)).size;
        $id('pcSummary').innerHTML =
            `<div class="pc-ctx">${esc(ctx)} · 등록 ${n}개 상품 / ${corps}개사 · <strong>종합쇼핑몰 등록가(원/m)</strong> 기준, 판매액·거래건수는 실거래(물품식별번호 조인) <strong>${esc(yearLabel())}</strong></div>
             <div class="pc-cards">${cards}</div>`;
    }

    // ---- 표 정렬 ----
    const SORT_COLS = [
        { key: 'rank', label: '순위', cls: 'pc-rank', type: 'number' },
        { key: 'corp', label: '업체', cls: '', type: 'string' },
        { key: 'model', label: '모델', cls: '', type: 'string' },
        { key: 'price', label: '등록가(원/m)', cls: 'pc-num', type: 'number' },
        { key: 'amount', label: '판매액', cls: 'pc-num', type: 'number' },
        { key: 'count', label: '거래건수', cls: 'pc-num', type: 'number' }
    ];

    function applySort() {
        const col = SORT_COLS.find(c => c.key === sortState.key) || SORT_COLS[0];
        const sign = sortState.dir === 'asc' ? 1 : -1;
        ranking.sort((a, b) => {
            const va = a[col.key], vb = b[col.key];
            const cmp = col.type === 'number'
                ? (Number(va) || 0) - (Number(vb) || 0)
                : String(va || '').localeCompare(String(vb || ''), 'ko');
            return cmp ? cmp * sign : (a.rank - b.rank);   // 동점은 항상 등록가 순위순
        });
    }

    function onHeadClick(th) {
        const key = th.dataset.sortKey;
        if (!key) return;
        if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        // 숫자 컬럼은 '큰 값부터'가 기본(등록가만 싼 순이 기본), 업체·모델은 가나다순
        else sortState = { key, dir: (key === 'amount' || key === 'count') ? 'desc' : 'asc' };
        applySort();
        renderTable();
    }

    function renderTable() {
        const rows = ranking.map(c => `
            <tr data-key="${esc(c.key)}"${c.dub ? ' class="pc-me"' : ''}>
                <td class="pc-rank">${c.rank}</td>
                <td>${c.dub ? '★ ' : ''}${esc(c.corp)}</td>
                <td class="pc-muted">${esc(c.model)}</td>
                <td class="pc-num pc-strong">${won(c.price)}</td>
                <td class="pc-num">${c.amount ? eok(c.amount) + '원' : '-'}</td>
                <td class="pc-num">${c.count ? CommonUtils.formatNumber(c.count) : '-'}</td>
            </tr>`).join('');
        const heads = SORT_COLS.map(col => {
            const mark = sortState.key === col.key ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const label = col.key === 'amount' ? `${yearLabel() === '전체 기간' ? '누적 ' : ''}판매액` : col.label;
            return `<th class="pc-sortable ${col.cls}" data-sort-key="${col.key}">${esc(label)}${mark}</th>`;
        }).join('');
        const sorted = SORT_COLS.find(c => c.key === sortState.key) || SORT_COLS[0];
        $id('pcTableWrap').innerHTML = `
            <table class="pc-table">
                <thead><tr>${heads}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="pc-note">순위는 등록가 싼 순 고정 · 현재 정렬 ${esc(sorted.label)} ${sortState.dir === 'asc' ? '오름차순' : '내림차순'}(머리글 클릭) · 판매액·거래건수는 ${esc(yearLabel())} 실거래 합계 · 행 클릭 시 그 업체의 전 규격 등록가</div>`;
    }

    function renderChart(me, mktMed) {
        const prices = ranking.map(r => r.price);
        const lo = Math.min(...prices), hi = Math.max(...prices);
        const step = Math.max(500, Math.ceil((hi - lo) / 18 / 500) * 500);
        const base = Math.floor(lo / step) * step;
        const bins = []; for (let x = base; x <= hi; x += step) bins.push(x);
        const counts = bins.map(() => 0);
        prices.forEach(v => { counts[Math.min(bins.length - 1, Math.floor((v - base) / step))]++; });
        const meBin = me ? Math.min(bins.length - 1, Math.floor((me.price - base) / step)) : -1;

        if (chart) chart.destroy();
        chart = new Chart($id('pcChart'), {
            type: 'bar',
            data: {
                labels: bins.map(b => CommonUtils.formatNumber(b)),
                datasets: [{ label: '업체 수', data: counts, borderWidth: 0,
                    backgroundColor: counts.map((_, i) => i === meBin ? '#2563eb' : '#cbd5e1') }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: {
                        title: it => `${CommonUtils.formatNumber(bins[it[0].dataIndex])} ~ ${CommonUtils.formatNumber(bins[it[0].dataIndex] + step)}원/m`,
                        label: it => `${it.parsed.y}개사${it.dataIndex === meBin ? ' (두발로 포함)' : ''}`
                    } }
                },
                scales: {
                    x: { title: { display: true, text: '등록가 구간 (원/m)' }, grid: { display: false } },
                    y: { title: { display: true, text: '업체 수' }, beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    }

    function onRowClick(e) {
        const th = e.target.closest('th[data-sort-key]');
        if (th) { onHeadClick(th); return; }
        const tr = e.target.closest('tr[data-key]');
        if (!tr) return;
        const c = ranking.find(x => x.key === tr.dataset.key);
        if (!c) return;
        const mine = reg.filter(r => r.bizno === c.bizno)
            .sort((a, b) => a.thickness - b.thickness || a.width - b.width);
        const lines = mine.map(r => {
            const s = salesOf(r.key);
            return `<tr${r.key === c.key ? ' style="background:#eff6ff;font-weight:600"' : ''}>
                <td>${esc(r.model)}</td><td>${r.width}×t${r.thickness}mm</td><td>${esc(r.type)}</td>
                <td class="pc-muted">${esc(r.idnt)}</td>
                <td style="text-align:right">${won(r.price)}</td>
                <td style="text-align:right">${s.amount ? eok(s.amount) + '원' : '-'}</td>
                <td style="text-align:right">${s.count || '-'}</td></tr>`;
        }).join('');
        CommonUtils.showModal(`${c.corp} — 등록 ${mine.length}종 · 계약 ${c.bgn.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}~${c.end.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}`, `
            <table class="pc-modal-table">
                <thead><tr><th>모델</th><th>규격</th><th>종류</th><th>물품식별번호</th>
                <th style="text-align:right">등록가(원/m)</th><th style="text-align:right">${esc(yearLabel())} 판매액</th><th style="text-align:right">거래건수</th></tr></thead>
                <tbody>${lines}</tbody>
            </table>`, { width: '860px' });
    }

    window.__mPrice = { init };
})();

/* =========================================================================
 * 오케스트레이터 — 상위 탭 전환 + B소스 1회 로드 + 지연 init + cross-link 허브
 * ========================================================================= */
(function () {
    const Hub = window.MarketHub = {};
    let rawProcurement = null;
    let dataPromise = null;
    const loaded = { agencyTab: false, supplierTab: false, trendTab: false, weeklyOrderTab: false, priceTab: false };

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
        ['agencyTab', 'supplierTab', 'trendTab', 'weeklyOrderTab', 'priceTab'].forEach(id => {
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
            else if (tab === 'weeklyOrderTab') window.__mWeekly.init(root, rawProcurement, Hub);
            else if (tab === 'priceTab') window.__mPrice.init(root, rawProcurement, Hub);
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
