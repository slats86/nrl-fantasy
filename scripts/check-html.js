const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (!blocks.length) throw new Error('No JavaScript blocks found in index.html');
blocks.forEach((match, index) => new vm.Script(match[1], {filename: `index.html script ${index + 1}`}));
console.log(`Checked ${blocks.length} JavaScript blocks`);
