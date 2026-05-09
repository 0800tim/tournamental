/**
 * Tiny async clip-render queue. Single-process, in-memory, FIFO. Each job
 * tracks a state-machine `queued → rendering → done | failed`; transitions
 * are guarded so a finished or failed job can't slip back into the queue.
 *
 * Jobs are content-addressed — submitting the same ClipRequest twice hits
 * the cache and returns the existing job rather than re-encoding.
 *
 * Persistence is out of scope for v0; a process restart drops the queue.
 * If we need durability we'll back the cache with Redis (see IDEAS.md).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { clipIdFor } from "./clip-id.js";
import type { FfmpegRunner } from "./ffmpeg.js";
import type { ClipJob, ClipRequest } from "./types.js";

export interface QueueOptions {
  ffmpeg: FfmpegRunner;
  storagePath: string;
  /** Optional public URL prefix (e.g. https://cdn.example/clips). */
  storageUrl?: string | null;
  /** Override clock for deterministic tests. */
  now?: () => number;
}

export interface SubmitResult {
  job: ClipJob;
  cached: boolean;
}

export class ClipQueue {
  private readonly jobs = new Map<string, ClipJob>();
  private readonly pending: string[] = [];
  private running = false;
  private readonly now: () => number;
  private idleResolvers: Array<() => void> = [];

  constructor(private readonly opts: QueueOptions) {
    this.now = opts.now ?? Date.now;
  }

  list(): ClipJob[] {
    return [...this.jobs.values()];
  }

  get(clipId: string): ClipJob | undefined {
    return this.jobs.get(clipId);
  }

  /**
   * Enqueue a render. Idempotent in the cache: re-submitting the same
   * ClipRequest returns the existing job and never duplicates work.
   */
  submit(request: ClipRequest): SubmitResult {
    const clip_id = clipIdFor(request);
    const existing = this.jobs.get(clip_id);
    if (existing) return { job: existing, cached: true };

    const job: ClipJob = {
      clip_id,
      request,
      status: "queued",
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.jobs.set(clip_id, job);
    this.pending.push(clip_id);
    void this.tick();
    return { job, cached: false };
  }

  /**
   * Wait for the queue to drain. Used by tests so they don't have to poll.
   */
  async waitForIdle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = this.pending.shift();
        if (!next) break;
        const job = this.jobs.get(next);
        if (!job) continue;
        await this.process(job);
      }
    } finally {
      this.running = false;
      const resolvers = this.idleResolvers;
      this.idleResolvers = [];
      for (const r of resolvers) r();
    }
  }

  private async process(job: ClipJob): Promise<void> {
    if (job.status !== "queued") return;
    this.transition(job, "rendering");

    if (!job.request.src) {
      this.fail(job, "no input source provided (request.src is required for render)");
      return;
    }

    const outDir = this.opts.storagePath;
    try {
      await fs.mkdir(outDir, { recursive: true });
    } catch (err) {
      this.fail(job, `mkdir ${outDir} failed: ${(err as Error).message}`);
      return;
    }
    const outPath = path.join(outDir, `${job.clip_id}.mp4`);

    const result = await this.opts.ffmpeg.run({
      inputPath: job.request.src,
      outputPath: outPath,
      start_ms: job.request.start_ms,
      end_ms: job.request.end_ms,
      format: job.request.format,
      ...(job.request.overlay ? { overlay: job.request.overlay } : {}),
    });

    if (!result.ok) {
      this.fail(job, result.error);
      return;
    }

    job.output_path = outPath;
    job.url = this.urlFor(job.clip_id, outPath);
    job.thumbnail = this.thumbnailUrlFor(job.clip_id);
    this.transition(job, "done");
  }

  private urlFor(clipId: string, localPath: string): string {
    if (this.opts.storageUrl) {
      return `${this.opts.storageUrl}/${clipId}.mp4`;
    }
    return `file://${path.resolve(localPath)}`;
  }

  private thumbnailUrlFor(clipId: string): string {
    if (this.opts.storageUrl) return `${this.opts.storageUrl}/${clipId}.jpg`;
    return "";
  }

  private transition(job: ClipJob, next: ClipJob["status"]): void {
    if (!isValidTransition(job.status, next)) {
      throw new Error(`invalid clip transition ${job.status} -> ${next} (${job.clip_id})`);
    }
    job.status = next;
    job.updated_at = this.now();
  }

  private fail(job: ClipJob, error: string): void {
    job.error = error;
    this.transition(job, "failed");
  }
}

const TRANSITIONS: Record<ClipJob["status"], ClipJob["status"][]> = {
  queued: ["rendering", "failed"],
  rendering: ["done", "failed"],
  done: [],
  failed: [],
};

export function isValidTransition(from: ClipJob["status"], to: ClipJob["status"]): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
