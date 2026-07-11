'use strict';

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'index.html');
const assetDir = path.join(__dirname, '..', 'public', 'assets');
const assets = [
  {marker: '/* ================= DATA ================= */', file: 'data-core.js'},
  {marker: '/* ===== REAL SEASON DATA', file: 'season-data.js'},
  {marker: '/* ===== PREVIOUS SEASONS BY POSITION', file: 'history-data.js'}
];

let html = fs.readFileSync(htmlPath, 'utf8');
fs.mkdirSync(assetDir, {recursive: true});

for (const asset of assets) {
  const src = `/assets/${asset.file}`;
  if (html.includes(`src="${src}"`)) {
    if (!fs.existsSync(path.join(assetDir, asset.file))) throw new Error(`Missing extracted asset ${asset.file}`);
    continue;
  }
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const block = blocks.find(match => match[1].includes(asset.marker));
  if (!block) throw new Error(`Could not find script marker ${asset.marker}`);
  fs.writeFileSync(path.join(assetDir, asset.file), block[1].replace(/^\n/, '') + '\n');
  html = html.slice(0, block.index) + `<script src="${src}"></script>` + html.slice(block.index + block[0].length);
}

fs.writeFileSync(htmlPath, html);
console.log('Extracted cacheable data assets');
