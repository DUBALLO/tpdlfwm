// agency-purchase.js
// 수요기관 구매 분석 대시보드
// - 랭킹: 순액 기준
// - 0원 기관: 기본 제외, 검색 시 포함
// - 상세 계약: 계약명/품목/계약차수 기준 요약
// - 최신 반영일자 자동 표시

let allData = [];               // 전체 raw 데이터
let currentFilteredData = [];   // 현재 필터가 적용된 raw 데이터
let currentRankData = [];       // 랭킹용 집계 데이터
let chartInstance = null;

let selectedAgencyName = '';

const sortStates = {
    rank: { key: 'totalAmount', direction: 'desc' },
    purchase: { key: 'amount', direction: 'desc' },
    contract: { key: 'netAmount', direction: 'desc' }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        showLoadingState(true, '데이터를 불러오는 중...');
        ensureLatestAppliedDateElement();
        ensureResultLayout();

        await waitForDependencies();
        await loadAndParseData();

        populateFilters();
        attachEventListeners();
        runAnalysis();
    } catch (error) {
        console.error('[agency-purchase] 초기화 오류:', error);
        showGlobalError(`데이터를 불러오지 못했습니다. ${error.message || error}`);
    } finally {
        showLoadingState(false);
    }
});

async function waitForDependencies(maxWaitMs = 10000) {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
        if (window.sheetsAPI) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error('sheetsAPI가 로드되지 않았습니다.');
}

async function loadAndParseData() {
    const rawRows = await window.sheetsAPI.loadAllProcurementData();

    if (!Array.isArray(rawRows)) {
        throw new Error('조달 데이터 형식이 올바르지 않습니다.');
    }

    allData = rawRows
        .map((row, index) => normalizeProcurementRow(row, index))
        .filter(row =>
            row &&
            row.supplier === '두발로 주식회사' &&
            row.agency &&
            row.date &&
            row.contractName
        );

    currentFilteredData = [...allData];

    console.log('[agency-purchase] 전체 raw 건수:', allData.length);
    console.table(allData.slice(0, 20));
}

function normalizeProcurementRow(row, index = 0) {
    const agency =
        pickFirst(row, ['수요기관명', 'agency', 'customer']) || '';

    const regionRaw =
        pickFirst(row, ['수요기관지역', 'region']) || '';

    const agencyType =
        pickFirst(row, ['소관구분', 'agencyType']) || '';

    const supplier =
        pickFirst(row, ['업체', 'supplier']) || '';

    const product =
        pickFirst(row, ['세부품명', 'product']) || '';

    const contractName =
        pickFirst(row, ['계약명', 'contractName', 'cntrctDlvrReqNm']) || '';

    const dateRaw =
        pickFirst(row, ['기준일자', 'date', 'contractDate']) || '';

    const contractOrderRaw =
        pickFirst(row, [
            '계약차수',
            '계약변경차수',
            'contractOrder',
            'cntrctDlvrReqChgOrd'
        ]) || '';

    const amountRaw =
        pickFirst(row, [
            '공급금액',
            'amount',
            'prdctAmt',
            'incdecAmt',
            'orderCalclPrceAmt',
            'cntrctPrceAmt',
            'suplyAmt'
        ]) || '0';

    const date = normalizeDate(dateRaw);
    const amount = parseSignedAmount(amountRaw);

    const { region, city } = splitRegionCity(regionRaw);

    return {
        id: `row_${index}_${date}_${agency}_${contractName}_${product}_${amount}`,
        agency: String(agency).trim(),
        region: String(region).trim(),
        city: String(city).trim(),
        agencyType: String(agencyType).trim(),
        supplier: String(supplier).trim(),
        product: String(product).trim(),
        contractName: String(contractName).trim(),
        contractOrder: parseContractOrder(contractOrderRaw),
        date,
        amount,
        originalRow: row
    };
}

function pickFirst(obj, keys) {
    for (const key of keys) {
        const value = obj?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value;
        }
    }
    return '';
}

