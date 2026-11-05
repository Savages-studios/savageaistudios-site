/* Behavioral regression tests for the existing main-page motion engine.
   Use Node's VM sandbox to verify link policy and animation lifecycle without a browser.
   This is not a substitute for rendered mobile / screen-reader QA. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(resolve(root, "motion.js"), "utf8");

function makeHarness({withCanvas=false}={}) {
  const listeners = {};
  const timers = [];
  const pending = new Map();
  const cancelled = [];
  const observerInstances = [];
  let rafCounter=0,draws=0;
  const media={matches:false,addEventListener(event,fn){listeners.media=fn}};
  const context2D={
    clearRect(){draws++},beginPath(){},arc(){},fill(){},moveTo(){},lineTo(){},stroke(){},
    set fillStyle(v){},set strokeStyle(v){},set lineWidth(v){}
  };
  const canvas={
    parentElement:{getBoundingClientRect(){return {width:500,height:260}}},
    getContext(){return context2D}
  };
  class FakeObserver {
    constructor(cb) {this.cb=cb;this.observed=[];observerInstances.push(this)}
    observe(el){this.observed.push(el)}
    unobserve(){}
    disconnect(){}
    intersect(el,yes){this.cb([{target:el,isIntersecting:yes}])}
  }
  const bodyClasses=new Set();
  const location={origin:"https://savageaistudios.com",href:"https://savageaistudios.com/index.html",pathname:"/index.html",search:""};
  const document={
    hidden:false,
    documentElement:{classList:{add(){}}},
    body:{classList:{add(k){bodyClasses.add(k)},contains(k){return bodyClasses.has(k)}}},
    querySelector(){return null},
    querySelectorAll(sel){return sel===".hero-canvas"&&withCanvas?[canvas]:[]},
    addEventListener(event,fn){listeners[event]=fn}
  };
  const window={
    location,innerWidth:500,scrollY:0,
    matchMedia(){return media},
    addEventListener(event,fn){listeners["window-"+event]=fn},
    IntersectionObserver:FakeObserver
  };
  const globals={
    URL,window,document,IntersectionObserver:FakeObserver,
    requestAnimationFrame(fn){const id=++rafCounter;pending.set(id,fn);return id},
    cancelAnimationFrame(id){cancelled.push(id);pending.delete(id)},
    setTimeout(fn,delay){timers.push({fn,delay})},
    Math,parseInt,isNaN
  };
  runInNewContext(code,globals);
  return {
    canvas,media,document,window,listeners,timers,pending,cancelled,observerInstances,bodyClasses,
    draws(){return draws},
    click(href,{target="_self",download=false,modified=false}={}){
      let prevented=false;
      const anchor={
        target,
        getAttribute(k){return k==="href"?href:null},
        hasAttribute(k){return k==="download"&&download}
      };
      const event={
        button:0,defaultPrevented:false,metaKey:modified,ctrlKey:false,shiftKey:false,altKey:false,
        target:{closest(){return anchor}},
        preventDefault(){prevented=true}
      };
      listeners.click(event);
      return prevented;
    },
    tick(ts=1000) {
      const [id,fn]=pending.entries().next().value||[];
      if(!fn)return false;
      pending.delete(id);fn(ts);return true;
    }
  };
}

test("external checkout, email and other origins are never intercepted",()=>{
  const h=makeHarness();
  for(const url of [
    "https://buy.stripe.com/bJe14mePedgege1gehaIM06",
    "https://ovmtruth.com",
    "https://reviewloop.bubbleapps.io/",
    "mailto:savagnic@gmail.com",
    "tel:+14155550123"
  ])assert.equal(h.click(url),false,url);
  assert.equal(h.timers.length,0);
});

test("same-page hash, download, new tabs, modifiers and reduced-motion are native",()=>{
  const h=makeHarness();
  assert.equal(h.click("#work"),false);
  assert.equal(h.click("index.html#work"),false);
  assert.equal(h.click("work.html",{target:"_blank"}),false);
  assert.equal(h.click("assets/file.pdf",{download:true}),false);
  assert.equal(h.click("work.html",{modified:true}),false);
  h.media.matches=true;
  assert.equal(h.click("work.html"),false);
  assert.equal(h.timers.length,0);
});

test("internal page transitions are preserved and use one 200ms page-out",()=>{
  const h=makeHarness();
  assert.equal(h.click("work.html#audits"),true);
  assert.equal(h.bodyClasses.has("leaving"),true);
  assert.equal(h.timers.length,1);
  assert.equal(h.timers[0].delay,200);
  h.timers[0].fn();
  assert.equal(h.window.location.href,"https://savageaistudios.com/work.html#audits");
});

test("particle animation starts only in view and stops when hidden or scrolled away",()=>{
  const h=makeHarness({withCanvas:true});
  const observer=h.observerInstances.find(i=>i.observed.includes(h.canvas));
  assert.ok(observer,"Canvas visibility observer exists");
  assert.equal(h.pending.size,0,"No offscreen RAF scheduled on initialization");
  observer.intersect(h.canvas,true);
  assert.equal(h.pending.size,1,"First visible frame scheduled");
  h.tick(1000);
  assert.ok(h.draws()>0,"Visible frame actually draws");
  assert.equal(h.pending.size,1,"One future frame, not a runaway chain");
  h.document.hidden=true;
  h.listeners.visibilitychange();
  assert.equal(h.pending.size,0,"Background-tab frame cancelled");
  h.document.hidden=false;
  h.listeners.visibilitychange();
  assert.equal(h.pending.size,1,"Foreground-visible frame scheduled again");
  observer.intersect(h.canvas,false);
  assert.equal(h.pending.size,0,"Offscreen frame cancelled");
  observer.intersect(h.canvas,true);
  h.media.matches=true;
  h.listeners.media();
  assert.equal(h.pending.size,0,"Reduced motion stops frame scheduling");
});
