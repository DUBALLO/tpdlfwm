// trend-analysis.js

// 전역 변수
let allData = [];
let chartInstances = {};

document.addEventListener('DOMContentLoaded', async () => {
    showLoadingState(true, '모든 품목의 데이터를 로딩 중입니다...');
    try {
        allData = await loadAndParseAllData();
        populateYearFilters();
        
        document.getElementById('analyzeBtn').addEventListener('click', analyzeTrends);
        setupTabs();
        
        analyzeTrends();
    } catch (error) {
        console.error("초기화 실패:", error);
        showAlert("데이터 로딩 중 오류가 발생했습니다.", 'error');
    } finally {
        showLoadingState(false);
    }
});

async function loadAndParseAllData() {
    if (!window.sheetsAPI) throw new Error('sheets-api.js가 로드되지 않았습니다.');
    // ▼▼▼ [수정] 이 부분을 새로운 통합 함수로 변경합니다. ▼▼▼
    const rawData = await window.sheetsAPI.loadAllProcurementData();
    return rawData.map(item => ({
        amount: parseInt(String(item['공급금액']).replace(/[^\d]/g, '') || '0', 10),
        date: item['기준일자'] || '',
        product: (item['세부품명'] || '').trim(),
        region: (item['수요기관지역'] || '').trim().split(' ')[0],
        agencyType: item['소관구분'] || '기타',
        contractName: (item['계약명'] || '').trim()
    })).filter(item => item.amount > 0 && item.date && item.contractName);
}

function populateYearFilters() {
    const baseYearEl = document.getElementById('baseYear');
    const comparisonYearEl = document.getElementById('comparisonYear');
    if (!baseYearEl || !comparisonYearEl) return;

    const years = [...new Set(allData.map(d => new Date(d.date).getFullYear()))].sort((a, b) => b - a);
    
    baseYearEl.innerHTML = '<option value="all_avg">전체(평균)</option>';
    comparisonYearEl.innerHTML = '';

    years.forEach(year => {
        baseYearEl.add(new Option(`${year}년`, year));
        comparisonYearEl.add(new Option(`${year}년`, year));
    });

    baseYearEl.value = 'all_avg';
    const currentYear = new Date().getFullYear();
    if (years.includes(currentYear)) {
        comparisonYearEl.value = currentYear;
    } else if (years.length > 0) {
        // 현재 연도 데이터가 없을 경우, 가장 최신 연도를 기본값으로 설정
        comparisonYearEl.value = years[0];
    }
}

function setupTabs() {
    const tabs = document.getElementById('trendTabs');
    tabs.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const tabName = e.target.dataset.tab;
            tabs.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
            document.getElementById(tabName + 'Tab').classList.remove('hidden');
        }
    });
}

function analyzeTrends() {
    showLoadingState(true, '데이터 분석 및 그래프 생성 중...');

    const baseYear = document.getElementById('baseYear').value;
    const comparisonYear = document.getElementById('comparisonYear').value;
    const product = document.getElementById('productFilter').value;

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
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }
    const ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            scales: { y: { beginAtZero: true, ticks: { callback: value => CommonUtils.formatCurrency(value) } } },
            plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${CommonUtils.formatCurrency(context.parsed.y)}` } } }
        }
    });
}

const colors = {
    base: { bg: 'rgba(255, 99, 132, 0.2)', border: 'rgba(255, 99, 132, 1)' },
    comparison: { bg: 'rgba(54, 162, 235, 0.2)', border: 'rgba(54, 162, 235, 1)' }
};

function renderMonthlyTrend(base, comparison, baseLabel, compLabel, baseYear) {
    const aggregate = (data) => {
        const monthly = Array(12).fill(0);
        data.forEach(item => {
            monthly[new Date(item.date).getMonth()] += item.amount;
        });
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
    document.getElementById('printMonthlyBtn').onclick = () => printPanel('monthlyTab');
}

function renderRegionalTrend(base, comparison, baseLabel, compLabel, baseYear) {
    const aggregate = (data) => {
        const regional = {};
        data.forEach(item => {
            if (item.region) regional[item.region] = (regional[item.region] || 0) + item.amount;
        });
        return regional;
    };
    
    const allLabels = [...new Set([...base.map(d => d.region), ...comparison.map(d => d.region)])].filter(Boolean).sort();
    
    const baseAgg = aggregate(base);
    const compAgg = aggregate(comparison);
    
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
    document.getElementById('printRegionalBtn').onclick = () => printPanel('regionalTab');
}

function renderAgencyTypeTrend(base, comparison, baseLabel, compLabel, baseYear) {
    const aggregate = (data) => {
        const byType = {};
        data.forEach(item => {
            byType[item.agencyType] = (byType[item.agencyType] || 0) + item.amount;
        });
        return byType;
    };

    const allLabels = [...new Set([...base.map(d => d.agencyType), ...comparison.map(d => d.agencyType)])].filter(Boolean).sort();
    
    const baseAgg = aggregate(base);
    const compAgg = aggregate(comparison);

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
    document.getElementById('printAgencyTypeBtn').onclick = () => printPanel('agencyTypeTab');
}

function printPanel(elementId) {
    const panel = document.getElementById(elementId);
    if (panel) {
        panel.classList.add('printable-area');
        Chart.defaults.animation = false;
        window.print();
        Chart.defaults.animation = true;
        panel.classList.remove('printable-area');
    }
}

function showLoadingState(isLoading, text = '분석 중...') {
    const button = document.getElementById('analyzeBtn');
    if (button) {
        button.disabled = isLoading;
        const originalText = `<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>분석`;
        button.innerHTML = isLoading ? `<div class="loading-spinner"></div> ${text}` : originalText;
    }
}

function showAlert(message, type = 'info') {
    if (window.CommonUtils && CommonUtils.showAlert) {
        window.CommonUtils.showAlert(message, type);
    } else { alert(message); }
}
