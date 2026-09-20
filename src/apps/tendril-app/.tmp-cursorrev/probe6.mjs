import { chromium } from 'playwright';
import fs from 'fs';
const CSS = fs.readFileSync('/Users/rorychatt/git/ivy/Ivy-Tendril-V2/src/apps/tendril-app/dist/assets/index-CF61SBHh.css','utf8');
const ssr = JSON.parse(fs.readFileSync('/tmp/cursorrev/ssr2.json','utf8'));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><head><style>'+CSS+'</style></head><body style="cursor:auto"></style></head><body></body></html>');

// Determine the cursor a USER actually sees: hit-test the point, then walk up
// from the hit element (pointer-events:none makes an element non-hit-testable).
async function seen(html, sel){
  return await page.evaluate(([h,s])=>{
    document.body.innerHTML = h;
    const el = document.querySelector(s);
    if(!el) return {err:'NO-MATCH'};
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return {
      computed: getComputedStyle(el).cursor,
      pe: getComputedStyle(el).pointerEvents,
      hitTag: hit ? hit.tagName.toLowerCase()+(hit===el?' (SELF)':'') : null,
      seen: hit ? getComputedStyle(hit).cursor : '(no hit)',
      rect: [Math.round(r.width),Math.round(r.height)],
    };
  },[html,sel]);
}

const cases = [
 ['TabsTrigger DISABLED', ssr['Tabs disabled trigger'], 'button[role=tab]'],
 ['TabsTrigger enabled', ssr['Tabs disabled trigger'].replace(' disabled=""',''), 'button[role=tab]'],
 ['role=tab disabled WITHOUT pointer-events-none', '<button role="tab" disabled style="padding:8px">B</button>', 'button'],
 ['role=menuitem button disabled', '<button role="menuitem" disabled style="padding:8px">m</button>', 'button'],
 ['role=option button disabled', '<button role="option" disabled style="padding:8px">o</button>', 'button'],
 ['role=button button disabled', '<button role="button" disabled style="padding:8px">b</button>', 'button'],
 ['role=menuitemradio button disabled', '<button role="menuitemradio" disabled style="padding:8px">m</button>', 'button'],
 ['role=menuitemcheckbox disabled', '<button role="menuitemcheckbox" disabled style="padding:8px">m</button>', 'button'],
 ['plain button disabled (control)', '<button disabled style="padding:8px">x</button>', 'button'],
 ['Checkbox DISABLED (radix)', ssr['Checkbox disabled'], 'button'],
 ['Button DISABLED (buttonVariant)', '<button disabled class="cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none" style="padding:8px">x</button>', 'button'],
 ['Card disabled inner paragraph', ssr['Card disabled'], 'p'],
];
for(const [label,html,sel] of cases){
  const r = await seen(html, sel);
  console.log(`${label}`);
  console.log(`   computed=${r.computed}  pointer-events=${r.pe}  hit=${r.hitTag}  USER-SEES=${r.seen}`);
}
await browser.close();
