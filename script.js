// 油耗紀錄 App —— 資料全部存在瀏覽器 localStorage，不會上傳
let records = JSON.parse(localStorage.getItem('fuelRecords') || '[]');
let chart;
let inputMode = localStorage.getItem('inputMode') || 'trip'; // trip = 直接輸入里程, odo = 總公里數相減

const $ = id => document.getElementById(id);

// 初始化：每步驟獨立包起來，CDN 載入失敗時只有該功能失效，不會整個卡住
function init() {
    const steps = [setCurrentTime, recalc, () => setMode(inputMode), render, initChart, loadSavedCarrier];
    steps.forEach(step => {
        try { step(); } catch (e) { console.error('初始化步驟失敗:', e); }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function setCurrentTime() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    $('date').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    $('time').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// 里程輸入模式：直接輸入單次里程，或輸入里程表讀數自動相減
function setMode(mode) {
    inputMode = mode === 'odo' ? 'odo' : 'trip';
    localStorage.setItem('inputMode', inputMode);

    $('mode0').classList.toggle('active', inputMode === 'trip');
    $('mode1').classList.toggle('active', inputMode === 'odo');
    $('rowDistance').style.display = inputMode === 'trip' ? '' : 'none';
    $('rowOdo').style.display = inputMode === 'odo' ? '' : 'none';
    $('odoHint').style.display = inputMode === 'odo' ? '' : 'none';

    updateOdoHint();
}

// 找出這個時間點之前、最近一筆有總公里數的紀錄
function prevOdoRecord(d, t, excludeIdx) {
    const key = d + (t || '');
    let best = null;
    records.forEach((r, i) => {
        if (i === excludeIdx) return;
        if (r.odo == null || isNaN(r.odo)) return;
        const rk = r.d + (r.t || '');
        if (rk < key && (!best || rk > best.d + (best.t || ''))) best = r;
    });
    return best;
}

// 即時試算「現在總公里 − 上次總公里 ÷ 公升」
function updateOdoHint() {
    if (inputMode !== 'odo') return;

    const hint = $('odoHint');
    const odo = parseFloat($('odo').value);
    const l = parseFloat($('liters').value);
    const idx = parseInt($('editIdx').value, 10);
    const prev = prevOdoRecord($('date').value, $('time').value, idx);

    if (!prev) {
        let html = '目前沒有更早的總公里數，這筆會<b>從 0 起算</b>（里程表讀數 ÷ 公升）。';
        if (!isNaN(odo) && odo > 0) {
            html += `<br>行駛里程：<b>${Number(odo.toFixed(1))} km</b>`;
            if (!isNaN(l) && l > 0) html += `　油耗：<b>${(odo / l).toFixed(2)} km/L</b>`;
        }
        hint.innerHTML = html;
        return;
    }

    let html = `上次總公里數：<b>${prev.odo} km</b>（${prev.d}）`;
    if (!isNaN(odo)) {
        if (odo <= prev.odo) {
            html += `<br><span class="warn">總公里數必須大於 ${prev.odo}</span>`;
        } else {
            const km = Number((odo - prev.odo).toFixed(1));
            html += `<br>行駛里程：<b>${km} km</b>`;
            if (!isNaN(l) && l > 0) html += `　油耗：<b>${(km / l).toFixed(2)} km/L</b>`;
        }
    }
    hint.innerHTML = html;
}

// 依總公里數重算里程與油耗（新增、編輯、刪除後都要跑）
function recalc() {
    let prevOdo = null;
    records.forEach(r => {
        if (r.odo != null && !isNaN(r.odo)) {
            // 第一筆沒有更早的總公里數，就把里程表讀數當成「從 0 起算」的行駛里程
            r.base = prevOdo == null;
            if (prevOdo == null) r.km = r.odo > 0 ? Number(r.odo.toFixed(1)) : null;
            else r.km = r.odo > prevOdo ? Number((r.odo - prevOdo).toFixed(1)) : null;
            prevOdo = r.odo;
        }
        r.cons = (r.km != null && !isNaN(r.km) && r.l > 0) ? Number((r.km / r.l).toFixed(2)) : null;
    });
}

function persist() {
    localStorage.setItem('fuelRecords', JSON.stringify(records));
}

// 頁籤切換
function tab(i) {
    document.querySelectorAll('#mainTabs .segment').forEach((s, x) => s.classList.toggle('active', x === i));
    document.querySelectorAll('.sec').forEach((s, x) => s.classList.toggle('active', x === i));
    if (i === 1) updateChart();
    if (i === 0) { renderInlineBarcode(); updateOdoHint(); }
}

// 儲存
function save() {
    const d = $('date').value;
    const t = $('time').value;
    const l = parseFloat($('liters').value);
    const km = parseFloat($('distance').value);
    const odo = parseFloat($('odo').value);
    const idx = parseInt($('editIdx').value, 10);

    if (!d || !t || isNaN(l) || l <= 0) return alert('請正確輸入日期、時間與公升數');

    let entry;
    if (inputMode === 'odo') {
        if (isNaN(odo)) return alert('請輸入現在的總公里數');
        const prev = prevOdoRecord(d, t, idx);
        if (prev && odo <= prev.odo) return alert(`總公里數必須大於上次的 ${prev.odo} km`);
        // km / cons 由 recalc() 依「現在總公里數 − 上次總公里數」算出
        entry = { d, t, l, odo, km: null, cons: null };
    } else {
        if (isNaN(km) || km <= 0) return alert('請正確輸入里程');
        entry = { d, t, l, km, cons: Number((km / l).toFixed(2)) };
    }

    if (idx === -1) records.push(entry);
    else records[idx] = entry;

    records.sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
    recalc();
    persist();

    resetForm();
    render();
    tab(2); // 跳到明細頁
}

function resetForm() {
    $('editIdx').value = '-1';
    $('liters').value = '';
    $('distance').value = '';
    $('odo').value = '';
    $('cancelEditBtn').style.display = 'none';
    setCurrentTime();
    updateOdoHint();
}

function cancelEdit() {
    resetForm();
    tab(2);
}

// 渲染統計與清單
function render() {
    const valid = records.filter(r => typeof r.cons === 'number' && !isNaN(r.cons));
    $('avgVal').innerText = valid.length ? (valid.reduce((s, r) => s + r.cons, 0) / valid.length).toFixed(2) : '0.00';
    $('countVal').innerText = records.length;
    $('lowVal').innerText = valid.length ? Math.min(...valid.map(r => r.cons)).toFixed(2) : '--';

    const container = $('list');
    container.innerHTML = '';

    if (!records.length) {
        container.innerHTML = '<div class="empty">還沒有紀錄，先到「新增」加一筆吧</div>';
        return;
    }

    const html = [];
    for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i];

        // 與前一筆有油耗的紀錄比較
        let diffHtml = '';
        if (typeof r.cons === 'number') {
            let prev = null;
            for (let j = i - 1; j >= 0; j--) {
                if (typeof records[j].cons === 'number') { prev = records[j]; break; }
            }
            if (prev) {
                const diff = Number((r.cons - prev.cons).toFixed(2));
                if (diff > 0) diffHtml = `<span class="diff-tag diff-up">↑${diff}</span>`;
                else if (diff < 0) diffHtml = `<span class="diff-tag diff-down">↓${Math.abs(diff)}</span>`;
            }
        }

        // 距離上一筆幾天
        let daysHtml = '';
        if (i > 0) {
            const days = Math.ceil(Math.abs(new Date(r.d) - new Date(records[i - 1].d)) / 86400000);
            daysHtml = `<span class="days-tag">${days}天</span>`;
        }

        const odoHtml = r.odo != null ? `<span class="odo-tag">總 ${r.odo}km</span>` : '';
        const baseHtml = r.base ? '<span class="odo-tag">起始</span>' : '';
        const kmText = r.km != null ? `${r.km}km / ${r.l}L` : `-- / ${r.l}L`;
        const consText = typeof r.cons === 'number' ? r.cons.toFixed(2) : '--';

        html.push(`
            <div class="record-row">
                <div>
                    <b>${r.d}<span class="row-time">${r.t || ''}</span></b>${daysHtml}<br>
                    <span class="row-sub">${kmText}</span>${odoHtml}${baseHtml}
                </div>
                <div style="text-align:right">
                    <span class="record-val">${consText}</span>${diffHtml}<br>
                    <span class="link-edit" onclick="editRecord(${i})">編輯</span>
                    <span class="link-del" onclick="del(${i})">刪除</span>
                </div>
            </div>`);
    }
    container.innerHTML = html.join('');
}

// 編輯與刪除
function editRecord(i) {
    const r = records[i];
    $('date').value = r.d;
    $('time').value = r.t || '00:00';
    $('liters').value = r.l;
    $('editIdx').value = i;
    $('cancelEditBtn').style.display = '';

    if (r.odo != null) {
        $('odo').value = r.odo;
        $('distance').value = '';
        setMode('odo');
    } else {
        $('distance').value = r.km;
        $('odo').value = '';
        setMode('trip');
    }
    tab(0);
}

function del(i) {
    if (!confirm('確定刪除這筆紀錄？')) return;
    records.splice(i, 1);
    recalc();
    persist();
    render();
    updateChart();
}

// 圖表
function initChart() {
    if (typeof Chart === 'undefined') return; // 函式庫沒載到就跳過，其他功能照常
    chart = new Chart($('chart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{ data: [], borderColor: '#007AFF', tension: 0.4, fill: false }] },
        options: { plugins: { legend: { display: false } } }
    });
    updateChart();
}

function updateChart() {
    if (!chart) return;
    const valid = records.filter(r => typeof r.cons === 'number' && !isNaN(r.cons));
    chart.data.labels = valid.map(r => r.d);
    chart.data.datasets[0].data = valid.map(r => r.cons);
    chart.update();
}

// 匯出 Excel
function exportXLS() {
    if (typeof XLSX === 'undefined') return alert('Excel 元件載入失敗，請連上網路後重新整理');
    if (!records.length) return alert('目前沒有可匯出的紀錄');

    const rows = records.map(r => ({
        '日期': r.d,
        '時間': r.t,
        '總公里數 (km)': r.odo != null ? r.odo : '',
        '加油公升 (L)': r.l,
        '行駛里程 (km)': r.km != null ? r.km : '',
        '當次油耗 (km/L)': typeof r.cons === 'number' ? r.cons : ''
    }));

    // 只有算得出里程的紀錄才納入平均
    const counted = records.filter(r => r.km != null && !isNaN(r.km));
    const totalLiters = records.reduce((s, r) => s + (r.l || 0), 0);
    const totalKm = counted.reduce((s, r) => s + r.km, 0);
    const countedLiters = counted.reduce((s, r) => s + (r.l || 0), 0);
    const avgCons = countedLiters ? (totalKm / countedLiters).toFixed(2) : 0;

    rows.push({
        '日期': '【總計統計】',
        '時間': '',
        '總公里數 (km)': '',
        '加油公升 (L)': Number(totalLiters.toFixed(2)),
        '行駛里程 (km)': Number(totalKm.toFixed(1)),
        '當次油耗 (km/L)': '總平均:' + avgCons
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '油耗記錄');
    XLSX.writeFile(wb, `油耗記錄_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
}

function clearAll() {
    if (!confirm('確定清除所有資料？這無法復原。')) return;
    records = [];
    persist();
    resetForm();
    render();
    updateChart();
}

// 載具條碼
const barcodeOpts = {
    format: 'CODE128',
    width: 2.8,
    height: 110,
    displayValue: false,
    margin: 8,
    background: '#FFFFFF',
    lineColor: '#000000'
};

function loadSavedCarrier() {
    const saved = localStorage.getItem('carrierCode');
    if (!saved) return;
    $('carrierInput').value = saved;
    if (typeof JsBarcode === 'undefined') return;
    showBarcode('/' + saved);
}

function generateBarcode() {
    const raw = $('carrierInput').value.trim().toUpperCase();
    if (!/^[A-Z0-9+\-.]{7}$/.test(raw)) {
        return alert('請輸入正確的 7 碼載具代碼\n（英文大寫、數字、+、-、.）');
    }
    localStorage.setItem('carrierCode', raw);
    showBarcode('/' + raw);
}

function showBarcode(code) {
    if (typeof JsBarcode === 'undefined') return alert('條碼元件載入失敗，請連上網路後重新整理');
    JsBarcode('#carrierBarcode', code, barcodeOpts);
    $('carrierCodeDisplay').textContent = code;
    $('barcodeSection').style.display = 'block';
    renderInlineBarcode();
}

// 新增頁下方也顯示同一組條碼，加油時直接掃
function renderInlineBarcode() {
    const saved = localStorage.getItem('carrierCode');
    if (!saved || typeof JsBarcode === 'undefined') return;
    const code = '/' + saved;
    JsBarcode('#inlineBarcodeImg', code, barcodeOpts);
    $('inlineCodeDisplay').textContent = code;
    $('inlineBarcode').style.display = 'block';
}
