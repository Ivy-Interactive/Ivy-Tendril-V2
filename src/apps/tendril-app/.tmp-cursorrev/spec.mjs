import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
// Minimal reproduction of ONLY the two base.css clauses, in source order.
const css = `
@layer base {
 button:not(:disabled):not([aria-disabled="true"]):not([data-disabled]:not([data-disabled="false"])),
 [role="button"]:not([aria-disabled="true"]):not([data-disabled]:not([data-disabled="false"])),
 [role="tab"]:not([aria-disabled="true"]),
 [role="menuitem"]:not([aria-disabled="true"]),
 [role="option"]:not([aria-disabled="true"]) { cursor: pointer; }
 button:disabled, select:disabled, input:disabled,
 [aria-disabled="true"], [data-disabled]:not([data-disabled="false"]) { cursor: not-allowed; }
}`;
await page.setContent('<style>'+css+'</style>');
const r = await page.evaluate(()=>{
  const out={};
  const mk=(h,s)=>{document.body.innerHTML=h;return getComputedStyle(document.querySelector(s)).cursor;};
  out['<button disabled>']                      = mk('<button disabled>x</button>','button');
  out['<button role=tab disabled>']             = mk('<button role="tab" disabled>x</button>','button');
  out['<button role=button disabled>']          = mk('<button role="button" disabled>x</button>','button');
  out['<button role=menuitem disabled>']        = mk('<button role="menuitem" disabled>x</button>','button');
  out['<button role=option disabled>']          = mk('<button role="option" disabled>x</button>','button');
  out['<button role=tab aria-disabled=true>']   = mk('<button role="tab" aria-disabled="true">x</button>','button');
  out['<button role=tab data-disabled="">']     = mk('<button role="tab" data-disabled="">x</button>','button');
  return out;
});
for(const [k,v] of Object.entries(r)) console.log((v==='not-allowed'?' OK  ':'BUG  ')+v.padEnd(12)+k);
console.log('\nspecificity: [role="tab"]:not([aria-disabled="true"]) = (0,2,0)');
console.log('             button:disabled                          = (0,1,1)  -> LOSES');
await browser.close();