function parseSignedAmount(value) {
    const num = String(value ?? '0').replace(/[^\d.-]/g, '');
    const parsed = Number(num || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const digits = raw.replace(/[^\d]/g, '');
    if (digits.length >= 8) {
        return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }

    return raw;
}

function splitRegionCity(regionRaw) {
    const text = String(regionRaw || '').trim();
    if (!text) {
        return { region: '', city: '' };
    }

    const parts = text.split(/\s+/).filter(Boolean);
    const region = parts[0] || '';
    const city = parts.length > 1 ? parts.slice(1).join(' ') : region;

    return { region, city };
}

function parseContractOrder(value) {
    const text = String(value || '').trim();
    if (!text) return '기본';

    const match = text.match(/(\d+)\s*차/);
    if (match) return `${match[1]}차`;

    if (/최종/i.test(text)) return '최종';
    return text;
}

function populateFilters() {
    populateYearFilter();
    populateProductFilter();
    populateRegionFilter();
    populateAgencyTypeFilter();
    populateCityFilter();
}

function populateYearFilter() {
    const el = document.getElementById('analysisYear');
    if (!el) return;

    const years = [...new Set(allData.map(row => (row.date || '').slice(0, 4)).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a));

    const currentValue = el.value;

    el.innerHTML = `
        <option value="">전체</option>
        ${years.map(year => `<option value="${escapeHtml(year)}">${escapeHtml(year)}년</option>`).join('')}
    `;

    if (years.includes(currentValue)) {
        el.value = currentValue;
    } else if (years.length) {
        el.value = years[0];
    }
}

function populateProductFilter() {
    const el = document.getElementById('productFilter');
    if (!el) return;

    const items = [...new Set(allData.map(row => row.product).filter(Boolean))].sort();

    const currentValue = el.value;
    el.innerHTML = `
        <option value="">전체</option>
        ${items.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('')}
    `;

    if (items.includes(currentValue)) {
        el.value = currentValue;
    }
}

function populateRegionFilter() {
    const el = document.getElementById('regionFilter');
    if (!el) return;

    const regions = [...new Set(allData.map(row => row.region).filter(Boolean))].sort();

    const currentValue = el.value;
    el.innerHTML = `
        <option value="">전체</option>
        ${regions.map(region => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join('')}
    `;

    if (regions.includes(currentValue)) {
        el.value = currentValue;
    }
}

function populateAgencyTypeFilter() {
    const el = document.getElementById('agencyTypeFilter');
    if (!el) return;

    const types = [...new Set(allData.map(row => row.agencyType).filter(Boolean))].sort();

    const currentValue = el.value;
    el.innerHTML = `
        <option value="">전체</option>
        ${types.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')}
    `;

    if (types.includes(currentValue)) {
        el.value = currentValue;
    }
}

function populateCityFilter() {
    const region = document.getElementById('regionFilter')?.value || '';
    const cityEl = document.getElementById('cityFilter');
    if (!cityEl) return;

    const cities = [...new Set(
        allData
            .filter(row => !region || row.region === region)
            .map(row => row.city)
            .filter(Boolean)
    )].sort();

    const currentValue = cityEl.value;

    cityEl.innerHTML = `
        <option value="">전체</option>
        ${cities.map(city => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`).join('')}
    `;

    if (cities.includes(currentValue)) {
        cityEl.value = currentValue;
    }
}

function attachEventListeners() {
    document.getElementById('regionFilter')?.addEventListener('change', () => {
        populateCityFilter();
    });

    document.getElementById('analysisYear')?.addEventListener('change', runAnalysis);
    document.getElementById('productFilter')?.addEventListener('change', runAnalysis);
    document.getElementById('regionFilter')?.addEventListener('change', runAnalysis);
    document.getElementById('cityFilter')?.addEventListener('change', runAnalysis);
    document.getElementById('agencyTypeFilter')?.addEventListener('change', runAnalysis);

    document.getElementById('agencySearchInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            runAnalysis();
        }
    });

    document.getElementById('analyzeBtn')?.addEventListener('click', runAnalysis);

    bindSortEvents();
    bindActionButtons();
}

function bindSortEvents() {
    document.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;

        const table = th.closest('table');
        const key = th.dataset.sort;

        if (!table || !key) return;

        if (table.id === 'agencyRankTable') {
            toggleSort('rank', key);
            renderAgencyRankPanel(currentRankData);
        } else if (table.id === 'purchaseDetailTable') {
            if (!selectedAgencyName) return;
            toggleSort('purchase', key);
            const agencyRows = currentFilteredData.filter(row => row.agency === selectedAgencyName);
            renderPurchaseDetail(agencyRows);
        } else if (table.id === 'contractDetailTable') {
            if (!selectedAgencyName) return;
            toggleSort('contract', key);
            const agencyRows = currentFilteredData.filter(row => row.agency === selectedAgencyName);
            renderContractDetail(agencyRows);
        }
    });
}

function bindActionButtons() {
    document.addEventListener('click', (e) => {
        const exportBtn = e.target.closest('[data-action="export-csv"]');
        const printBtn = e.target.closest('[data-action="print-panel"]');
        const agencyBtn = e.target.closest('[data-agency-name]');

        if (agencyBtn) {
            const agencyName = agencyBtn.getAttribute('data-agency-name');
            if (agencyName) {
                showAgencyDetail(agencyName);
            }
            return;
        }

        if (exportBtn) {
            const tableId = exportBtn.getAttribute('data-table-id');
            const filename = exportBtn.getAttribute('data-filename') || 'export.csv';
            exportTableToCSV(tableId, filename);
            return;
        }

        if (printBtn) {
            const panelId = printBtn.getAttribute('data-panel-id');
            printPanel(panelId);
        }
    });
}

function toggleSort(scope, key) {
    const state = sortStates[scope];
    if (!state) return;

    if (state.key === key) {
        state.direction = state.direction === 'asc' ? 'desc' : 'asc';
    } else {
        state.key = key;
        state.direction = (scope === 'rank' || key.includes('Amount')) ? 'desc' : 'asc';
    }
}

function runAnalysis() {
    const year = document.getElementById('analysisYear')?.value || '';
    const product = document.getElementById('productFilter')?.value || '';
    const region = document.getElementById('regionFilter')?.value || '';
    const city = document.getElementById('cityFilter')?.value || '';
    const agencyType = document.getElementById('agencyTypeFilter')?.value || '';
    const keyword = (document.getElementById('agencySearchInput')?.value || '').trim();

    currentFilteredData = allData.filter(row => {
        if (year && !String(row.date || '').startsWith(year)) return false;
        if (product && row.product !== product) return false;
        if (region && row.region !== region) return false;
        if (city && row.city !== city) return false;
        if (agencyType && row.agencyType !== agencyType) return false;
        if (keyword && !String(row.agency || '').includes(keyword)) return false;
        return true;
    });

    const includeZero = !!keyword;
    currentRankData = buildAgencyRankData(currentFilteredData, includeZero);

    renderAgencyRankPanel(currentRankData);
    updateLatestAppliedDate(currentFilteredData);

    if (selectedAgencyName) {
        const agencyExists = currentFilteredData.some(row => row.agency === selectedAgencyName);
        if (agencyExists) {
            showAgencyDetail(selectedAgencyName);
        } else {
            clearDetailPanels();
        }
    }
}

function buildAgencyRankData(rows, includeZero = false) {
    const map = new Map();

    rows.forEach(row => {
        const key = row.agency || '';
        if (!key) return;

        if (!map.has(key)) {
            map.set(key, {
                agency: row.agency,
                region: row.region,
                city: row.city,
                agencyType: row.agencyType,
                totalAmount: 0,
                contractCount: 0,
                suppliers: new Set()
            });
        }

        const item = map.get(key);
        item.totalAmount += Number(row.amount || 0);
        item.contractCount += 1;
        if (row.supplier) item.suppliers.add(row.supplier);
    });

    let result = Array.from(map.values()).map(item => ({
        agency: item.agency,
        region: item.region,
        city: item.city,
        agencyType: item.agencyType,
        totalAmount: item.totalAmount,
        contractCount: item.contractCount,
        supplierCount: item.suppliers.size
    }));

    if (!includeZero) {
        result = result.filter(item => Number(item.totalAmount || 0) !== 0);
    }

    return sortData(result, sortStates.rank.key, sortStates.rank.direction);
}

function renderAgencyRankPanel(data) {
    const table = document.getElementById('agencyRankTable');
    if (!table) return;

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th style="width:70px;">순위</th>
                <th data-sort="agency">수요기관명</th>
                <th data-sort="region">지역</th>
                <th data-sort="agencyType">소관구분</th>
                <th data-sort="contractCount" class="text-center">건수</th>
                <th data-sort="supplierCount" class="text-center">공급사수</th>
                <th data-sort="totalAmount" class="text-end">순매출액</th>
            </tr>
        `;
    }

    if (!tbody) return;

    if (!data.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-4">조건에 맞는 데이터가 없습니다.</td>
            </tr>
        `;
        updateSortIndicators('agencyRankTable', sortStates.rank);
        return;
    }

    tbody.innerHTML = data.map((row, index) => `
        <tr class="agency-row" style="cursor:pointer;" data-agency-name="${escapeHtml(row.agency)}">
            <td>${index + 1}</td>
            <td>
                <button
                    type="button"
                    class="btn btn-link p-0 text-decoration-none"
                    data-agency-name="${escapeHtml(row.agency)}"
                    style="font-weight:600;"
                >
                    ${escapeHtml(row.agency)}
                </button>
            </td>
            <td>${escapeHtml(row.region || '-')}</td>
            <td>${escapeHtml(row.agencyType || '-')}</td>
            <td class="text-center">${Number(row.contractCount || 0).toLocaleString('ko-KR')}</td>
            <td class="text-center">${Number(row.supplierCount || 0).toLocaleString('ko-KR')}</td>
            <td class="text-end ${row.totalAmount < 0 ? 'text-danger' : ''}">${formatCurrency(row.totalAmount)}</td>
        </tr>
    `).join('');

    updateSortIndicators('agencyRankTable', sortStates.rank);

    renderRankSummary(data);
}

function renderRankSummary(data) {
    const totalAgencyCountEl = document.getElementById('totalAgencyCount');
    const totalAmountEl = document.getElementById('totalAgencyAmount');

    const totalAgencyCount = data.length;
    const totalAmount = data.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);

    if (totalAgencyCountEl) {
        totalAgencyCountEl.textContent = `${totalAgencyCount.toLocaleString('ko-KR')}개 기관`;
    }

    if (totalAmountEl) {
        totalAmountEl.textContent = formatCurrency(totalAmount);
    }
}

function showAgencyDetail(agencyName) {
    selectedAgencyName = agencyName;

    const agencyRows = currentFilteredData.filter(row => row.agency === agencyName);

    console.log('[기관 상세 raw]', agencyName, agencyRows.length, agencyRows.slice(0, 20));

    renderDetailTitle(agencyName, agencyRows);
    renderPurchaseDetail(agencyRows);
    renderContractDetail(agencyRows);
    renderTrendDetail(agencyRows, agencyName);
}

function renderDetailTitle(agencyName, rows) {
    const titleEl = document.getElementById('agencyDetailTitle');
    const metaEl = document.getElementById('agencyDetailMeta');

    if (titleEl) {
        titleEl.textContent = `${agencyName} 상세분석`;
    }

    if (metaEl) {
        const netAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        metaEl.textContent = `원본 ${rows.length.toLocaleString('ko-KR')}건 / 순액 ${formatCurrency(netAmount)}`;
    }
}

function renderPurchaseDetail(rows) {
    const table = document.getElementById('purchaseDetailTable');
    if (!table) return;

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const summary = buildSupplierSummary(rows);
    const sortedRows = sortData(summary, sortStates.purchase.key, sortStates.purchase.direction);

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th data-sort="supplier">공급사</th>
                <th data-sort="purchaseCount" class="text-center">건수</th>
                <th data-sort="amount" class="text-end">순매출액</th>
            </tr>
        `;
    }

    if (!sortedRows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="text-center text-muted py-4">구매 상세 데이터가 없습니다.</td>
            </tr>
        `;
        updateSortIndicators('purchaseDetailTable', sortStates.purchase);
        return;
    }

    tbody.innerHTML = sortedRows.map(row => `
        <tr>
            <td>${escapeHtml(row.supplier || '-')}</td>
            <td class="text-center">${Number(row.purchaseCount || 0).toLocaleString('ko-KR')}</td>
            <td class="text-end ${row.amount < 0 ? 'text-danger' : ''}">${formatCurrency(row.amount)}</td>
        </tr>
    `).join('');

    updateSortIndicators('purchaseDetailTable', sortStates.purchase);
}

function buildSupplierSummary(rows) {
    const map = new Map();

    rows.forEach(row => {
        const key = row.supplier || '미상';
        if (!map.has(key)) {
            map.set(key, {
                supplier: key,
                purchaseCount: 0,
                amount: 0
            });
        }

        const item = map.get(key);
        item.purchaseCount += 1;
        item.amount += Number(row.amount || 0);
    });

    return Array.from(map.values());
}

function renderContractDetail(rows) {
    const table = document.getElementById('contractDetailTable');
    if (!table) return;

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const summaryRows = buildContractSummary(rows);
    const sortedRows = sortData(summaryRows, sortStates.contract.key, sortStates.contract.direction);

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th data-sort="date">계약일</th>
                <th data-sort="contractName">계약명</th>
                <th data-sort="product">품목</th>
                <th data-sort="contractOrder">계약차수</th>
                <th data-sort="lineCount" class="text-center">이력건수</th>
                <th data-sort="netAmount" class="text-end">순액</th>
                <th data-sort="status">상태</th>
            </tr>
        `;
    }

    if (!sortedRows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-4">계약 상세 데이터가 없습니다.</td>
            </tr>
        `;
        updateSortIndicators('contractDetailTable', sortStates.contract);
        return;
    }

    tbody.innerHTML = sortedRows.map(row => `
        <tr>
            <td>${escapeHtml(row.date || '-')}</td>
            <td>${escapeHtml(row.contractName || '-')}</td>
            <td>${escapeHtml(row.product || '-')}</td>
            <td>${escapeHtml(row.contractOrder || '-')}</td>
            <td class="text-center">${Number(row.lineCount || 0).toLocaleString('ko-KR')}</td>
            <td class="text-end ${row.netAmount < 0 ? 'text-danger' : ''}">
                ${formatCurrency(row.netAmount)}
            </td>
            <td>${escapeHtml(row.status || '-')}</td>
        </tr>
    `).join('');

    updateSortIndicators('contractDetailTable', sortStates.contract);
}

function buildContractSummary(rows) {
    const map = new Map();

    rows.forEach(row => {
        const contractName = String(row.contractName || '').trim();
        const product = String(row.product || '').trim();
        const contractOrder = parseContractOrder(row.contractOrder);
        const key = [contractName, product, contractOrder].join('||');

        if (!map.has(key)) {
            map.set(key, {
                date: row.date || '',
                contractName,
                product,
                contractOrder,
                netAmount: 0,
                lineCount: 0,
                hasPositive: false,
                hasNegative: false
            });
        }

        const item = map.get(key);
        const amount = Number(row.amount || 0);

        if (row.date && String(row.date) > String(item.date)) {
            item.date = row.date;
        }

        item.netAmount += amount;
        item.lineCount += 1;
        if (amount > 0) item.hasPositive = true;
        if (amount < 0) item.hasNegative = true;
    });

    return Array.from(map.values()).map(item => ({
        ...item,
        status:
            item.netAmount === 0
                ? '취소상쇄'
                : item.hasPositive && item.hasNegative
                    ? '변경'
                    : '정상'
    }));
}

function renderTrendDetail(rows, agencyName) {
    const canvas = document.getElementById('trendChart');
    const summaryEl = document.getElementById('trendSummary');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const yearlyMap = new Map();

    rows.forEach(row => {
        const year = String(row.date || '').slice(0, 4);
        if (!year) return;

        if (!yearlyMap.has(year)) yearlyMap.set(year, 0);
        yearlyMap.set(year, yearlyMap.get(year) + Number(row.amount || 0));
    });

    const years = [...yearlyMap.keys()].sort();
    const values = years.map(year => yearlyMap.get(year));

    if (chartInstance) {
        chartInstance.destroy();
    }

    if (typeof Chart !== 'undefined') {
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: years,
                datasets: [{
                    label: `${agencyName} 연도별 순매출액`,
                    data: values,
                    backgroundColor: '#4e79a7'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => formatCurrency(context.raw)
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: (value) => formatCompactCurrency(value)
                        }
                    }
                }
            }
        });
    }

    if (summaryEl) {
        const total = values.reduce((sum, v) => sum + v, 0);
        const avg = values.length ? total / values.length : 0;

        let peakYear = '-';
        let peakValue = 0;

        years.forEach((year, idx) => {
            if (idx === 0 || values[idx] > peakValue) {
                peakYear = year;
                peakValue = values[idx];
            }
        });

        const latestYear = years[years.length - 1] || '-';
        const latestValue = values[values.length - 1] || 0;

        summaryEl.innerHTML = `
            <div class="trend-summary-box">
                <div><strong>집계 연도 수</strong>: ${years.length.toLocaleString('ko-KR')}년</div>
                <div><strong>연평균</strong>: ${formatCurrency(avg)}</div>
                <div><strong>최고 연도</strong>: ${escapeHtml(peakYear)} (${formatCurrency(peakValue)})</div>
                <div><strong>최근 연도</strong>: ${escapeHtml(latestYear)} (${formatCurrency(latestValue)})</div>
            </div>
        `;
    }
}

function sortData(data, key, direction = 'asc') {
    const cloned = [...data];

    cloned.sort((a, b) => {
        const aValue = a?.[key];
        const bValue = b?.[key];

        const aNum = Number(aValue);
        const bNum = Number(bValue);

        let result = 0;

        if (Number.isFinite(aNum) && Number.isFinite(bNum) && String(aValue).trim() !== '' && String(bValue).trim() !== '') {
            result = aNum - bNum;
        } else {
            result = String(aValue ?? '').localeCompare(String(bValue ?? ''), 'ko');
        }

        return direction === 'asc' ? result : -result;
    });

    return cloned;
}

function updateSortIndicators(tableId, state) {
    const table = document.getElementById(tableId);
    if (!table) return;

    table.querySelectorAll('th[data-sort]').forEach(th => {
        const key = th.getAttribute('data-sort');
        const baseText = th.textContent.replace(/[▲▼]/g, '').trim();

        if (key === state.key) {
            th.textContent = `${baseText} ${state.direction === 'asc' ? '▲' : '▼'}`;
        } else {
            th.textContent = baseText;
        }
    });
}

function exportTableToCSV(tableId, filename = 'export.csv') {
    const table = document.getElementById(tableId);
    if (!table) {
        alert('내보낼 테이블을 찾지 못했습니다.');
        return;
    }

    const rows = [...table.querySelectorAll('tr')];
    const csv = rows.map(row => {
        const cells = [...row.querySelectorAll('th, td')];
        return cells.map(cell => {
            const text = cell.innerText.replace(/\n/g, ' ').trim();
            return `"${text.replace(/"/g, '""')}"`;
        }).join(',');
    }).join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
}

function printPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) {
        window.print();
        return;
    }

    const original = document.body.innerHTML;
    const printHtml = `
        <html>
        <head>
            <title>인쇄</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 24px; }
                table { width: 100%; border-collapse: collapse; margin-top: 12px; }
                th, td { border: 1px solid #ccc; padding: 8px; font-size: 12px; }
                th { background: #f3f3f3; }
                .text-end { text-align: right; }
                .text-center { text-align: center; }
                button { display: none !important; }
            </style>
        </head>
        <body>${panel.outerHTML}</body>
        </html>
    `;

    document.body.innerHTML = printHtml;
    window.print();
    document.body.innerHTML = original;
    window.location.reload();
}

function ensureLatestAppliedDateElement() {
    if (document.getElementById('latestAppliedDate')) return;

    const filterContainer =
        document.querySelector('.filter-section') ||
        document.querySelector('.search-filter-section') ||
        document.querySelector('.card-body') ||
        document.body;

    const el = document.createElement('div');
    el.id = 'latestAppliedDate';
    el.style.margin = '8px 0 16px';
    el.style.fontSize = '13px';
    el.style.color = '#666';
    el.textContent = '최종 반영일자: 확인 중...';

    filterContainer.appendChild(el);
}

function updateLatestAppliedDate(rows) {
    const el = document.getElementById('latestAppliedDate');
    if (!el) return;

    if (!rows || !rows.length) {
        el.textContent = '최종 반영일자: 데이터 없음';
        return;
    }

    const latest = rows
        .map(row => String(row.date || '').trim())
        .filter(Boolean)
        .sort()
        .pop();

    el.textContent = latest
        ? `최종 반영일자: ${latest}`
        : '최종 반영일자: 데이터 없음';
}

