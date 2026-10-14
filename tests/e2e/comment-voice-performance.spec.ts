import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { capture, comment, destination, login, saved, syntheticMicrophone, test, transcriptionTransport } from "../qualification/comment-voice/helpers";

const identity = () => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", "import {captureCandidate} from './scripts/lib/verification-evidence.mjs';const x=captureCandidate({root:process.cwd(),runId:'comment-voice-performance',phase:'before'});console.log(JSON.stringify({commit:x.commit,sourceDigest:x.sourceDigest}));"], { encoding: "utf8", windowsHide: true }));
const percentile = (values: number[], rank: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * rank) - 1];

test("Commentaire fluidité : saisie coalescée et minuteur isolé sans rendu documentaire", async ({ page, captures }, info) => {
  test.skip(!info.project.name.startsWith("performance-comment-voice"), "Explicit local performance selection only; not part of regular E2E timing claims.");
  await syntheticMicrophone(page); const transcriptions = await transcriptionTransport(page, async () => { throw Error("No transcription should be sent in the timer/cancel measurement"); });
  const source = identity(), samples: { index: number; warmup: boolean; visibleMs: number }[] = [];
  const report: Record<string, unknown> = { kind: "local-comment-voice-interaction", source, startedAtUtc: new Date().toISOString(), status: "INCOMPLETE", planned: 35, warmups: 5, samples, limitations: ["Windows Chromium Pixel7 emulation; no network or CPU throttling; not Dev, physical mobile or Browser Use.", "Fill-to-two-animation-frames includes Playwright/IPC and rendering overhead, not pure React event latency.", "Synthetic oscillator replaces the microphone input; actual application AudioWorklet and recorder are exercised. No provider call.", "Timer observation checks focus, selection, scroll and requests; React commit counts are NOT_MEASURED in this production harness.", "New comment latency has no pre-feature equivalent; existing navigation/camera baselines must be replayed separately on the same candidate."] };
  const counts = { autosave: 0, analysis: 0, prepare: 0, content: 0, workspace: 0 };
  try {
    await login(page); const draft = await destination(page, captures, true); const before = await capture(page, draft.id);
    await comment(page).fill("Commentaire initial synthétique"); await saved(page, draft.id, "Commentaire initial synthétique");
    page.on("request", request => { const url = new URL(request.url()); if (request.method() === "PATCH" && url.pathname.endsWith("/comment")) counts.autosave++; if (url.pathname.endsWith("/analyze")) counts.analysis++; if (url.pathname.endsWith("/prepare")) counts.prepare++; if (url.pathname.endsWith("/content")) counts.content++; if (url.pathname.endsWith("/workspace")) counts.workspace++; });
    await page.evaluate(() => {
      const observations: number[] = []; (window as unknown as { __commentLongTasks: number[] }).__commentLongTasks = observations;
      if (PerformanceObserver.supportedEntryTypes.includes("longtask")) new PerformanceObserver(list => { for (const entry of list.getEntries()) observations.push(entry.duration); }).observe({ type: "longtask" });
    });
    for (let index = 0; index < 35; index++) {
      const began = await page.evaluate(() => performance.now()); await comment(page).fill(`Correction synthétique ${index}. ${"Texte clavier facultatif. ".repeat(70)}`);
      const visibleMs = await page.evaluate(started => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)))), began);
      samples.push({ index, warmup: index < 5, visibleMs });
    }
    await saved(page, draft.id, await comment(page).inputValue());
    expect(counts.autosave).toBe(1); expect(counts.analysis).toBe(0); expect(counts.prepare).toBe(0); expect(counts.content).toBe(0);
    await page.getByRole("button", { name: "Dicter la suite", exact: true }).click(); await expect(page.getByRole("group", { name: "Dictée en cours", exact: true })).toBeVisible();
    await comment(page).focus(); await comment(page).evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(7, 7));
    const position = await comment(page).evaluate(node => ({ scrollTop: node.closest("main")?.scrollTop ?? 0, value: (node as HTMLTextAreaElement).value }));
    // Observe two real timer ticks; no clock acceleration or repaint threshold.
    await page.waitForTimeout(2100);
    await expect(comment(page)).toBeFocused();
    expect(await comment(page).evaluate((node: HTMLTextAreaElement) => ({ selectionStart: node.selectionStart, selectionEnd: node.selectionEnd, scrollTop: node.closest("main")?.scrollTop ?? 0, value: node.value }))).toEqual({ selectionStart: 7, selectionEnd: 7, ...position });
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __syntheticMic: { stopped: number } }).__syntheticMic.stopped)).toBe(1);
    expect(transcriptions()).toBe(0); const after = await capture(page, draft.id); expect(after.pages).toEqual(before.pages); expect(after.version).toBe(before.version);
    const values = samples.filter(s => !s.warmup).map(s => s.visibleMs), mean = values.reduce((a, b) => a + b, 0) / values.length;
    Object.assign(report, { status: "COMPLETE", counts, timer: { observedMs: 2100, focusSelectionAndScrollPreserved: true, stoppedTracks: 1, transcriptionCalls: 0 }, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), maxMs: Math.max(...values), variance: values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length, longTasksMs: await page.evaluate(() => (window as unknown as { __commentLongTasks: number[] }).__commentLongTasks) });
  } catch { report.failure = "INTERACTION_OR_ASSERTION_FAILED"; throw Error("Comment/voice performance check failed; see bounded result. Transport details suppressed."); }
  finally { const after = identity(); report.sourceAfter = after; report.sourceUnchanged = JSON.stringify(source) === JSON.stringify(after); if (!report.sourceUnchanged) report.status = "SOURCE_CHANGED"; await mkdir("artifacts/performance", { recursive: true }); const file = `artifacts/performance/comment-voice-${Date.now()}.json`; await writeFile(file, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ report: file, status: report.status })); expect(report.sourceUnchanged).toBe(true); }
});

