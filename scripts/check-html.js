const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => !/\bsrc\s*=/.test(match[1]));
if (!blocks.length) throw new Error('No JavaScript blocks found in index.html');
blocks.forEach((match, index) => new vm.Script(match[2], {filename: `index.html script ${index + 1}`}));
const external = [...html.matchAll(/<script\s+src="(\/assets\/[^"]+\.js)"\s*><\/script>/gi)];
external.forEach(match => {
  const file = path.join('public', match[1].replace(/^\/assets\//, 'assets/'));
  new vm.Script(fs.readFileSync(file, 'utf8'), {filename: file});
});
console.log(`Checked ${blocks.length} inline and ${external.length} external JavaScript blocks`);