function showLoadingState(isLoading, message = '') {
    let el = document.getElementById('pageLoadingMessage');

    if (!el) {
        el = document.createElement('div');
        el.id = 'pageLoadingMessage';
        el.style.position = 'fixed';
        el.style.top = '20px';
        el.style.right = '20px';
        el.style.zIndex = '9999';
        el.style.padding = '10px 14px';
        el.style.background = 'rgba(0,0,0,0.75)';
        el.style.color = '#fff';
        el.style.borderRadius = '8px';
        el.style.fontSize = '13px';
        el.style.display = 'none';
        document.body.appendChild(el);
    }

    if (isLoading) {
        el.textContent = message || '로딩 중...';
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

function showGlobalError(message) {
    const container =
        document.querySelector('.container') ||
        document.querySelector('.content') ||
        document.body;

    const box = document.createElement('div');
    box.style.margin = '16px 0';
    box.style.padding = '12px 16px';
    box.style.background = '#fdecea';
    box.style.color = '#b42318';
    box.style.border = '1px solid #f5c2c7';
    box.style.borderRadius = '8px';
    box.textContent = message;

    container.prepend(box);
}

function clearDetailPanels() {
    const titleEl = document.getElementById('agencyDetailTitle');
    const metaEl = document.getElementById('agencyDetailMeta');
    const purchaseTbody = document.querySelector('#purchaseDetailTable tbody');
    const contractTbody = document.querySelector('#contractDetailTable tbody');
    const trendSummary = document.getElementById('trendSummary');

    if (titleEl) titleEl.textContent = '기관 상세분석';
    if (metaEl) metaEl.textContent = '';

    if (purchaseTbody) {
        purchaseTbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">선택된 기관이 없습니다.</td></tr>`;
    }

    if (contractTbody) {
        contractTbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">선택된 기관이 없습니다.</td></tr>`;
    }

    if (trendSummary) {
        trendSummary.innerHTML = '';
    }

    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}

function formatCurrency(value) {
    const num = Number(value || 0);
    return `${num.toLocaleString('ko-KR')}원`;
}

function formatCompactCurrency(value) {
    const num = Number(value || 0);

    if (Math.abs(num) >= 100000000) {
        return `${(num / 100000000).toFixed(1)}억`;
    }
    if (Math.abs(num) >= 10000) {
        return `${(num / 10000).toFixed(0)}만`;
    }
    return `${num.toLocaleString('ko-KR')}원`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function ensureResultLayout() {
    if (document.getElementById('agencyRankTable')) return;

    const container =
        document.querySelector('.container') ||
        document.querySelector('.content') ||
        document.querySelector('main') ||
        document.body;

    const wrapper = document.createElement('div');
    wrapper.id = 'agencyAnalysisResultArea';
    wrapper.style.marginTop = '24px';

    wrapper.innerHTML = `
        <div class="card" style="margin-bottom: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
            <div class="card-body" style="padding: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:12px; flex-wrap:wrap;">
                    <div>
                        <h3 style="margin:0; font-size:20px; font-weight:700;">수요기관 구매 순위</h3>
                        <div style="margin-top:6px; color:#666; font-size:13px;">
                            <span id="totalAgencyCount">0개 기관</span>
                            <span style="margin:0 8px;">|</span>
                            <span id="totalAgencyAmount">0원</span>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-outline-secondary" data-action="export-csv" data-table-id="agencyRankTable" data-filename="agency-rank.csv">CSV 내보내기</button>
                        <button type="button" class="btn btn-outline-secondary" data-action="print-panel" data-panel-id="agencyRankPanel">인쇄</button>
                    </div>
                </div>

                <div id="agencyRankPanel">
                    <div style="overflow:auto;">
                        <table id="agencyRankTable" class="table table-hover" style="width:100%; border-collapse:collapse;">
                            <thead></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="card" style="margin-bottom: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
            <div class="card-body" style="padding: 20px;">
                <div style="margin-bottom:12px;">
                    <h3 id="agencyDetailTitle" style="margin:0; font-size:20px; font-weight:700;">기관 상세분석</h3>
                    <div id="agencyDetailMeta" style="margin-top:6px; color:#666; font-size:13px;"></div>
                </div>

                <div style="display:grid; grid-template-columns: 1fr; gap:20px;">
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <h4 style="margin:0; font-size:16px; font-weight:700;">공급사별 요약</h4>
                            <div style="display:flex; gap:8px;">
                                <button type="button" class="btn btn-outline-secondary" data-action="export-csv" data-table-id="purchaseDetailTable" data-filename="purchase-detail.csv">CSV 내보내기</button>
                            </div>
                        </div>
                        <div style="overflow:auto;">
                            <table id="purchaseDetailTable" class="table table-hover" style="width:100%; border-collapse:collapse;">
                                <thead></thead>
                                <tbody>
                                    <tr><td colspan="3" class="text-center text-muted py-4">선택된 기관이 없습니다.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <h4 style="margin:0; font-size:16px; font-weight:700;">계약 상세</h4>
                            <div style="display:flex; gap:8px;">
                                <button type="button" class="btn btn-outline-secondary" data-action="export-csv" data-table-id="contractDetailTable" data-filename="contract-detail.csv">CSV 내보내기</button>
                            </div>
                        </div>
                        <div style="overflow:auto;">
                            <table id="contractDetailTable" class="table table-hover" style="width:100%; border-collapse:collapse;">
                                <thead></thead>
                                <tbody>
                                    <tr><td colspan="7" class="text-center text-muted py-4">선택된 기관이 없습니다.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div id="trendPanel">
                        <div style="margin-bottom:8px;">
                            <h4 style="margin:0; font-size:16px; font-weight:700;">연도별 추이</h4>
                        </div>
                        <div style="display:grid; grid-template-columns: minmax(320px, 2fr) minmax(220px, 1fr); gap:20px; align-items:start;">
                            <div style="height:320px; position:relative;">
                                <canvas id="trendChart"></canvas>
                            </div>
                            <div id="trendSummary"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    container.appendChild(wrapper);
}
