const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|microsoft basic render|\bwarp\b|virtualbox|vmware svga/i;
export function classifyRenderer(label) {
  if (!label || typeof label !== 'string') return 'unverified';
  return SOFTWARE.test(label) ? 'software' : 'hardware-candidate';
}
export function describePixels(rgb) {
  if (!rgb?.length || rgb.length % 3) throw new Error('RGB samples required');
  const n = rgb.length / 3;
  let sum = 0, squares = 0, colorful = 0, nearWhite = 0, nearBlack = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const lum = (r * .2126 + g * .7152 + b * .0722);
    sum += lum; squares += lum * lum;
    if (Math.max(r,g,b) - Math.min(r,g,b) > 18) colorful++;
    if (r > 247 && g > 247 && b > 247) nearWhite++;
    if (r < 8 && g < 8 && b < 8) nearBlack++;
  }
  const mean = sum / n;
  return {
    meanLuma: Number(mean.toFixed(2)),
    lumaStdDev: Number(Math.sqrt(Math.max(0, squares/n - mean*mean)).toFixed(2)),
    colorfulFraction: Number((colorful/n).toFixed(3)),
    nearWhiteFraction: Number((nearWhite/n).toFixed(3)),
    nearBlackFraction: Number((nearBlack/n).toFixed(3))
  };
}
export function meanChannelDifference(a,b) {
  if (!a?.length || !b?.length || a.length !== b.length) throw new Error('Equal-length RGB samples required');
  let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);
  return Number((sum/a.length).toFixed(2));
}
export function autoRejectReasons({selected,ready,errors,pixels,difference,minimumDifference=5}) {
 const rejected=[];
 if(!selected) rejected.push('preset selection mismatch');
 if(!ready) rejected.push('shader readiness unconfirmed');
 if(errors.some(e => /CONTEXT_LOST_WEBGL|INVALID_OPERATION.*bindTexture|textures can not be used with multiple targets/i.test(e.message||'')))
   rejected.push('WebGL context or texture-target error');
 if(pixels && (pixels.lumaStdDev < 6 || pixels.nearWhiteFraction > .985 || pixels.nearBlackFraction > .985))
   rejected.push('blank/near-uniform frame');
 if(difference !== null && difference !== undefined && difference < minimumDifference)
   rejected.push('insufficient change from previous preset');
 return rejected;
}
