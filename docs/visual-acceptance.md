# Material visual acceptance — reproducible evidence

**Source baseline:** `qt314wink/OpenPBR-viewer` at commit `3ad43ea93c5a45246b610730c60f3b87d3cd7f26`.

## Baseline: blocked
On 2026-11-24 a headless Chromium/SwiftShader session on the live deployment could click Iridescent, Satin Metal and Clear Glass. The compilation overlay eventually cleared, but logs contained repeated `INVALID_OPERATION: bindTexture: textures can not be used with multiple targets` and a `CONTEXT_LOST_WEBGL` message after switching to Metal. Examining recorded frames showed a spinner and white/invalid output. **These are not accepted material images.**

## Candidate fix: awaiting hardware visual acceptance
The original `envMap` shader sampler uses cube coordinates while the code bound the equirectangular 2D texture directly to the uniform. The candidate generates a `WebGLCubeRenderTarget` from the equirectangular image and binds its cube texture to shader uniforms. It preserves the original 16K source while providing a downsampled 1536×768 copy of that same image for lower memory usage.

Headless comparison with a 3840×1920 intermediate showed Iridescent compilation overlay dismissal around 22s (baseline ~29s). An isolated headed Chromium run got all three preset overlays to clear without the earlier texture-target warnings or context loss. These timings are environment-specific, **not performance guarantees**. Its screenshots were not accepted: visual frame updates lagged the controls, and several captures still displayed an old state or spinner.

## Capture acceptance contract
1. Record exact Git SHA, preset ID, environment-map file and hash, renderer mode, geometry, viewport, and browser/GPU.
2. Confirm the selected preset, URL, and material GUI values match.
3. Confirm no context loss, texture-target errors, failed model requests, or uncaught page errors.
4. Wait for current GPU output, not merely `progress_overlay.style.display === 'none'`; inspect the final framebuffer and reject stale images or spinner-bearing frames.
5. Verify on hardware-accelerated desktop Chrome and a real mobile browser. Software Chromium alone does not certify visual fidelity.
6. Only after human visual acceptance should captures be promoted to public thumbnails or case-study video.

Use `npm test && npm run build`. On a GPU-capable workstation, install Playwright with `npm install --no-save playwright && npx playwright install chromium`; run `node scripts/capture-materials.mjs`. The script generates images and an `acceptance.json` receipt. Captures remain **visual-review pending** until inspected.

## Hardware acceptance gate — Windows PowerShell

The capture runner now refuses to accept software WebGL as hardware evidence. It records the WebGL adapter, exact local commit, environment-map hash, console warnings, selected preset, screenshot hashes, pixel contrast, cross-preset image difference, and a session video. It **never automatically marks a capture visually accepted**.

On your Windows workstation, using a hardware-accelerated Chrome browser:

```powershell
git clone https://github.com/qt314wink/OpenPBR-viewer.git
cd OpenPBR-viewer
git fetch origin qa/openpbr-material-capture
git switch --track origin/qa/openpbr-material-capture
npm ci
npm install --no-save --package-lock=false playwright
npx playwright install chromium
$env:OPENPBR_CHROME_CHANNEL = "chrome"
$env:OPENPBR_URL = "https://openpbr-viewer-demo-git-qa-openpbr-material-c2feb8-melodicbloom.vercel.app/"
$env:OPENPBR_EXPECT_SHA = (git rev-parse HEAD).Trim()
npm run qa:materials
```

Review the resulting `artifacts/material-captures/acceptance.json`, three PNGs, and `material-session.webm`. A nonzero exit indicates a blocked or rejected automated gate. An automated `REVIEW_REQUIRED` result is **not** human visual approval. Inspect color, reflections, object silhouette, refraction, frame freshness, and repeatability on desktop and mobile. Keep PR #1 draft until these checks pass.

The cloud QA environment was tested with Chromium 159 and reported `ANGLE (SwiftShader Device)` instead of a hardware adapter. It correctly returned `BLOCKED_NO_VERIFIED_HARDWARE_GPU` and produced no accepted captures. Do not bypass this flag for publication. `OPENPBR_ALLOW_SOFTWARE=1` is diagnostic only and will label its output `SOFTWARE_ONLY_NOT_ACCEPTED`.
