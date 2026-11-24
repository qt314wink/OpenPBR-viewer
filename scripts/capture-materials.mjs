/**
 * OpenPBR GPU visual evidence gate.
 * Run on a hardware-GPU workstation; screenshots remain human-review pending.
 * Install: npm install --no-save playwright && npx playwright install chromium
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { MATERIAL_PRESETS } from '../material-presets.mjs';
import { classifyRenderer, describePixels, meanChannelDifference, autoRejectReasons } from './visual-qa-utils.mjs';

const { chromium } = await import('playwright');
const baseUrl = process.env.OPENPBR_URL || 'https://openpbr-viewer-demo-git-qa-openpbr-material-c2feb8-melodicbloom.vercel.app/';
const out = resolve(process.env.OPENPBR_CAPTURE_DIR || 'artifacts/material-captures');
const selected = (process.env.OPENPBR_PRESETS || 'iridescent,metal,glass').split(',').map(x=>x.trim());
const maxWaitMs = Number(process.env.OPENPBR_RENDER_TIMEOUT_MS || 90000);
const settleMs = Number(process.env.OPENPBR_SETTLE_MS || 12000);
const allowSoftware = process.env.OPENPBR_ALLOW_SOFTWARE === '1';
const viewport = { width: 1280, height: 720 };
const sha256 = data => createHash('sha256').update(data).digest('hex');
const report = {
  sourceUrl: baseUrl, recordedAt: new Date().toISOString(), viewport, presets: selected,
  machineAssessment: 'NOT_RUN', visualAcceptance: 'PENDING_HUMAN_REVIEW',
  frames: [], events: []
};
await mkdir(out, { recursive: true });
try {
  report.localCommit = execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim();
} catch { report.localCommit = null; }
try {
  const asset = await readFile(resolve('public/textures/envmaps/etzwihl_1536.jpg'));
  report.environment = { path:'public/textures/envmaps/etzwihl_1536.jpg', sha256:sha256(asset), bytes:asset.byteLength };
} catch { report.environment = { status: 'LOCAL_ASSET_UNAVAILABLE' }; }

const browser = await chromium.launch({
  headless: process.env.HEADED === '0',
  channel: process.env.OPENPBR_CHROME_CHANNEL || undefined
});
async function writeReport() {
  await writeFile(resolve(out,'acceptance.json'), JSON.stringify(report,null,2));
}
async function probeHardware() {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('about:blank');
  const gpu = await p.evaluate(() => {
    const gl=document.createElement('canvas').getContext('webgl2');
    if(!gl) return { available:false };
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {
      available:true, version:gl.getParameter(gl.VERSION),
      renderer:gl.getParameter(gl.RENDERER),
      unmaskedRenderer:ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      unmaskedVendor:ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
      parallelCompile:!!gl.getExtension('KHR_parallel_shader_compile')
    };
  });
  await ctx.close();
  return { ...gpu, classification:classifyRenderer(gpu.unmaskedRenderer) };
}
async function decodeSamples(page, png) {
  return page.evaluate(async base64 => {
    const binary=atob(base64);
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const img=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const c=document.createElement('canvas');c.width=32;c.height=32;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(img,0,0,32,32);img.close();
    const pixels=g.getImageData(0,0,32,32).data;const rgb=[];
    for(let i=0;i<pixels.length;i+=4)rgb.push(pixels[i],pixels[i+1],pixels[i+2]);
    return rgb;
  }, png.toString('base64'));
}

async function runGate() {
  try {
    report.browserVersion = await browser.version();
    report.gpu = await probeHardware();
    if (report.gpu.classification !== 'hardware-candidate' && !allowSoftware) {
      report.machineAssessment = 'BLOCKED_NO_VERIFIED_HARDWARE_GPU';
      process.exitCode = 2;
      console.log('BLOCKED: hardware graphics adapter not verified:', report.gpu.unmaskedRenderer || 'unknown');
      return;
    }
    if (process.env.OPENPBR_EXPECT_SHA && report.localCommit !== process.env.OPENPBR_EXPECT_SHA) {
      report.machineAssessment = 'BLOCKED_SOURCE_SHA_MISMATCH';
      process.exitCode = 2;
      return;
    }
    const context = await browser.newContext({
      viewport, deviceScaleFactor:1,
      recordVideo:{dir:out,size:viewport}
    });
    const page = await context.newPage();
    const analyzer = await context.newPage();
    page.on('pageerror',e=>report.events.push({type:'pageerror',message:e.message}));
    page.on('console',m=>{
      if(['warning','error'].includes(m.type()))
        report.events.push({type:'console',message:m.text().slice(0,350)});
    });
    page.on('response',r=>{
      if(r.status()>=400) report.events.push({type:'http',status:r.status(),message:r.url()});
    });
    page.on('requestfailed',r=>report.events.push({
      type:'requestfailed',message:r.url()+' '+(r.failure()?.errorText||'')
    }));
    await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:35000});
    let previousRgb = null;
    for(const id of selected) {
      if(!MATERIAL_PRESETS.some(p=>p.id===id)) throw new Error('Unknown preset '+id);
      const start=Date.now(), startEvents=report.events.length;
      const button=page.locator('[data-preset="'+id+'"]');
      await button.click({timeout:20000});
      let ready=false;
      try {
        await page.waitForFunction(preset=>{
          const progress=document.querySelector('#progress_overlay');
          const status=document.querySelector('#material-preset-status')?.textContent||'';
          const pressed=document.querySelector('[data-preset="'+preset+'"]')?.getAttribute('aria-pressed');
          return pressed==='true' && progress?.style.display==='none' &&
            !status.includes('queued while scene loads');
        },id,{timeout:maxWaitMs,polling:500});
        await page.waitForTimeout(settleMs);
        ready=true;
      } catch(e) {report.events.push({type:'timeout',message:id+': '+e.message.slice(0,200)})}
      const record = {
        id, elapsedMs:Date.now()-start, ready,
        pressed:await button.getAttribute('aria-pressed'),
        url:page.url(), image:null, imageSha256:null, visualReview:'PENDING'
      };
      let rgb=null;
      if(ready) {
        const idx=await page.locator('canvas').evaluateAll(canvases=>{
          let best=-1,area=0;
          canvases.forEach((c,i)=>{
            const box=c.getBoundingClientRect(), next=box.width*box.height;
            if(next>area){area=next;best=i}
          });
          return best;
        });
        if(idx<0) record.captureError='No render canvas';
        else {
          const mask=await page.addStyleTag({content:
            '#material-preset-dock,.lil-gui,#info,#samples,.stats,#progress_overlay {visibility:hidden!important}'});
          try {
            await page.waitForTimeout(600);
            const buffer=await page.locator('canvas').nth(idx).screenshot({timeout:25000});
            rgb=await decodeSamples(analyzer,buffer);
            record.image=id+'.png';
            record.imageSha256=sha256(buffer);
            record.pixels=describePixels(rgb);
            await writeFile(resolve(out,record.image),buffer);
          }catch(e){record.captureError=e.message.slice(0,300)}
          await mask.evaluate(el=>el.remove()).catch(()=>{});
        }
      }
      const diff=previousRgb&&rgb ? meanChannelDifference(previousRgb,rgb):null;
      record.differenceFromPrevious=diff;
      const events=report.events.slice(startEvents);
      record.rejectReasons=autoRejectReasons({
        selected:record.pressed==='true' && new URL(page.url()).searchParams.get('preset')===id,
        ready,errors:events,pixels:record.pixels,difference:diff
      });
      if(record.captureError) record.rejectReasons.push('capture error');
      if(!rgb) record.rejectReasons.push('missing image samples');
      record.machineStatus=record.rejectReasons.length ? 'REJECTED' : 'REVIEW_REQUIRED';
      previousRgb=rgb;
      report.frames.push(record);
      console.log(JSON.stringify({id,status:record.machineStatus,errors:record.rejectReasons,pixels:record.pixels,difference:diff}));
    }
    const video=page.video();
    await context.close();
    if(video){
      const videoPath=await video.path();
      await rename(videoPath,resolve(out,'material-session.webm'));
      report.video='material-session.webm';
    }
    report.machineAssessment = report.frames.every(f=>f.machineStatus==='REVIEW_REQUIRED')
      ? (allowSoftware ? 'SOFTWARE_ONLY_NOT_ACCEPTED' : 'REVIEW_REQUIRED')
      : 'REJECTED';
    if(report.machineAssessment==='REJECTED') process.exitCode=1;
  } catch(e) {
    report.machineAssessment='ERROR';
    report.failure=e.stack||String(e);
    process.exitCode=1;
  } finally {
    await browser.close().catch(()=>{});
    await writeReport();
    console.log('RECEIPT',resolve(out,'acceptance.json'),report.machineAssessment);
  }
}
await runGate();
