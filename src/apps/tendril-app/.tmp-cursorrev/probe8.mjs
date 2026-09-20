import { chromium } from 'playwright';
import fs from 'fs';
const CSS = fs.readFileSync('/Users/rorychatt/git/ivy/Ivy-Tendril-V2/src/apps/tendril-app/dist/assets/index-CF61SBHh.css','utf8');
const ssr = JSON.parse(fs.readFileSync('/tmp/cursorrev/ssr2.json','utf8'));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><head><style>'+CSS+'</style></head><body></body></html>');
async function q(html, sels){
  return await page.evaluate(([h,ss])=>{
    document.body.innerHTML=h;
    return ss.map(s=>{const e=document.querySelector(s); return e?getComputedStyle(e).cursor:'NO-MATCH';});
  },[html,sels]);
}
console.log('--- Toolbar aria-disabled INHERITANCE (toolbar.tsx:257) ---');
const tb = '<div role="toolbar" aria-disabled="true"><button id="b">tool</button><span id="s">label</span><input id="i" type="text"></div>';
console.log('  root/button/span/input:', await q(tb,['[role=toolbar]','#b','#s','#i']));
console.log('  (enabled toolbar):', await q(tb.replace('aria-disabled="true"','aria-disabled="false"'),['[role=toolbar]','#b','#s','#i']));

console.log('\n--- Card disabled INHERITANCE (card.tsx:14) ---');
console.log('  ', await q(ssr['Card disabled'],['div','p']));

console.log('\n--- VaultDialogShell submit: disabled + aria-disabled Button ---');
console.log('  ', await q('<button disabled aria-disabled="true" class="cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none">Submit</button>',['button']));

console.log('\n--- KeyboardShortcutsHelp inactive row ---');
console.log('  row/inner kbd/inner text:', await q('<div aria-disabled="true" class="flex items-center gap-2"><span id="t">Toggle sidebar</span><kbd id="k">Cmd B</kbd></div>',['div','#t','#k']));

console.log('\n--- aria-disabled=false / undefined must NOT be not-allowed ---');
console.log('  aria-disabled="false":', await q('<div aria-disabled="false"><button id="b">x</button></div>',['div','#b']));
await browser.close();