test("WAV maximal : encodage navigateur de 120 secondes et tâches longues", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("performance-comment-voice"), "Explicit browser encoding measurement, not a regular E2E timing claim.");
  const { encodeDictationWav, DICTATION_SAMPLE_RATE, DICTATION_MAX_SAMPLES } = await import("../../src/components/hestia/dictation-recorder");
  const { createHash } = await import("node:crypto");
  const source = identity(), implementation = encodeDictationWav.toString();
  const report: Record<string, unknown> = { kind: "browser-maximal-wav-encoding", status: "INCOMPLETE", source, startedAtUtc: new Date().toISOString(), implementationSha256: createHash("sha256").update(implementation).digest("hex"), durationSeconds: 120, sampleRate: DICTATION_SAMPLE_RATE, planned: 35, warmups: 5, limitations: ["Exact exported encoder implementation executed in Chromium's main thread with 120 preallocated synthetic PCM chunks; not a Node timing extrapolation.", "This isolates WAV encoding and Blob creation; real-time acquisition, resampling, network and provider wait are excluded.", "Windows Chromium mobile emulation without CPU throttling, not a physical phone.", "Long tasks include the browser scheduling context; report all observations without inventing a passing latency threshold."] };
  try {
    await page.goto("/");
    const result = await page.evaluate(`(async () => {
      const DICTATION_SAMPLE_RATE=${DICTATION_SAMPLE_RATE}, DICTATION_MAX_SAMPLES=${DICTATION_MAX_SAMPLES};
      const encode=${implementation};
      const chunks=Array.from({length:120},()=>new Int16Array(DICTATION_SAMPLE_RATE));
      const longTasks=[], samples=[];
      const observer=PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({startTime:entry.startTime,duration:entry.duration});}):null;
      observer?.observe({type:'longtask'});
      for(let index=0;index<35;index++){
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const startTime=performance.now(),blob=encode(chunks),durationMs=performance.now()-startTime;
        if(blob.size!==44+DICTATION_MAX_SAMPLES*2||blob.type!=='audio/wav')throw Error('WAV_SIZE_OR_TYPE_MISMATCH');
        const header=new DataView(await blob.slice(0,44).arrayBuffer());
        if(header.getUint32(24,true)!==DICTATION_SAMPLE_RATE||header.getUint32(40,true)!==DICTATION_MAX_SAMPLES*2)throw Error('WAV_HEADER_MISMATCH');
        samples.push({index,warmup:index<5,startTime,durationMs,bytes:blob.size});
      }
      await new Promise(resolve=>setTimeout(resolve,0));
      for(const entry of observer?.takeRecords()??[])longTasks.push({startTime:entry.startTime,duration:entry.duration});
      observer?.disconnect();return {samples,longTasks,longTaskObservationSupported:!!observer};
    })()`) as { samples: { index: number; warmup: boolean; startTime: number; durationMs: number; bytes: number }[]; longTasks: { startTime: number; duration: number }[]; longTaskObservationSupported: boolean };
    expect(result.samples).toHaveLength(35); const values = result.samples.filter(sample => !sample.warmup).map(sample => sample.durationMs);
    Object.assign(report, result, { status: "COMPLETE", p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), maxMs: Math.max(...values) });
  } catch { report.failure = "ENCODING_OR_ASSERTION_FAILED"; throw Error("Maximal WAV browser measurement failed; see bounded report."); }
  finally { const after = identity(); report.sourceAfter = after; report.sourceUnchanged = JSON.stringify(source) === JSON.stringify(after); if (!report.sourceUnchanged) report.status = "SOURCE_CHANGED"; await mkdir("artifacts/performance", { recursive: true }); const file = `artifacts/performance/comment-voice-wav-${Date.now()}.json`; await writeFile(file, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ report: file, status: report.status })); expect(report.sourceUnchanged).toBe(true); }
});
