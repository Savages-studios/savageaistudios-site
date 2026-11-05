/* Source-level homepage regression checks.
 * Run: node --test tests/site-refresh.test.mjs
 * No network access or third-party dependencies required.
 * Static checks are NOT a substitute for visual, accessibility or payment E2E audits.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const homepage = readFileSync(resolve(root,"index.html"),"utf8");
const stylesheet = readFileSync(resolve(root,"site-refresh.css"),"utf8");
const pageLinks = [...homepage.matchAll(/href=["']([^"']+)["']/g)].map(match=>match[1]);
const count = (needle) => (homepage.match(needle)||[]).length;

test("accessible HTML language and one H1",() => {
  assert.match(homepage,/<html lang="en">/);
  assert.equal(count(/<h1\b/g),1);
  assert.equal(count(/<main\b/g),1);
  assert.equal(count(/<\/main>/g),1);
  assert.match(homepage,/class="skip-link" href="#main"/);
  assert.match(homepage,/id="main"/);
});

test("mobile keyboard navigation is semantic",() => {
  assert.match(homepage,/<details class="mobile-menu">/);
  assert.match(homepage,/<summary aria-label="Toggle website navigation">/);
  assert.match(homepage,/aria-label="Mobile navigation"/);
  assert.match(homepage,/aria-label="Primary navigation"/);
});

test("homepage has a unique on-page target for every hash-only CTA",() => {
  for(const href of pageLinks.filter(href=>href.startsWith("#"))) {
    const target=href.slice(1);
    assert.match(homepage,new RegExp('id=["\\\']'+target+'["\\\']'),href);
  }
});

test("local linked content files exist",() => {
  for(const href of pageLinks) {
    if(/^(https?:|mailto:|tel:|#)/.test(href)) continue;
    const path = href.split("#")[0].split("?")[0];
    if(!path) continue;
    const file=path.endsWith("/")?path+"index.html":path;
    assert.ok(existsSync(resolve(root,file)), "Local link missing: "+href);
    if(href.includes("#")) {
      const fragment=href.split("#")[1];
      if(fragment) assert.match(readFileSync(resolve(root,file),"utf8"),new RegExp('id=["\\\']'+fragment+'["\\\']'),"Broken hash: "+href);
    }
  }
});

test("all five Bubble destinations remain reachable through page links",() => {
  for(const name of ["reviewloop","bookshield-barbers","chairconfirm","balloonboard","jobsaver"]) {
    assert.ok(pageLinks.includes("https://"+name+".bubbleapps.io"),name+" removed");
  }
});

test("contact, external Overmind, catalog and audits paths stay present",() => {
  for(const href of ["contact.html","mailto:savagnic@gmail.com","https://ovmtruth.com","work.html","work.html#audits","products/","coloring-books/","coding-blind.html"]) {
    assert.ok(pageLinks.includes(href),href);
  }
});

test("source design does not claim stale unsupported counts",() => {
  assert.doesNotMatch(homepage,/\b33 GitHub repositories\b|\b14 products with live checkout\b|\b84 AI actors\b/);
  assert.doesNotMatch(homepage,/data-count=/);
});

test("search metadata points at the public studio domain",() => {
  assert.match(homepage,/<link rel="canonical" href="https:\/\/savageaistudios.com\/">/);
  assert.match(homepage,/<meta property="og:description"/);
  assert.match(homepage,/<meta name="description"/);
});

test("isolated styles load after preserved shared stylesheet",() => {
  const oldStyle=homepage.indexOf('href="style.css"');
  const refreshStyle=homepage.indexOf('href="site-refresh.css"');
  assert.ok(oldStyle>=0&&refreshStyle>oldStyle);
  assert.ok(stylesheet.startsWith("/* Savage AI Studios homepage refresh"));
  assert.match(homepage,/class="refresh-v3"/);
  assert.match(stylesheet,/\.refresh-v3 \.hero-grid/);
});

test("small screens, keyboard focus and reduced motion covered",() => {
  assert.match(stylesheet,/@media\(max-width:550px\)/);
  assert.match(stylesheet,/@media\(max-width:850px\)/);
  assert.match(stylesheet,/prefers-reduced-motion:reduce/);
  assert.match(stylesheet,/:focus-visible/);
  assert.equal((stylesheet.match(/\{/g)||[]).length,(stylesheet.match(/\}/g)||[]).length);
});

test("motion engine is unchanged and still available",() => {
  assert.match(homepage,/<script src="motion.js" defer><\/script>/);
  assert.ok(existsSync(resolve(root,"motion.js")));
  assert.match(homepage,/<canvas class="hero-canvas" aria-hidden="true"><\/canvas>/);
});

test("catalog category navigation and purchase URLs stay stable",() => {
  const catalog=readFileSync(resolve(root,"work.html"),"utf8");
  assert.match(catalog,/class="refresh-v3 catalog-refresh"/);
  assert.match(catalog,/<details class="mobile-menu">/);
  for(const section of ["software","audits","applications","sia-v6"]) {
    assert.ok(catalog.includes('id="'+section+'"'),"Missing catalog section: "+section);
  }
  const stripeLinks=[...catalog.matchAll(/href="(https:\/\/buy\.stripe\.com\/[^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(stripeLinks,["https://buy.stripe.com/bJe14mePedgege1gehaIM06","https://buy.stripe.com/28E28qcH66RQ6Drd25aIM0d","https://buy.stripe.com/6oUcN4bD28ZYge18LPaIM0M","https://buy.stripe.com/5kQ28qdLa0ts3rf5zDaIM0u","https://buy.stripe.com/9B600i9uU8ZYe5Td25aIM0D","https://buy.stripe.com/fZu14m6iI2BA0f32nraIM09","https://buy.stripe.com/6oU14m8qQeki8LzbY1aIM0E","https://buy.stripe.com/cNi28qfTia42aTH0fjaIM0i","https://buy.stripe.com/dRm28q9uU3FEbXL8LPaIM0C","https://buy.stripe.com/9B67sK6iIdgebXLaTXaIM0U","https://buy.stripe.com/fZu6oG9uUa422nb6DHaIM0m","https://buy.stripe.com/28E3cubD20ts5zne69aIM0T","https://buy.stripe.com/00w9AS6iI4JI7Hv7HLaIM0j","https://buy.stripe.com/5kQeVcbD22BA8Lz9PTaIM05"]);
  assert.equal((catalog.match(/class="buy-btn" href=/g)||[]).length,15);
  assert.equal((catalog.match(/class="buy-btn" href="[^"]+" aria-label="/g)||[]).length,15);
  assert.doesNotMatch(catalog,/81 actors built|33 repositories|Eleven product families, every one/);
});

test("all 43 discovered HTML pages load the correct accessible motion engine",() => {
  const rootPages=["about.html","coding-blind.html","contact-thanks.html","contact.html","faultline.html","index.html","legal.html","overmind.html","studio.html","work.html"];
  const nestedPages=["coloring-books/index.html","coloring-books/thanks-bird.html","coloring-books/thanks-bridge.html","coloring-books/thanks-honey.html","coloring-books/thanks-moon.html","coloring-books/thanks-rain.html","products/agent-protocol-settlement/index.html","products/ai-action-adjudication-api/index.html","products/anomaly-detection-api/index.html","products/benchmark-robustness-audit/index.html","products/causalswarm-consensus-assessment/index.html","products/ceros-cockpit-ui/index.html","products/computation-proof-certificate/index.html","products/conservation-sentinel-monitor/index.html","products/constitutional-governance-api/index.html","products/constitutional-triadic-scorer/index.html","products/domain-vertical-audit/index.html","products/dual-anchor-provenance-audit/index.html","products/durak-sca-engine/index.html","products/fusion-pre-shot-certification/index.html","products/index.html","products/mcp-bridge/index.html","products/mission-control-whitelabel/index.html","products/monetized-mcp-server/index.html","products/organism-watchdog/index.html","products/phase-space-navigator/index.html","products/post-quantum-signing-cli/index.html","products/powers-engine-api/index.html","products/quantum-verification-receipts/index.html","products/repo-reality-audit/index.html","products/sdee-api/index.html","products/symplectic-wasm-sdk/index.html","products/tollbooth-blackbox-api/index.html"];
  assert.equal(rootPages.length+nestedPages.length,43);
  const sharedCss=readFileSync(resolve(root,"motion-universal.css"),"utf8");
  const sharedJs=readFileSync(resolve(root,"motion-universal.js"),"utf8");
  assert.match(sharedCss,/prefers-reduced-motion:reduce/);
  assert.match(sharedJs,/prefers-reduced-motion: reduce/);
  assert.match(sharedJs,/IntersectionObserver/);
  assert.match(sharedJs,/document.hidden/);
  assert.match(sharedJs,/saveData/);
  for(const file of rootPages) {
    const html=readFileSync(resolve(root,file),"utf8");
    assert.match(html,/src="motion.js"/,"Existing root motion missing: "+file);
  }
  for(const file of nestedPages) {
    const html=readFileSync(resolve(root,file),"utf8");
    const prefix="../".repeat(file.split("/").length-1);
    assert.ok(html.includes('href="'+prefix+'motion-universal.css"'),"Missing CSS on "+file);
    assert.ok(html.includes('src="'+prefix+'motion-universal.js"'),"Missing JS on "+file);
    assert.ok(html.includes('href="'+prefix+'style.css"'),"Base styles changed on "+file);
    assert.equal((html.match(/src="[^"]*motion-universal.js"/g)||[]).length,1,"Duplicate JS on "+file);
    assert.equal((html.match(/href="[^"]*motion-universal.css"/g)||[]).length,1,"Duplicate CSS on "+file);
  }
});

test("nested page motion is visual-only and never blocks product checkout",() => {
  const js=readFileSync(resolve(root,"motion-universal.js"),"utf8");
  const css=readFileSync(resolve(root,"motion-universal.css"),"utf8");
  assert.match(js,/aria-hidden/);
  assert.match(js,/role","presentation/);
  assert.match(css,/pointer-events:none/);
  assert.match(js,/reduced.matches/);
  assert.match(js,/cancelAnimationFrame/);
  assert.match(css,/motion-enter\.motion-visible/);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});
