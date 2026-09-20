import { chromium } from 'playwright';
import fs from 'fs';
const CSS = fs.readFileSync('/Users/rorychatt/git/ivy/Ivy-Tendril-V2/src/apps/tendril-app/dist/assets/index-CF61SBHh.css','utf8');
const ssr = JSON.parse(fs.readFileSync('/tmp/cursorrev/ssr2.json','utf8'));
const cases = [
 ['DropdownMenuItem','DropdownMenuItem','[role=menuitem],div'],
 ['Popover trigger','Popover trigger','button'],
 ['CommandItem','Command','[cmdk-item],[role=option]'],
 ['CommandInput (text field)','Command','input'],
 ['MenubarTrigger','Menubar','button'],
 ['ContextMenuTrigger','ContextMenu trigger','span,div'],
 ['StepperTrigger','Stepper','button'],
 ['CollapsibleTrigger','Collapsible trigger','button'],
 ['Label (htmlFor, no wrapped input)','Label','label'],
 ['Input text','Input','input'],
 ['Textarea','Textarea','textarea'],
 ['Avatar fallback','Avatar','span,div'],
 ['Skeleton','Skeleton','div'],
 ['Multiselect trigger','Multiselect','button,div'],
 ['Accordion DISABLED trigger','Accordion','button'],
 ['Tabs DISABLED trigger','Tabs disabled trigger','button[role=tab]'],
 ['Checkbox DISABLED','Checkbox disabled','button'],
 ['Switch DISABLED','Switch disabled','button'],
 ['Select DISABLED trigger','Select disabled','button'],
 ['Card disabled (container)','Card disabled','div'],
 ['Card disabled INNER TEXT','Card disabled','p'],
 ['Toolbar root','Toolbar','[role=toolbar]'],
 ['Toolbar inner button','Toolbar','button'],
 ['Slider DISABLED thumb','Slider disabled','[role=slider]'],
 ['StatusLine','StatusLine','div,span'],
 ['PaginationPrevious (<a>)','Pagination','a'],
];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><head><style>'+CSS+'</style></head><body></body></html>');
for (const [label, key, sel] of cases) {
  const html = ssr[key];
  if (!html || html.startsWith('ERROR') || html.length===0) { console.log(`  --           ${label} (no markup)`); continue; }
  const r = await page.evaluate(([h,s]) => {
    document.body.innerHTML = h;
    const el = document.querySelector(s);
    if (!el) return {c:'NO-MATCH'};
    return {c:getComputedStyle(el).cursor, tag:el.tagName.toLowerCase(), cls:(el.className||'').toString().slice(0,60)};
  }, [html, sel]);
  console.log(`  ${String(r.c).padEnd(12)} ${label.padEnd(36)} <${r.tag||'?'}>`);
}
await browser.close();
