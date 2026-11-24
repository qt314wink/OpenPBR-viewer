import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRenderer, describePixels, meanChannelDifference, autoRejectReasons} from './visual-qa-utils.mjs';
test('software adapters fail hardware identification',()=>{
 for(const label of ['ANGLE (SwiftShader Device)', 'llvmpipe (LLVM 17)', 'Microsoft Basic Render Driver','Mesa lavapipe'])
  assert.equal(classifyRenderer(label),'software');
 assert.equal(classifyRenderer('NVIDIA RTX 4070 (D3D11)'),'hardware-candidate');
 assert.equal(classifyRenderer(undefined),'unverified');
});
test('pixel statistics detect blank frames and material contrast',()=>{
 const white=describePixels([255,255,255, 255,255,255, 255,255,255]);
 assert.equal(white.lumaStdDev,0);
 assert.equal(white.nearWhiteFraction,1);
 const material=describePixels([255,20,10, 9,26,180, 34,220,64]);
 assert.ok(material.lumaStdDev>30);assert.ok(material.colorfulFraction>.9);
});
test('image comparison produces channel-based change score',()=>{
 assert.equal(meanChannelDifference([10,20,30],[20,30,40]),10);
 assert.equal(meanChannelDifference([10,20,30],[10,20,30]),0);
 assert.throws(()=>meanChannelDifference([10],[20,30]));
});
test('rejected frames cannot be visually accepted by a spinner-only check',()=>{
 const problems=autoRejectReasons({
   selected:true,ready:true,errors:[{message:'WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost'}],
   pixels:{lumaStdDev:0,nearWhiteFraction:1,nearBlackFraction:0},difference:0
 });
 assert.deepEqual(problems,['WebGL context or texture-target error','blank/near-uniform frame','insufficient change from previous preset']);
});
test('plausible distinct render only advances to human review',()=>{
 const problems=autoRejectReasons({
  selected:true,ready:true,errors:[],pixels:{lumaStdDev:35,nearWhiteFraction:.08,nearBlackFraction:.2},difference:26
 });
 assert.deepEqual(problems,[]);
});
