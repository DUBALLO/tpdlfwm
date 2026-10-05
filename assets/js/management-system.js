/**
 * 경영시스템 문서 — 문서대장 · 전문 검색 · 문서 보기 · 인쇄
 * 데이터: /docs/ms/registry.json + /docs/ms/*.md (정적 파일, 빌드 없음)
 * 검색: 모든 문서 본문을 메모리에 올려 부분 일치. 문장 단위로 결과 표시.
 */
(function () {
    'use strict';

    const BASE = '../';
    const state = { registry: null, docs: new Map(), loadedAll: false, current: null };

    const $ = (id) => document.getElementById(id);

    // ---------- 로드 ----------
    async function loadRegistry() {
        const res = await fetch(BASE + 'docs/ms/registry.json', { cache: 'no-store' });
        state.registry = await res.json();
        $('regMeta').textContent = `문서 ${state.registry.docs.length}건 · 갱신 ${state.registry.updated}`;
    }

    async function loadDoc(entry) {
        if (state.docs.has(entry.id)) return state.docs.get(entry.id);
        const res = await fetch(BASE + entry.file, { cache: 'no-store' });
        const raw = (await res.text()).replace(/\r\n?/g, '\n');
        const parsed = parseFrontMatter(raw);
        const doc = { entry, meta: parsed.meta, body: parsed.body, lines: splitSentences(parsed.body) };
        state.docs.set(entry.id, doc);
        return doc;
    }

    async function loadAll() {
        if (state.loadedAll) return;
        await Promise.all(state.registry.docs.map(loadDoc));
        state.loadedAll = true;
    }

    function parseFrontMatter(text) {
        const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
        if (!m) return { meta: {}, body: text };
        const meta = {};
        m[1].split('\n').forEach((line) => {
            const i = line.indexOf(':');
            if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        });
        return { meta, body: text.slice(m[0].length) };
    }

    // 본문을 검색 단위(문장/행)로 나눈다. 마크다운 기호는 떼고 표 행은 셀을 띄어 쓴다.
    function splitSentences(md) {
        const out = [];
        md.split('\n').forEach((line, idx) => {
            let t = line.trim();
            if (!t || /^\|?\s*-{3,}/.test(t) || t === '---') return;
            t = t.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')
                 .replace(/\*\*/g, '').replace(/\|/g, ' · ').replace(/\s+/g, ' ').trim();
            if (!t) return;
            // 긴 줄은 문장으로 더 쪼갠다
            const parts = t.length > 160 ? t.split(/(?<=[.。]|다\.)\s+/) : [t];
            parts.forEach((p) => { if (p.trim()) out.push({ text: p.trim(), line: idx }); });
        });
        return out;
    }

    // ---------- 문서대장 ----------
    function activeLayers() {
        return Array.from(document.querySelectorAll('.layerFilter:checked')).map((c) => c.value);
    }

    function renderRegistry() {
        const layers = activeLayers();
        const chapters = state.registry.chapters;
        const groups = chapters.map((name, i) => ({
            name, docs: state.registry.docs.filter((d) => d.chapter === i && layers.includes(d.layer)),
        }));
        let html = '';
        groups.forEach((g) => {
            if (!g.docs.length) return;
            html += `<h3 class="text-sm font-semibold text-gray-700 mt-4 mb-1">${esc(g.name)}</h3>`;
            html += '<table class="w-full text-sm"><thead><tr class="text-left text-xs text-gray-500 border-b">' +
                '<th class="py-1 pr-2 w-40">문서번호</th><th class="py-1 pr-2">제목</th><th class="py-1 pr-2 w-24">구분</th>' +
                '<th class="py-1 pr-2 w-16">개정</th><th class="py-1 pr-2 w-28">제정/개정</th><th class="py-1 w-36">상태</th></tr></thead><tbody>';
            g.docs.forEach((d) => {
                const date = d.revised || d.established || '';
                html += `<tr class="border-b hover:bg-emerald-50 cursor-pointer" data-id="${esc(d.id)}">` +
                    `<td class="py-1 pr-2 font-mono text-xs text-gray-600">${esc(d.number)}</td>` +
                    `<td class="py-1 pr-2 text-emerald-800">${esc(d.title)}</td>` +
                    `<td class="py-1 pr-2 text-xs">${esc(d.layer)}</td>` +
                    `<td class="py-1 pr-2 text-xs">${esc(d.rev)}</td>` +
                    `<td class="py-1 pr-2 text-xs">${esc(date)}</td>` +
                    `<td class="py-1 text-xs text-gray-500">${esc(d.status)}</td></tr>`;
            });
            html += '</tbody></table>';
        });
        $('registryTable').innerHTML = html || '<p class="text-sm text-gray-500">표시할 문서가 없습니다.</p>';
        $('registryTable').querySelectorAll('tr[data-id]').forEach((tr) => {
            tr.addEventListener('click', () => (location.hash = 'doc=' + encodeURIComponent(tr.dataset.id)));
        });
    }

    // ---------- 검색 ----------
    let searchTimer = null;
    function onSearchInput() {
        clearTimeout(searchTimer);
        const q = $('searchInput').value.trim();
        searchTimer = setTimeout(() => runSearch(q), 150);
    }

    async function runSearch(q) {
        const resultsEl = $('searchResults');
        const statusEl = $('searchStatus');
        if (q.length < 1) { resultsEl.innerHTML = ''; statusEl.textContent = ''; return; }
        statusEl.textContent = state.loadedAll ? '' : '문서 본문을 불러오는 중…';
        await loadAll();
        const needle = q.toLowerCase();
        const hits = [];
        state.registry.docs.forEach((entry) => {
            const doc = state.docs.get(entry.id);
            const titleHit = (entry.title + ' ' + entry.number).toLowerCase().includes(needle);
            const lines = doc.lines.filter((l) => l.text.toLowerCase().includes(needle));
            if (titleHit || lines.length) hits.push({ entry, lines, titleHit });
        });
        hits.sort((a, b) => (b.titleHit - a.titleHit) || (b.lines.length - a.lines.length));
        const total = hits.reduce((n, h) => n + h.lines.length, 0);
        statusEl.textContent = hits.length ? `문서 ${hits.length}건 · 문장 ${total}개` : '일치하는 문장이 없습니다.';
        resultsEl.innerHTML = hits.map((h) => {
            const shown = h.lines.slice(0, 8);
            const more = h.lines.length - shown.length;
            return `<div class="py-3">
                <div class="flex items-baseline gap-2">
                    <a href="#doc=${encodeURIComponent(h.entry.id)}&q=${encodeURIComponent(q)}" class="font-medium text-emerald-800 hover:underline">${highlight(h.entry.title, q)}</a>
                    <span class="font-mono text-xs text-gray-500">${esc(h.entry.number)}</span>
                    <span class="text-xs text-gray-400">${esc(h.entry.layer)}</span>
                    <span class="text-xs text-gray-400 ml-auto">${h.lines.length}개</span>
                </div>
                <ul class="mt-1 text-sm text-gray-700 leading-relaxed">
                    ${shown.map((l) => `<li class="truncate"><a href="#doc=${encodeURIComponent(h.entry.id)}&q=${encodeURIComponent(q)}&line=${l.line}" class="hover:underline">${highlight(l.text, q)}</a></li>`).join('')}
                    ${more > 0 ? `<li class="text-xs text-gray-400">… ${more}개 더</li>` : ''}
                </ul>
            </div>`;
        }).join('');
    }

    function highlight(text, q) {
        const safe = esc(text);
        if (!q) return safe;
        const re = new RegExp(escapeRe(esc(q)), 'gi');
        return safe.replace(re, (m) => `<mark>${m}</mark>`);
    }

    // ---------- 문서 보기 ----------
    async function showDoc(id, q, line) {
        const entry = state.registry.docs.find((d) => d.id === id);
        if (!entry) { location.hash = ''; return; }
        const doc = await loadDoc(entry);
        state.current = doc;
        $('phNumber').textContent = entry.number;
        $('phTitle').textContent = entry.title;
        $('phRev').textContent = `Rev ${entry.rev} · ${entry.revised || entry.established || ''}`;
        $('docMeta').textContent = `${entry.number} · ${entry.layer} · Rev ${entry.rev} · ${entry.revised || entry.established || ''}` +
            (doc.meta.source ? ` · ${doc.meta.source}` : '');
        document.title = `${entry.title} - 경영시스템`;

        let html = marked.parse(doc.body, { gfm: true, breaks: false });
        $('docBody').innerHTML = html;
        if (q) markInElement($('docBody'), q);

        $('searchPanel').classList.add('hidden');
        $('registryPanel').classList.add('hidden');
        $('docPanel').classList.remove('hidden');
        window.scrollTo(0, 0);
        const first = $('docBody').querySelector('mark');
        if (first) first.scrollIntoView({ block: 'center' });
    }

    function markInElement(root, q) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const re = new RegExp(escapeRe(q), 'gi');
        nodes.forEach((node) => {
            if (!re.test(node.nodeValue)) return;
            re.lastIndex = 0;
            const frag = document.createDocumentFragment();
            let last = 0, m;
            while ((m = re.exec(node.nodeValue))) {
                frag.appendChild(document.createTextNode(node.nodeValue.slice(last, m.index)));
                const mk = document.createElement('mark'); mk.textContent = m[0]; frag.appendChild(mk);
                last = m.index + m[0].length;
            }
            frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
            node.parentNode.replaceChild(frag, node);
        });
    }

    function showHome(keepQuery) {
        $('docPanel').classList.add('hidden');
        $('searchPanel').classList.remove('hidden');
        $('registryPanel').classList.remove('hidden');
        document.title = '경영시스템 - 두발로 대시보드';
        if (keepQuery) { const q = $('searchInput').value.trim(); if (q) runSearch(q); }
    }

    // ---------- 라우팅 ----------
    function route() {
        const h = location.hash.replace(/^#/, '');
        const params = new URLSearchParams(h);
        const id = params.get('doc');
        if (id) {
            const q = params.get('q') || '';
            if (q) $('searchInput').value = q;
            showDoc(id, q, params.get('line'));
        } else {
            showHome(true);
        }
    }

    // ---------- 유틸 ----------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // ---------- 시작 ----------
    async function init() {
        await loadRegistry();
        renderRegistry();
        document.querySelectorAll('.layerFilter').forEach((c) => c.addEventListener('change', renderRegistry));
        $('searchInput').addEventListener('input', onSearchInput);
        $('searchClear').addEventListener('click', () => { $('searchInput').value = ''; runSearch(''); $('searchInput').focus(); });
        $('backBtn').addEventListener('click', () => { history.length > 1 ? history.back() : (location.hash = ''); });
        $('homeLink').addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });
        $('printBtn').addEventListener('click', () => window.print());
        window.addEventListener('hashchange', route);
        route();
        // 검색을 바로 쓸 수 있게 본문을 뒤에서 미리 올린다
        loadAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
