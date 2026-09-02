// 把網頁檔案複製到 www/，給 Capacitor 打包成 APK 用。
// 網頁版（GitHub Pages）直接讀專案根目錄，兩邊共用同一份原始碼。
const fs = require('fs');
const path = require('path');

const OUT = 'www';

// Service Worker 在 APK 裡沒有用處（檔案本來就在本機），排除掉避免多一層快取難以更新
const FILES = ['index.html', 'style.css', 'script.js', 'fuel.png', 'manifest.json'];
const DIRS = ['vendor'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of FILES) {
    fs.copyFileSync(f, path.join(OUT, f));
}
for (const d of DIRS) {
    fs.cpSync(d, path.join(OUT, d), { recursive: true });
}

// APK 內不註冊 Service Worker
const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(
    /\n\s*<!-- 離線快取[\s\S]*?<\/script>\n/,
    '\n'
);
fs.writeFileSync(indexPath, html);

const size = FILES.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`已輸出 ${FILES.length} 個檔案到 ${OUT}/（${Math.round(size / 1024)} KB）`);
console.log('Service Worker 註冊碼已移除:', !html.includes('serviceWorker.register'));
