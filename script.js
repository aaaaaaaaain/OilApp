// 油耗紀錄 App —— 資料全部存在瀏覽器 localStorage，不會上傳

// 版本號寫在這支檔案裡，設定頁顯示的就是「實際載入到的版本」。
// 手機若還顯示舊版本，代表吃到快取，重新整理即可。
// 改版時請一起更新 index.html 裡 style.css / script.js 的 ?v= 數字。
const APP_VERSION = '1.8.3';
let vehicles = [];   // [{ id, plate }]
let fuelData = {};   // { 車輛 id: [紀錄...] }
let activeVid = '';  // 目前選到的車輛 id
let records = [];    // = fuelData[activeVid]，其餘程式碼都只認這個
let chart;
let chartRows = []; // 圖上每個點對應的原始紀錄，tooltip 要用
let inputMode = localStorage.getItem('inputMode') || 'trip'; // trip = 直接輸入里程, odo = 總公里數相減
let theme = localStorage.getItem('theme') || 'system';       // system = 跟隨系統, light = 淺色, dark = 深色
let statsOpen = localStorage.getItem('statsOpen') !== '0';   // 統計卡片是否展開，預設展開

const $ = id => document.getElementById(id);

// 車牌是使用者輸入的，進 innerHTML 前一律轉義
const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sortRecords = list => list.sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));

