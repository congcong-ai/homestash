import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { isYardStop } from "./yard-commands";
export function localStopRecognizer() {
  const model = process.env.YARD_LOCAL_STOP_MODEL;
  if (!model)
    return {
      recognize: async (_wav: Buffer): Promise<boolean | null> => {
        void _wav;
        return null;
      },
      status: () => ({ ready: false, configured: false }),
      close: () => {},
    };
  const child = spawn(
    process.env.YARD_LOCAL_STOP_PYTHON ?? "python3",
    [resolve("scripts/hardware/local-stop-worker.py"), model],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let ready = false,
    closed = false;
  let sequence = 0;
  let busy = false;
  const jobs = new Map<
    number,
    {
      resolve: (v: boolean | null) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const fail = () => {
    closed = true;
    ready = false;
    for (const j of jobs.values()) {
      clearTimeout(j.timer);
      j.resolve(null);
    }
    jobs.clear();
  };
  child.on("error", fail);
  child.on("exit", fail);
  child.stderr.on("data", () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const row = JSON.parse(line);
      if (row.ready) {
        ready = true;
        return;
      }
      const job = jobs.get(row.id);
      if (!job) return;
      clearTimeout(job.timer);
      jobs.delete(row.id);
      job.resolve(typeof row.text === "string" ? isYardStop(row.text) : null);
    } catch {
      /*模型诊断行不是协议响应*/
    }
  });
  return {
    recognize: async (wav: Buffer): Promise<boolean | null> => {
      if (!ready || closed || busy || wav.length > 256044) return null;
      busy = true;
      try {
        return await new Promise((resolve) => {
          const id = ++sequence;
          const timer = setTimeout(() => {
            jobs.delete(id);
            resolve(null);
          }, 5000);
          jobs.set(id, { resolve, timer });
          child.stdin.write(
            JSON.stringify({ id, wav: wav.toString("base64") }) + "\n",
            (err) => {
              if (err) {
                clearTimeout(timer);
                jobs.delete(id);
                resolve(null);
              }
            },
          );
        });
      } finally {
        busy = false;
      }
    },
    status: () => ({ ready: ready && !closed, configured: true }),
    close: () => {
      lines.close();
      fail();
      child.kill();
    },
  };
}
