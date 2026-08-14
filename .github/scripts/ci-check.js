// CI check: validate index.html's inline JavaScript parses, and that key HTML tags balance.
// Kept as a real script file (not an inline `run:` one-liner) so there's no bash/YAML
// quoting layer to mangle regex escapes before Node ever sees this source.
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
let failed = false;

// 1. Syntax-check every inline <script> block (skip ones that just load an external src).
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const scripts = [...html.matchAll(scriptRe)].map(m => m[1]).filter(s => s.trim().length > 0);

if (scripts.length === 0) {
  console.error('No inline <script> blocks found to check.');
  failed = true;
} else {
  scripts.forEach((code, i) => {
    try {
      new Function(code);
      console.log('Script block ' + i + ': OK (' + code.length + ' chars)');
    } catch (e) {
      failed = true;
      console.error('Script block ' + i + ' FAILED to parse: ' + e.message);
    }
  });
}

// 2. Sanity-check that key HTML tags open/close in equal numbers.
['div', 'button', 'section', 'table', 'tr', 'td'].forEach(tag => {
  const openRe = new RegExp('<' + tag + '(\\s|>)', 'gi');
  const closeRe = new RegExp('</' + tag + '>', 'gi');
  const open = (html.match(openRe) || []).length;
  const close = (html.match(closeRe) || []).length;
  console.log(tag + ': ' + open + ' open / ' + close + ' close');
  if (open !== close) {
    console.error('Mismatched <' + tag + '> tags: ' + open + ' open vs ' + close + ' close');
    failed = true;
  }
});

if (failed) process.exit(1);
console.log('CI check passed.');