function newVehicleId() {
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function safeParseArray(raw) {
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

// 讀出車輛與紀錄；1.5.0 以前只有一台車，舊資料搬進預設車輛
function loadData() {
    try { vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]'); } catch (e) { vehicles = []; }
    if (!Array.isArray(vehicles)) vehicles = [];
    try { fuelData = JSON.parse(localStorage.getItem('fuelData') || '{}'); } catch (e) { fuelData = {}; }
    if (!fuelData || typeof fuelData !== 'object') fuelData = {};

    if (!vehicles.length) {
        const legacy = localStorage.getItem('fuelRecords');
        const id = newVehicleId();
        vehicles = [{ id, plate: '我的車' }];
        fuelData[id] = legacy ? safeParseArray(legacy) : [];
        if (legacy) {
            localStorage.setItem('fuelRecords_v1', legacy); // 舊資料留一份，萬一搬移出錯還救得回
            localStorage.removeItem('fuelRecords');
        }
    }

    activeVid = localStorage.getItem('activeVehicle') || '';
    if (!vehicles.some(v => v.id === activeVid)) activeVid = vehicles[0].id;
    if (!Array.isArray(fuelData[activeVid])) fuelData[activeVid] = [];
    records = fuelData[activeVid];

    // 搬移完一定要立刻寫回：舊的 fuelRecords 已經刪掉，不存就真的沒了
    persist();
}

function activePlate() {
    const v = vehicles.find(x => x.id === activeVid);
    return v ? v.plate : '';
}

function switchVehicle(id) {
    if (!vehicles.some(v => v.id === id) || id === activeVid) return;

    persist(); // 先把目前這台存好再換
    activeVid = id;
    if (!Array.isArray(fuelData[activeVid])) fuelData[activeVid] = [];
    records = fuelData[activeVid];

    recalc();
    persist();
    resetForm();
    render();
    updateChart();
    renderVehicleUI();
}

function promptPlate(current) {
    const raw = prompt('車牌或車名（最多 10 字）', current || '');
    if (raw === null) return null;

    const plate = raw.trim().slice(0, 10);
    if (!plate) {
        alert('請輸入車牌或車名');
        return null;
    }
    return plate;
}

function addVehicle() {
    const plate = promptPlate('');
    if (!plate) return;

    const id = newVehicleId();
    vehicles.push({ id, plate });
    fuelData[id] = [];
    persist();
    switchVehicle(id);
}

function renameVehicle(id) {
    const v = vehicles.find(x => x.id === id);
    if (!v) return;

    const plate = promptPlate(v.plate);
    if (!plate) return;

    v.plate = plate;
    persist();
    renderVehicleUI();
}

function deleteVehicle(id) {
    if (vehicles.length <= 1) return alert('至少要保留一台車');

    const v = vehicles.find(x => x.id === id);
    if (!v) return;

    const n = (fuelData[id] || []).length;
    if (!confirm(`刪除「${v.plate}」會一併刪除它的 ${n} 筆紀錄，且無法復原。\n\n確定刪除嗎？`)) return;

    vehicles = vehicles.filter(x => x.id !== id);
    delete fuelData[id];

    if (activeVid === id) {
        activeVid = vehicles[0].id;
        if (!Array.isArray(fuelData[activeVid])) fuelData[activeVid] = [];
        records = fuelData[activeVid];
        recalc();
        resetForm();
    }

    persist();
    render();
    updateChart();
    renderVehicleUI();
}

function renderVehicleUI() {
    const sel = $('vehicleSelect');
    sel.innerHTML = vehicles.map(v => `<option value="${v.id}">${esc(v.plate)}</option>`).join('');
    sel.value = activeVid;
    $('sheetPlate').innerText = activePlate();

    const rows = vehicles.map(v => {
        const n = (fuelData[v.id] || []).length;
        const inUse = v.id === activeVid ? '<span class="tag">使用中</span>' : '';
        return `<div class="ios-item">
                <label class="vehicle-name" onclick="renameVehicle('${v.id}')">${esc(v.plate)}${inUse}</label>
                <span class="ios-value"><span class="vehicle-count">${n} 筆</span><span class="link-del" onclick="deleteVehicle('${v.id}')">刪除</span></span>
            </div>`;
    });
    rows.push('<div class="ios-item link-row" onclick="addVehicle()"><label>新增車輛</label><span class="ios-value">＋</span></div>');
    $('vehicleList').innerHTML = rows.join('');
}

// 金額為選填，舊紀錄沒有 cost 欄位，一律視為沒填
const hasCost = r => typeof r.cost === 'number' && !isNaN(r.cost) && r.cost > 0;
const money = n => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const money2 = n => '$' + n.toFixed(2);
const round2 = n => Number(n.toFixed(2));

// 初始化：每步驟獨立包起來，CDN 載入失敗時只有該功能失效，不會整個卡住
function init() {
    const steps = [showVersion, loadData, renderVehicleUI, setCurrentTime, () => applyTheme(theme), recalc, () => setMode(inputMode), render, applyStatsOpen, loadSavedPrice, updateCostHint, loadSavedCarrier, openAdd];
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

function showVersion() {
    $('appVersion').innerText = APP_VERSION;
}

// 統計卡片收合：收起來只剩一行摘要，條碼與表單整個往上移
function toggleStats() {
    statsOpen = !statsOpen;
    localStorage.setItem('statsOpen', statsOpen ? '1' : '0');
    applyStatsOpen();
}

function applyStatsOpen() {
    $('statsBody').style.display = statsOpen ? '' : 'none';
    $('statsBar').style.display = statsOpen ? 'none' : '';
}

// 外觀：跟隨系統 / 淺色 / 深色
function applyTheme(mode) {
    theme = (mode === 'light' || mode === 'dark') ? mode : 'system';
    localStorage.setItem('theme', theme);

    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);

    updateChart(); // 圖表的軸線與配色跟著主題走
    $('themeSystem').classList.toggle('active', theme === 'system');
    $('themeLight').classList.toggle('active', theme === 'light');
    $('themeDark').classList.toggle('active', theme === 'dark');
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

// 依目前表單算出這筆的行駛里程，算不出來回傳 null
function currentKm() {
    if (inputMode === 'trip') {
        const km = parseFloat($('distance').value);
        return !isNaN(km) && km > 0 ? km : null;
    }
    const odo = parseFloat($('odo').value);
    if (isNaN(odo)) return null;
    const prev = prevOdoRecord($('date').value, $('time').value, parseInt($('editIdx').value, 10));
    if (!prev) return odo > 0 ? Number(odo.toFixed(1)) : null;
    return odo > prev.odo ? Number((odo - prev.odo).toFixed(1)) : null;
}

// 單價會記住上次填的，下次加油通常差不多，不用每次重打
function loadSavedPrice() {
    const saved = parseFloat(localStorage.getItem('unitPrice'));
    if (!isNaN(saved) && saved > 0) $('price').value = saved;
}

// 單價 × 公升 = 金額。改哪一欄就補另外一欄，剛打的那欄不動
function syncMoney(source) {
    const ok = n => !isNaN(n) && n > 0;
    const l = parseFloat($('liters').value);
    const price = parseFloat($('price').value);
    const cost = parseFloat($('cost').value);

    if (source === 'cost') {
        if (ok(cost) && ok(l)) $('price').value = round2(cost / l);
    } else if (source === 'price') {
        if (ok(price) && ok(l)) $('cost').value = round2(price * l);
    } else {
        // 改公升：有單價就用單價算金額，沒單價才用已填的金額回推單價
        if (ok(l) && ok(price)) $('cost').value = round2(price * l);
        else if (ok(l) && ok(cost)) $('price').value = round2(cost / l);
    }

    updateCostHint();
}

// 即時試算每公里成本
function updateCostHint() {
    const hint = $('costHint');
    const cost = parseFloat($('cost').value);
    const km = currentKm();

    if (isNaN(cost) || cost <= 0 || !km) {
        hint.style.display = 'none';
        return;
    }

    hint.innerHTML = `每公里成本：<b>${(cost / km).toFixed(2)} 元/km</b>`;
    hint.style.display = '';
}

// 依總公里數重算里程與油耗（新增、編輯、刪除後都要跑）
function recalc(list) {
    let prevOdo = null;
    (list || records).forEach(r => {
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

// 匯出檔名用的日期，Excel 與 JSON 備份共用
function fileStamp() {
    return new Date().toLocaleDateString().replace(/\//g, '-');
}

function persist() {
    fuelData[activeVid] = records;
    localStorage.setItem('fuelData', JSON.stringify(fuelData));
    localStorage.setItem('vehicles', JSON.stringify(vehicles));
    localStorage.setItem('activeVehicle', activeVid);
}

// 只剩兩頁：0 = 主頁（圖表＋明細）, 1 = 設定
function tab(i) {
    document.querySelectorAll('.sec').forEach((s, x) => s.classList.toggle('active', x === i));
    document.body.classList.toggle('in-settings', i === 1);

    // 右上角同一顆鈕在設定頁變成關閉，不必捲到底找「完成」
    $('gearBtn').innerHTML = i === 1 ? '&times;' : '&#9881;';
    $('gearBtn').setAttribute('aria-label', i === 1 ? '關閉設定' : '設定');

    if (i === 0) updateChart();
    window.scrollTo(0, 0);
}

function toggleSettings() {
    tab(document.body.classList.contains('in-settings') ? 0 : 1);
}

// 新增紀錄的彈出視窗
function openAdd() {
    $('sheetPlate').innerText = activePlate();
    $('addSheet').classList.add('open');
    document.body.classList.add('sheet-open');

    renderInlineBarcode(); // 條碼放最上面，一打開就能給店員掃
    updateOdoHint();
    updateCostHint();
    $('addSheet').scrollTop = 0;
}

function closeAdd() {
    $('addSheet').classList.remove('open');
    document.body.classList.remove('sheet-open');
    resetForm(); // 關掉等於放棄這次輸入／編輯
}

// 儲存
function save() {
    const d = $('date').value;
    const t = $('time').value;
    const l = parseFloat($('liters').value);
    const km = parseFloat($('distance').value);
    const odo = parseFloat($('odo').value);
    const cost = parseFloat($('cost').value);
    const price = parseFloat($('price').value);
    const idx = parseInt($('editIdx').value, 10);

    if (!d || !t || isNaN(l) || l <= 0) return alert('請正確輸入日期、時間與公升數');
    if ($('cost').value.trim() !== '' && (isNaN(cost) || cost <= 0)) return alert('金額請填大於 0 的數字，或留空不填');
    if ($('price').value.trim() !== '' && (isNaN(price) || price <= 0)) return alert('單價請填大於 0 的數字，或留空不填');

    // 記住這次的單價，下次開 App 直接帶入
    if (!isNaN(price) && price > 0) localStorage.setItem('unitPrice', price);

    const costVal = (isNaN(cost) || cost <= 0) ? null : cost;

    let entry;
    if (inputMode === 'odo') {
        if (isNaN(odo)) return alert('請輸入現在的總公里數');
        const prev = prevOdoRecord(d, t, idx);
        if (prev && odo <= prev.odo) return alert(`總公里數必須大於上次的 ${prev.odo} km`);
        // km / cons 由 recalc() 依「現在總公里數 − 上次總公里數」算出
        entry = { d, t, l, cost: costVal, odo, km: null, cons: null };
    } else {
        if (isNaN(km) || km <= 0) return alert('請正確輸入里程');
        entry = { d, t, l, cost: costVal, km, cons: Number((km / l).toFixed(2)) };
    }

    if (idx === -1) records.push(entry);
    else records[idx] = entry;

    sortRecords(records);
    recalc();
    persist();

    render();
    closeAdd();
    tab(0); // 跳到明細頁
}

function resetForm() {
    $('editIdx').value = '-1';
    $('liters').value = '';
    $('distance').value = '';
    $('odo').value = '';
    $('cost').value = '';
    $('price').value = '';
    loadSavedPrice();
    $('cancelEditBtn').style.display = 'none';
    setCurrentTime();
    updateOdoHint();
    updateCostHint();
}

function cancelEdit() {
    closeAdd();
    tab(0);
}

// 渲染統計與清單
function render() {
    const valid = records.filter(r => typeof r.cons === 'number' && !isNaN(r.cons));
    const avgCons = valid.length ? (valid.reduce((s, r) => s + r.cons, 0) / valid.length).toFixed(2) : null;
    $('avgVal').innerText = avgCons || '0.00';
    $('countVal').innerText = records.length;
    $('lowVal').innerText = valid.length ? Math.min(...valid.map(r => r.cons)).toFixed(2) : '--';

    // 有填過金額才顯示這排，沒在記帳的人畫面不會多出三張空卡
    const withCost = records.filter(hasCost);
    $('costStats').style.display = withCost.length ? '' : 'none';
    if (withCost.length) {
        const totalCost = withCost.reduce((s, r) => s + r.cost, 0);
        // 每公里成本只算「金額與里程都有」的紀錄；起始筆的里程是里程表讀數，會把數字壓爛，排除
        const both = withCost.filter(r => r.km != null && !isNaN(r.km) && !r.base);
        const bothCost = both.reduce((s, r) => s + r.cost, 0);
        const bothKm = both.reduce((s, r) => s + r.km, 0);

        $('costTotalVal').innerText = money(totalCost);
        // 平均花費＝每次加油平均花多少（單價在每一列都看得到，不用再放一張卡）
        $('avgCostVal').innerText = money(round2(totalCost / withCost.length));
        $('costPerKmVal').innerText = bothKm ? money2(bothCost / bothKm) : '--';
    }

    // 收合那行的摘要：油耗擺前面，有記帳才補上總油錢
    $('statsBarMain').innerText = avgCons ? `平均 ${avgCons} km/L` : '還沒有紀錄';
    $('statsBarSub').innerText = withCost.length
        ? `${money(withCost.reduce((s, r) => s + r.cost, 0))} ／ ${records.length} 筆`
        : (records.length ? `${records.length} 筆` : '');

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

        const odoHtml = r.odo != null ? `<span class="tag">總 ${r.odo}km</span>` : '';
        const baseHtml = r.base ? '<span class="tag">起始</span>' : '';
        const kmText = r.km != null ? `${r.km}km / ${r.l}L` : `-- / ${r.l}L`;
        // 金額與單價併進同一行文字，不再做成標籤，右欄才有空間放編輯／刪除
        const costText = hasCost(r) ? ` · ${money(r.cost)}` : '';
        const priceText = (hasCost(r) && r.l > 0) ? ` · ${(r.cost / r.l).toFixed(2)}/L` : '';
        const consText = typeof r.cons === 'number' ? r.cons.toFixed(2) : '--';

        html.push(`
            <div class="record-row">
                <div class="record-main">
                    <div class="record-head"><b>${r.d}</b><span class="row-time">${r.t || ''}</span>${daysHtml}</div>
                    <div class="row-sub">${kmText}${costText}${priceText}</div>
                    <div class="row-tags">${odoHtml}${baseHtml}</div>
                </div>
                <div class="record-side">
                    <div class="record-cons">${diffHtml}<span class="record-val">${consText}</span></div>
                    <div class="record-actions">
                        <span class="link-edit" onclick="editRecord(${i})">編輯</span>
                        <span class="link-del" onclick="del(${i})">刪除</span>
                    </div>
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
    $('cost').value = hasCost(r) ? r.cost : '';
    $('price').value = (hasCost(r) && r.l > 0) ? round2(r.cost / r.l) : '';
    if (!$('price').value) loadSavedPrice();
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
    updateCostHint();
    openAdd();
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
// 直接讀 CSS 變數，深色／淺色切換時圖表才不會留著舊配色
function chartColors() {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    return {
        blue: pick('--ios-blue', '#007AFF'),
        gray: pick('--ios-gray', '#8E8E93'),
        sep: pick('--ios-sep', '#C6C6C8')
    };
}

// 在隱藏的分頁裡建立圖表，Chart.js 會把畫布尺寸記成 0 且事後 resize() 也救不回來，
// 所以延到第一次真的切到圖表分頁時才建。
function ensureChart() {
    if (chart) return chart;
    if (typeof Chart === 'undefined') return null; // 函式庫沒載到就跳過，其他功能照常
    if (!$('chart').offsetParent) return null;     // 分頁還藏著，等切過來再說

    const c = chartColors();

    chart = new Chart($('chart').getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: '油耗',
                    data: [],
                    borderColor: c.blue,
                    backgroundColor: c.blue + '22',
                    borderWidth: 2.5,
                    tension: 0.35,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: c.blue,
                    pointBorderWidth: 0
                },
                {
                    label: '平均',
                    data: [],
                    borderColor: c.gray,
                    borderWidth: 1,
                    borderDash: [5, 4],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0
                }
            ]
        },
        options: {
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    filter: item => item.datasetIndex === 0, // 平均線不進 tooltip
                    callbacks: {
                        title: items => {
                            const r = chartRows[items[0].dataIndex];
                            return r ? `${r.d} ${r.t || ''}`.trim() : '';
                        },
                        label: item => `油耗 ${item.parsed.y} km/L`,
                        afterBody: items => {
                            const r = chartRows[items[0].dataIndex];
                            if (!r) return [];
                            const lines = [`${r.km} km ／ ${r.l} L`];
                            if (hasCost(r)) lines.push(`${money(r.cost)}（${(r.cost / r.l).toFixed(2)}/L）`);
                            return lines;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: c.gray, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }
                },
                y: {
                    grid: { color: c.sep },
                    ticks: { color: c.gray, font: { size: 11 } }
                }
            }
        }
    });

    return chart;
}

function updateChart() {
    if (!ensureChart()) return;

    chartRows = records.filter(r => typeof r.cons === 'number' && !isNaN(r.cons));
    const avg = chartRows.length ? chartRows.reduce((s, r) => s + r.cons, 0) / chartRows.length : 0;

    // x 軸只放月-日，完整日期與時間留給 tooltip，窄螢幕才擠得下
    chart.data.labels = chartRows.map(r => r.d.slice(5));
    chart.data.datasets[0].data = chartRows.map(r => r.cons);
    chart.data.datasets[1].data = chartRows.map(() => Number(avg.toFixed(2)));

    const c = chartColors();
    const line = chart.data.datasets[0];
    line.borderColor = c.blue;
    line.backgroundColor = c.blue + '22';
    line.pointBackgroundColor = c.blue;
    chart.data.datasets[1].borderColor = c.gray;
    chart.options.scales.x.ticks.color = c.gray;
    chart.options.scales.y.ticks.color = c.gray;
    chart.options.scales.y.grid.color = c.sep;

    // 沒資料時用 visibility 藏起來，不能用 display:none ——
    // Chart.js 量不到尺寸就會把畫布縮成 0，之後再也撐不回來
    $('chart').style.visibility = chartRows.length ? 'visible' : 'hidden';
    $('chartEmpty').style.display = chartRows.length ? 'none' : '';

    // 圖表分頁建立時是隱藏的，Chart.js 當時量到 0 高度，切過來要重新量一次
    chart.resize();
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
        '金額 (元)': hasCost(r) ? r.cost : '',
        '單價 (元/L)': (hasCost(r) && r.l > 0) ? Number((r.cost / r.l).toFixed(2)) : '',
        '行駛里程 (km)': r.km != null ? r.km : '',
        '當次油耗 (km/L)': typeof r.cons === 'number' ? r.cons : '',
        '每公里成本 (元/km)': (hasCost(r) && r.km) ? Number((r.cost / r.km).toFixed(2)) : ''
    }));

    // 只有算得出里程的紀錄才納入平均
    const counted = records.filter(r => r.km != null && !isNaN(r.km));
    const totalLiters = records.reduce((s, r) => s + (r.l || 0), 0);
    const totalKm = counted.reduce((s, r) => s + r.km, 0);
    const countedLiters = counted.reduce((s, r) => s + (r.l || 0), 0);
    const avgCons = countedLiters ? (totalKm / countedLiters).toFixed(2) : 0;

    // 金額為選填，只把有填的紀錄納入統計
    const withCost = records.filter(hasCost);
    const totalCost = withCost.reduce((s, r) => s + r.cost, 0);
    const costLiters = withCost.reduce((s, r) => s + (r.l || 0), 0);
    const both = withCost.filter(r => r.km != null && !isNaN(r.km) && !r.base);
    const bothCost = both.reduce((s, r) => s + r.cost, 0);
    const bothKm = both.reduce((s, r) => s + r.km, 0);

    rows.push({
        '日期': '【總計統計】',
        '時間': '',
        '總公里數 (km)': '',
        '加油公升 (L)': Number(totalLiters.toFixed(2)),
        '金額 (元)': withCost.length ? Number(totalCost.toFixed(2)) : '',
        '單價 (元/L)': costLiters ? '平均:' + (totalCost / costLiters).toFixed(2) : '',
        '行駛里程 (km)': Number(totalKm.toFixed(1)),
        '當次油耗 (km/L)': '總平均:' + avgCons,
        '每公里成本 (元/km)': bothKm ? '平均:' + (bothCost / bothKm).toFixed(2) : ''
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '油耗記錄');
    const plate = activePlate().replace(/[\\/:*?"<>|]/g, '');
    XLSX.writeFile(wb, `油耗記錄_${plate}_${fileStamp()}.xlsx`);
}

// JSON 備份：Excel 是給人看的，這個是拿來還原的
function buildBackup() {
    persist(); // 確保 fuelData 是最新的
    return {
        app: 'oilAPP',
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        vehicles: vehicles,
        data: fuelData,
        activeVehicle: activeVid,
        settings: {
            carrierCode: localStorage.getItem('carrierCode') || '',
            unitPrice: localStorage.getItem('unitPrice') || '',
            inputMode: inputMode,
            theme: theme
        }
    };
}

function exportBackup() {
    const total = vehicles.reduce((s, v) => s + (fuelData[v.id] || []).length, 0);
    if (!total) return alert('目前沒有紀錄可以備份');

    const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `油耗備份_${fileStamp()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 備份檔可能來自別台手機，逐筆檢查再收下
function validRecord(r) {
    return !!r && typeof r.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.d) &&
        typeof r.l === 'number' && !isNaN(r.l) && r.l > 0;
}

function normalizeRecord(r) {
    const num = v => (typeof v === 'number' && !isNaN(v)) ? v : null;
    return {
        d: r.d,
        t: (typeof r.t === 'string' && r.t) ? r.t : '00:00',
        l: r.l,
        cost: (num(r.cost) !== null && r.cost > 0) ? r.cost : null,
        km: num(r.km),
        odo: num(r.odo),
        cons: null // 由 recalc() 重算，不信任備份檔裡的值
    };
}

function applyBackupSettings(s) {
    if (!s) return;

    if (typeof s.carrierCode === 'string' && /^[A-Z0-9+\-.]{7}$/.test(s.carrierCode)) {
        localStorage.setItem('carrierCode', s.carrierCode);
        $('carrierInput').value = s.carrierCode;
        renderInlineBarcode();
    }

    const price = parseFloat(s.unitPrice);
    if (!isNaN(price) && price > 0) localStorage.setItem('unitPrice', price);

    if (s.inputMode === 'trip' || s.inputMode === 'odo') setMode(s.inputMode);
    if (s.theme === 'system' || s.theme === 'light' || s.theme === 'dark') applyTheme(s.theme);
}

function importBackup(input) {
    const file = input.files && input.files[0];
    input.value = ''; // 清掉才能重選同一個檔案
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => alert('讀取檔案失敗，請再試一次');
    reader.onload = () => {
        let data;
        try {
            data = JSON.parse(reader.result);
        } catch (e) {
            return alert('這個檔案不是有效的 JSON 備份檔');
        }

        // 1.6.0 起的多車輛備份
        if (data && Array.isArray(data.vehicles) && data.data && typeof data.data === 'object') {
            return restoreMultiVehicle(data);
        }

        // 舊版備份或純紀錄陣列，收進目前這台車
        const list = Array.isArray(data) ? data : (data && data.records);
        if (!Array.isArray(list)) return alert('備份檔裡找不到加油紀錄');

        const clean = list.filter(validRecord).map(normalizeRecord);
        if (!clean.length) return alert('備份檔裡沒有可用的加油紀錄');

        const skipped = list.length - clean.length;
        const skipText = skipped ? `\n（有 ${skipped} 筆格式不符會被略過）` : '';
        if (!confirm(`備份檔有 ${clean.length} 筆紀錄，「${activePlate()}」目前有 ${records.length} 筆。\n還原會取代這台車的全部紀錄，且無法復原。${skipText}\n\n確定還原嗎？`)) return;

        records = sortRecords(clean);
        recalc();
        persist();

        applyBackupSettings(Array.isArray(data) ? null : data.settings);

        resetForm();
        render();
        updateChart();
        renderVehicleUI();
        alert(`已還原 ${records.length} 筆紀錄`);
        tab(0);
    };
    reader.readAsText(file);
}

// 多車輛備份：整包取代，車輛清單也一併換掉
function restoreMultiVehicle(data) {
    const vs = data.vehicles.filter(v => v && typeof v.id === 'string' && typeof v.plate === 'string');
    if (!vs.length) return alert('備份檔裡找不到車輛');

    const nextData = {};
    let total = 0;
    let skipped = 0;

    vs.forEach(v => {
        const list = Array.isArray(data.data[v.id]) ? data.data[v.id] : [];
        const clean = list.filter(validRecord).map(normalizeRecord);
        skipped += list.length - clean.length;
        sortRecords(clean);
        recalc(clean);
        nextData[v.id] = clean;
        total += clean.length;
    });

    const nowTotal = vehicles.reduce((s, v) => s + (fuelData[v.id] || []).length, 0);
    const skipText = skipped ? `\n（有 ${skipped} 筆格式不符會被略過）` : '';
    if (!confirm(`備份檔有 ${vs.length} 台車、共 ${total} 筆紀錄，目前有 ${vehicles.length} 台車、${nowTotal} 筆。\n還原會取代全部車輛與紀錄，且無法復原。${skipText}\n\n確定還原嗎？`)) return;

    vehicles = vs;
    fuelData = nextData;
    activeVid = vs.some(v => v.id === data.activeVehicle) ? data.activeVehicle : vs[0].id;
    records = fuelData[activeVid];

    persist();
    applyBackupSettings(data.settings);
    resetForm();
    render();
    updateChart();
    renderVehicleUI();
    alert(`已還原 ${vs.length} 台車、共 ${total} 筆紀錄`);
    tab(0);
}

function clearAll() {
    if (!confirm(`確定清除「${activePlate()}」的所有紀錄？這無法復原。\n（其他車輛不受影響）`)) return;
    records = [];
    persist();
    resetForm();
    render();
    updateChart();
    renderVehicleUI();
}

// 載具條碼
const barcodeOpts = {
    format: 'CODE128',
    // 每個模組的寬度。調小條碼會變窄，但太窄掃描器會讀不到，2 是還算保險的下限
    width: 2,
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
    // 設定頁不自動展開大張條碼，加油要掃的那張在「新增」頁下方
    renderInlineBarcode();
}

// 離開欄位就存起來，免得填完直接離開設定頁又要重填
function saveCarrier() {
    const raw = $('carrierInput').value.trim().toUpperCase();
    if (!/^[A-Z0-9+\-.]{7}$/.test(raw)) return;
    localStorage.setItem('carrierCode', raw);
    renderInlineBarcode();
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
