// Google Sheets API 연결 및 CSV 로드 기능 (v8 - 관급 데이터 안정화 버전)

class SheetsAPI {
    constructor() {
        this.csvUrls = {
            procurement: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSplrmlhekVgQLbcCpHLX8d2HBNAErwj-UknKUZVI5KCMen-kUCWXlRONPR6oc0Wj1zd6FP-EfRaFeU/pub?output=csv',
            nonSlip: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQBfSqfw_9hUtZddet8YWQTRZxiQlo9jIPWZLs1wKTlpv9mb5pGfmrf75vbOy63u4eHvzlrI_S3TLmc/pub?output=csv',
            vegetationMat: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR_JIdgWP0WcM1Eb5gw29tmBymlk_KicHDmVyZAAnHrViIKGlLLZzpx950H1vI7rFpc0K_0nFmO8BT1/pub?output=csv',
            monthlySales: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjy2slFJrAxxPO8WBmehXH4iJtcfxr-HUkvL-YXw-BIvmA1Z3kTa8DfdWVnwVl3r4jhjmHFUYIju3j/pub?output=csv',
            contractMonitoring: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQEOv1Lt4jAKmc5znjAAKovg2AiL7zWXpBAA9rJULDEJA_kY8eholkBfNMM2SeXkRFHcYEmGkgSuBob/pub?output=csv',
            contactDatabase: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSIEBLy3SZsk-JRN4OTbIoeZq8KTHJW9H8DuFtvQH7umYJKzI4TzDA4pfC4uFHOVWib3cE5F9w4qos5/pub?output=csv',
            budgetAnalysis: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQkxzuw39onkX8WuPBhcMSfQjexisNckZvJ1pV1UhnBikUJvGoMI6cTfSAI5sIckK8LuZZZhb40TUtK/pub?output=csv',
            inventory: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQkA2tLZxiYFn8w0T8WF8-ibHFWAILyq44LRkHaTtAP9E55Fvc3U6gAYeL9i_ZJjinUYmP1X3-LGHNm/pub?output=csv'
        };

        this.currentUrl = '';
        this.corsProxies = [
            'https://cors.bridged.cc/',
            'https://api.allorigins.win/raw?url='
        ];
    }

    async loadAllProcurementData() {
        const dataSources = ['procurement', 'vegetationMat', 'nonSlip'];

        console.log('[통합 로드 시작] 관급 데이터 결합 시작');

        const historicalResults = await Promise.allSettled(
            dataSources.map(source => this.loadCSVData(source))
        );

        let combinedHistoricalData = [];
        let loadedSourceCount = 0;

        historicalResults.forEach((result, index) => {
            const sourceName = dataSources[index];

            if (result.status === 'fulfilled') {
                const rows = Array.isArray(result.value) ? result.value : [];
                console.log(`[시트 로드 성공] ${sourceName}: ${rows.length}건`);
                combinedHistoricalData = combinedHistoricalData.concat(rows);
                loadedSourceCount++;
            } else {
                console.error(`[시트 로드 실패] ${sourceName}:`, result.reason);
            }
        });

        if (loadedSourceCount === 0) {
            throw new Error('시트 데이터를 하나도 불러오지 못했습니다.');
        }

        const beforeFilterCount = combinedHistoricalData.length;

        combinedHistoricalData = combinedHistoricalData.filter(item => {
            const dateStr = String(item['기준일자'] || '').trim();
            return !dateStr.startsWith('2026');
        });

        const removed2026Count = beforeFilterCount - combinedHistoricalData.length;

        console.log(`[시트 2026 제거] 제거 건수: ${removed2026Count}건`);
        console.log(`[시트 합계] 2025년 이하 데이터: ${combinedHistoricalData.length}건`);

        let apiData2026 = [];

        if (window.publicDataAPI && typeof window.publicDataAPI.fetch2026Data === 'function') {
            try {
                apiData2026 = await window.publicDataAPI.fetch2026Data(true);
                console.log(`[API 2026 로드 성공] ${apiData2026.length}건`);
            } catch (error) {
                console.error('[API 2026 로드 실패] 빈 배열 처리', error);
                apiData2026 = [];
            }
        } else {
            console.warn('[API 객체 없음] window.publicDataAPI 또는 fetch2026Data 없음');
        }

        const finalCombined = combinedHistoricalData.concat(apiData2026);
        console.log(`[최종 합계] 전체 데이터: ${finalCombined.length}건`);

        return finalCombined;
    }

    async loadCSVData(sheetType) {
        if (!this.csvUrls[sheetType]) {
            throw new Error(`유효하지 않은 시트 타입입니다: ${sheetType}`);
        }

        this.currentUrl = this.csvUrls[sheetType];

        try {
            const data = await this.directLoad();
            if (data && data.length > 0) return data;
        } catch (error) {
            console.warn(`'${sheetType}' 직접 로드 실패:`, error.message);
        }

        for (const proxy of this.corsProxies) {
            try {
                const data = await this.proxyLoad(proxy);
                if (data && data.length > 0) return data;
            } catch (error) {
                console.warn(`'${sheetType}' 프록시 로드 실패 (${proxy}):`, error.message);
            }
        }

        throw new Error(`'${sheetType}' 시트의 모든 데이터 로드 방법이 실패했습니다.`);
    }

    async directLoad() {
        const response = await fetch(this.currentUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const csvText = await response.text();
        return this.parseCSV(csvText);
    }

    async proxyLoad(proxyUrl) {
        const url = proxyUrl + encodeURIComponent(this.currentUrl);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const csvText = await response.text();
        return this.parseCSV(csvText);
    }

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else if ((char === '\r' || char === '\n') && !inQuotes) {
                continue;
            } else {
                current += char;
            }
        }

        result.push(current);
        return result.map(s => s.trim().replace(/^"|"$/g, ''));
    }

    parseCSV(csvText) {
        const rows = [];
        let currentRow = [];
        let currentCell = '';
        let inQuotes = false;

        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    currentCell += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                currentRow.push(currentCell.trim());
                currentCell = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && nextChar === '\n') i++;

                currentRow.push(currentCell.trim());

                if (currentRow.length > 0 && currentRow.some(c => c !== '')) {
                    rows.push(currentRow);
                }

                currentRow = [];
                currentCell = '';
            } else {
                currentCell += char;
            }
        }

        if (currentCell || currentRow.length > 0) {
            currentRow.push(currentCell.trim());
            rows.push(currentRow);
        }

        if (rows.length < 2) return [];

        const headers = rows[0].map(h => h.replace(/^"|"$/g, '').trim());
        const data = [];

        for (let i = 1; i < rows.length; i++) {
            const values = rows[i];
            if (values.length < headers.length) continue;

            const item = {};
            headers.forEach((header, index) => {
                item[header] = values[index] ? values[index].replace(/^"|"$/g, '').trim() : '';
            });
            data.push(item);
        }

        return data;
    }
}

window.sheetsAPI = new SheetsAPI();
