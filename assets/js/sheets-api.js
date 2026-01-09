// Google Sheets API 연결 및 CSV 로드 기능 (v6 - 안정화 버전)

class SheetsAPI {
    constructor() {
        this.csvUrls = {
            procurement: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSplrmlhekVgQLbcCpHLX8d2HBNAErwj-UknKUZVI5KCMen-kUCWXlRONPR6oc0Wj1zd6FP-EfRaFeU/pub?output=csv',
            nonSlip: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQBfSqfw_9hUtZddet8YWQTRZxiQlo9jIPWZLs1wKTlpv9mb5pGfmrf75vbOy63u4eHvzlrI_S3TLmc/pub?output=csv',
            vegetationMat: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR_JIdgWP0WcM1Eb5gw29tmBymlk_KicHDmVyZAAnHrViIKGlLLZzpx950H1vI7rFpc0K_0nFmO8BT1/pub?output=csv',
            monthlySales: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjy2slFJrAxxPO8WBmehXH4iJtcfxr-HUkvL-YXw-BIvmA1Z3kTa8DfdWVnwVl3r4jhjmHFUYIju3j/pub?output=csv'
        };
        this.currentUrl = '';
        this.corsProxies = [
            'https://cors.bridged.cc/',
            'https://api.allorigins.win/raw?url='
        ];
    }

    async loadAllProcurementData() {
        console.log('모든 조달 데이터(보행, 식생, 논슬립) 로드 시작...');
        const dataSources = ['procurement', 'vegetationMat', 'nonSlip'];
        
        try {
            const promises = dataSources.map(source => this.loadCSVData(source));
            const results = await Promise.all(promises);
            const combinedData = results.flat(); 
            console.log(`총 ${combinedData.length}개의 조달 데이터 통합 완료.`);
            return combinedData;
        } catch (error) {
            console.error('하나 이상의 조달 데이터 로드에 실패했습니다:', error);
            throw new Error('모든 조달 데이터를 불러오는 데 실패했습니다.');
        }
    }
    
    async loadCSVData(sheetType) {
        if (!this.csvUrls[sheetType]) {
            throw new Error(`유효하지 않은 시트 타입입니다: ${sheetType}`);
        }
        this.currentUrl = this.csvUrls[sheetType];
        console.log(`'${sheetType}' 시트의 CSV 데이터 로드 시작...`);

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
    
    /**
     * CSV 한 줄을 파싱하는 헬퍼 함수. 큰따옴표 안의 쉼표는 무시합니다.
     */
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
            } else {
                current += char;
            }
        }
        result.push(current);
        return result.map(s => s.trim().replace(/^"|"$/g, ''));
    }

    /**
     * CSV 텍스트 전체를 파싱하여 객체 배열로 변환하는 메인 함수.
     */
    parseCSV(csvText) {
        const lines = csvText.trim().split('\n').filter(line => line); // 빈 줄 제거
        if (lines.length < 2) return [];

        const headers = this.parseCSVLine(lines[0]);
        const data = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            // 헤더와 값의 개수가 다르면 데이터 오류로 간주하고 건너뜀
            if (values.length !== headers.length) continue; 
            
            const item = {};
            headers.forEach((header, index) => {
                const cleanHeader = header.trim();
                item[cleanHeader] = values[index] ? values[index].trim() : '';
            });
            data.push(item);
        }
        return data;
    }
}

window.sheetsAPI = new SheetsAPI();
