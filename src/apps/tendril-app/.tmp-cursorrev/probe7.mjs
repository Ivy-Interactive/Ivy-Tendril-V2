import { chromium } from 'playwright';
import fs from 'fs';
const CSS = fs.readFileSync('/Users/rorychatt/git/ivy/Ivy-Tendril-V2/src/apps/tendril-app/dist/assets/index-CF61SBHh.css','utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><head><style>'+CSS+'</style></head><body></body></html>');
const ROW_I = "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const cases = [
 ['SidebarListRow role=tab DISABLED (has disabled:cursor-not-allowed)',
  `<button type="button" role="tab" disabled class="flex w-full items-center gap-2 py-1.5 ${ROW_I}">row</button>`, 'button', 'not-allowed'],
 ['SidebarListRow role=option DISABLED',
  `<button type="button" role="option" disabled class="${ROW_I}">row</button>`, 'button', 'not-allowed'],
 ['PlanWorkspace .pws-menu-item role=menuitem DISABLED (css says cursor:default)',
  '<div class="pws-menu" role="menu"><button type="button" role="menuitem" class="pws-menu-item" disabled>item</button></div>', 'button', 'default'],
 ['PlanWorkspace .pws-menu-item role=menuitem ENABLED',
  '<div class="pws-menu" role="menu"><button type="button" role="menuitem" class="pws-menu-item">item</button></div>', 'button', 'pointer'],
 ['WebViewer .wvr-menu-item role=menuitemradio ENABLED',
  '<div class="wvr-menu" role="menu"><button type="button" role="menuitemradio" class="wvr-menu-item">d</button></div>', 'button', 'pointer'],
 ['ShellTabs .tsh-tab role=tab', '<div class="tsh-tabs"><div class="tsh-tab" role="tab" tabindex="0">tab</div></div>', '.tsh-tab', 'pointer'],
 ['BadgeSelect role=combobox div (.bselect-trigger)', '<div role="combobox" tabindex="0" class="bselect-trigger">c</div>', 'div', 'pointer'],
 ['BadgeSelect role=option (.bselect-item)', '<div role="option" class="bselect-item">o</div>', 'div', 'pointer'],
 ['AgentPicker role=menuitemradio (has own cursor-pointer)', '<div role="menuitemradio" tabindex="0" class="group flex cursor-pointer items-center">a</div>', 'div', 'pointer'],
 ['tdb-kpi button (Dashboard)', '<button class="tdb-kpi">kpi</button>', 'button', 'pointer'],
 ['tdb-tab button', '<button class="tdb-tab">t</button>', 'button', 'pointer'],
 ['tdb-job-row button', '<button class="tdb-job-row">j</button>', 'button', 'pointer'],
 ['civ-submit-btn disabled', '<button class="civ-submit-btn" disabled>s</button>', 'button', 'not-allowed'],
 ['tq-submit disabled', '<button class="tq-submit" disabled>s</button>', 'button', 'not-allowed'],
 ['ci-ghost-btn', '<button class="ci-ghost-btn">g</button>', 'button', 'pointer'],
 ['tsh-logo-toggle', '<button class="tsh-logo-toggle">l</button>', 'button', 'pointer'],
 ['aov-tool-header (div, unlayered css)', '<div class="aov-tool-header">h</div>', 'div', 'pointer'],
 ['tpv-box', '<div class="tpv-box">b</div>', 'div', 'pointer'],
 ['pmv-img-clickable img', '<img class="pmv-img-clickable" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">', 'img', 'pointer'],
 ['pmv-annotation-highlight', '<span class="pmv-annotation-highlight">h</span>', 'span', 'pointer'],
 ['ivy-changes-tree-row selected', '<div class="ivy-changes-tree-row ivy-changes-tree-row-selected" role="treeitem">t</div>', 'div', 'pointer'],
 ['MarkdownRenderer cursor-zoom-in img', '<img class="cursor-zoom-in" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">', 'img', 'zoom-in'],
 ['ImageOverlay cursor-zoom-out backdrop', '<div class="cursor-zoom-out">bd</div>', 'div', 'zoom-out'],
 ['EmojiRating disabled button', '<button class="cursor-not-allowed hover:scale-100" disabled>e</button>', 'button', 'not-allowed'],
];
let fails=0;
for(const [label,html,sel,exp] of cases){
  const c = await page.evaluate(([h,s])=>{document.body.innerHTML=h;const e=document.querySelector(s);return e?getComputedStyle(e).cursor:'NO-MATCH';},[html,sel]);
  const ok = c===exp; if(!ok) fails++;
  console.log(`${ok?' OK ':'FAIL'}  ${String(c).padEnd(12)} ${label}`);
}
console.log(`\n${cases.length} cases, ${fails} FAIL`);
await browser.close();
