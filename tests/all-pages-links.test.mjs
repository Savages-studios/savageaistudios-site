/* Exhaustive local route and fragment audit across the static website.
   No external requests and no payment interactions. */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync,statSync,existsSync} from "node:fs";
import {resolve,relative,dirname,extname,sep} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
function collect(dir) {
  const results=[];
  for(const e of readdirSync(dir,{withFileTypes:true})){
    if(e.name.startsWith(".")||["node_modules","tests","docs"].includes(e.name))continue;
    const path=resolve(dir,e.name);
    if(e.isDirectory()) results.push(...collect(path));
    else if(e.isFile()&&extname(path)===".html") results.push(path);
  }
  return results;
}
const pages=collect(root);
const ids=new Map();
function allIds(file) {
  if(!ids.has(file)){
    const s=readFileSync(file,"utf8");
    ids.set(file,new Set([...s.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1])));
  }
  return ids.get(file);
}

test("all 44 HTML pages have working local href/src paths and hash targets",()=>{
  assert.equal(pages.length,44,"Site page inventory changed—review coverage intentionally");
  let inspected=0;
  for(const page of pages){
    const content=readFileSync(page,"utf8");
    const local=relative(root,page);
    for(const [,url] of content.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)){
      if(/^(?:https?:|mailto:|tel:|sms:|data:|javascript:|\/\/)/i.test(url))continue;
      const parts=url.split("#");
      const pathPart=parts[0].split("?")[0];
      const fragment=parts.length>1?decodeURIComponent(parts[1]):"";
      if(!pathPart&&!fragment)continue;
      let dest=pathPart.startsWith("/")?resolve(root,"."+pathPart):resolve(dirname(page),decodeURIComponent(pathPart));
      if(!pathPart)dest=page;
      if(existsSync(dest)&&statSync(dest).isDirectory())dest=resolve(dest,"index.html");
      assert.ok(dest===root||dest.startsWith(root+sep),"Path escaped website root: "+local+" → "+url);
      assert.ok(existsSync(dest)&&statSync(dest).isFile(),"Broken local reference: "+local+" → "+url);
      if(fragment) assert.ok(allIds(dest).has(fragment),"Broken local fragment: "+local+" → "+url);
      inspected++;
    }
  }
  assert.ok(inspected>150,"Unexpectedly few local references inspected");
});

test("main-page modernized navigation uses one accessible mobile disclosure",()=>{
  for(const file of ["index.html","work.html","about.html","overmind.html","studio.html","coding-blind.html"]){
    const c=readFileSync(resolve(root,file),"utf8");
    assert.match(c,/class="refresh-v3(?: [^"]*)?"/);
    assert.match(c,/href="site-refresh.css"/);
    assert.equal((c.match(/<details class="mobile-menu">/g)||[]).length,1,file);
    assert.match(c,/aria-label="Mobile navigation"/);
    assert.match(c,/aria-label="Primary navigation"/);
    assert.match(c,/class="skip-link" href="#main"/);
    assert.match(c,/<main id="main">/);
  }
});

test("every nested page includes a skip link and its main target",()=>{
  for(const page of pages.filter(p=>relative(root,p).includes(sep))){
    const html=readFileSync(page,"utf8");
    assert.match(html,/<a class="skip-link" href="#main">Skip to main content<\/a>/,relative(root,page));
    assert.match(html,/<main id="main">/,relative(root,page));
  }
});

test("busy catalogs have product-specific accessible purchase names",()=>{
  for(const [path,count] of [["products/index.html",26],["coloring-books/index.html",5]]){
    const html=readFileSync(resolve(root,path),"utf8");
    assert.equal((html.match(/class="buy-btn"/g)||[]).length,count);
    assert.equal((html.match(/class="buy-btn" href="[^"]+" aria-label="[^"]+"/g)||[]).length,count);
  }
});


test("France invoice readiness pilot page is truthful and reachable",()=>{
  const page=readFileSync(resolve(root,"invoice-readiness.html"),"utf8");
  const catalog=readFileSync(resolve(root,"work.html"),"utf8");
  assert.match(catalog,/href="invoice-readiness.html">France invoice readiness pilot/);
  assert.match(page,/<title>France Invoice Readiness Pilot \| Savage AI Studios<\/title>/);
  assert.match(page,/<a class="skip-link" href="#main">Skip to main content<\/a>/);
  assert.match(page,/<main id="main">/);
  assert.match(page,/Proposed pilot price: \$1,500/);
  assert.match(page,/up to 10 synthetic or redacted structured invoice JSON cases/);
  assert.match(page,/does not replace that platform/);
  assert.match(page,/does not submit invoices/);
  assert.match(page,/Do not send production invoices/);
  assert.doesNotMatch(page,/buy\\.stripe\\.com/);
  assert.doesNotMatch(page,/<input[^>]+type=["']file["']/i);
  assert.match(page,/href="contact.html">Request the pilot scope/);
});
