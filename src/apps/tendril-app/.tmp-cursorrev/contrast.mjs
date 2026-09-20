import { chromium } from 'playwright';
import fs from 'fs';
const CSS = fs.readFileSync('/Users/rorychatt/git/ivy/Ivy-Tendril-V2/src/apps/tendril-app/dist/assets/index-CF61SBHh.css','utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

function lum([r,g,b]){const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
function ratio(a,b){const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);}

async function measure(theme, surfaceClass, html, sel){
  await page.setContent(`<!doctype html><html class="${theme}"><head><style>${CSS}</style></head>
    <body class="${theme}"><div id="surf" class="${surfaceClass}" style="padding:20px">${html}</div></body></html>`);
  return await page.evaluate((s)=>{
    const el=document.querySelector(s);
    const surf=document.getElementById('surf');
    const idle=getComputedStyle(el).backgroundColor;
    // force hover by cloning the rule: use :hover via CSS.escape not possible; instead read the
    // matched hover rule from the stylesheet.
    return {idle, surfBg:getComputedStyle(surf).backgroundColor, bodyBg:getComputedStyle(document.body).backgroundColor};
  }, sel);
}

// Composite alpha over surface, then compute ratio.
function parse(c){const m=c.match(/[\d.]+/g).map(Number); return m.length===4?m:[...m,1];}
function comp(fg,bg){const a=fg[3];return [0,1,2].map(i=>Math.round(fg[i]*a+bg[i]*(1-a)));}

const sites = [
  ['BadgeSelect item (.bselect-item)', '.bselect-item', 'var(--accent)', 'popover'],
  ['BadgeSelect trigger', '.bselect-trigger', 'var(--accent)', 'background'],
  ['PlanChangesView tree row', '.ivy-changes-tree-row', 'var(--accent)', 'card'],
  ['ContentInput dropdown item', '.civ-dropdown-item', 'var(--accent)', 'popover'],
  ['ContentInput project menu item', '.civ-project-menu-item', 'var(--accent)', 'popover'],
  ['PlanMarkdown summary', '.pmv-markdown summary', 'accent/50', 'card'],
  ['PlanMarkdown selection toolbar btn', '.pmv-selection-toolbar-btn', 'var(--muted)', 'popover'],
  ['PlanMarkdown wireframe button', '.pmv-wireframe-button', 'var(--muted)', 'card'],
  ['tui-btn--ghost', '.tui-btn--ghost', 'var(--muted)', 'background'],
  ['tui-icon-btn outline', '.tui-icon-btn[data-variant=outline]', 'var(--accent)', 'background'],
  ['TendrilProcessViewer arrow label', '.tpv-arrow-label', 'var(--muted)', 'background'],
];

for (const theme of ['','dark']) {
  await page.setContent(`<!doctype html><html class="${theme}"><head><style>${CSS}</style></head><body class="${theme}"></body></html>`);
  const toks = await page.evaluate(()=>{
    const cs=getComputedStyle(document.body);
    const g=n=>cs.getPropertyValue(n).trim();
    return {bg:g('--background'),card:g('--card'),popover:g('--popover'),accent:g('--accent'),muted:g('--muted'),secondary:g('--secondary')};
  });
  console.log(`\n### theme=${theme||'light'} tokens:`, toks);
  const hex=h=>{h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));};
  const S={background:hex(toks.bg),card:hex(toks.card),popover:hex(toks.popover)};
  const A=hex(toks.accent), M=hex(toks.muted), SEC=hex(toks.secondary);
  for (const [name, sel, fill, surf] of sites) {
    const base=S[surf];
    let f;
    if(fill==='var(--accent)') f=[...A,1];
    else if(fill==='var(--muted)') f=[...M,1];
    else f=[...A,0.5];
    const got=ratio(comp(f,base), base);
    const sec60=ratio(comp([...SEC,0.6],base), base);
    console.log(`  ${got.toFixed(3)}  (secondary/60 would be ${sec60.toFixed(3)})  ${name}  [${fill} on --${surf}]`);
  }
}
await browser.close();
