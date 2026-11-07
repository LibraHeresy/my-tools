import type { SplitGroup } from "./model";
import type {
  SplitWorkerRequest,
  SplitWorkerResponse,
} from "./splitWorkerTypes";

export interface SplitOutcome {
  cancelled: boolean;
}

export interface SplitJobOptions {
  data: Uint8Array;
  groups: SplitGroup[];
  onPart: (index: number, bytes: Uint8Array) => Promise<void>;
}

export interface SplitJob {
  done: Promise<SplitOutcome>;
  cancel: () => void;
}

export function startSplitJob(options: SplitJobOptions): SplitJob {
  const worker = new Worker(new URL("./split.worker.ts", import.meta.url), {
    type: "module",
  });

  let cancelRequested = false;
  let settled = false;
  let resolveDone: (value: SplitOutcome) => void = () => undefined;
  let rejectDone: (reason: Error) => void = () => undefined;

  const done = new Promise<SplitOutcome>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const close = () => {
    worker.terminate();
  };

  const fail = (message: string) => {
    if (settled) {
      return;
    }
    settled = true;
    close();
    rejectDone(new Error(message));
  };

  worker.onerror = (event) => {
    fail(event.message || "拆分进程意外退出。");
  };

  worker.onmessage = (event: MessageEvent<SplitWorkerResponse>) => {
    const message = event.data;

    if (message.type === "part") {
      const bytes = new Uint8Array(message.bytes);
      if (cancelRequested) {
        worker.postMessage({ type: "ack" } satisfies SplitWorkerRequest);
        return;
      }

      void options
        .onPart(message.index, bytes)
        .then(() => {
          if (!settled) {
            worker.postMessage({ type: "ack" } satisfies SplitWorkerRequest);
          }
        })
        .catch((error: unknown) => {
          fail(
            error instanceof Error
              ? error.message
              : "写入拆分结果时发生错误。",
          );
        });
      return;
    }

    if (message.type === "error") {
      fail(message.message || "拆分失败。");
      return;
    }

    if (message.type === "done") {
      if (settled) {
        return;
      }
      settled = true;
      close();
      resolveDone({ cancelled: message.cancelled || cancelRequested });
    }
  };

  const request: SplitWorkerRequest = {
    type: "start",
    data: options.data.buffer.slice(
      options.data.byteOffset,
      options.data.byteOffset + options.data.byteLength,
    ) as ArrayBuffer,
    groups: options.groups.map((group) => ({
      start: group.start,
      end: group.end,
      pages: group.pages,
      title: group.fileName.replace(/\.pdf$/i, ""),
    })),
  };

  worker.postMessage(request);

  return {
    done,
    cancel: () => {
      if (settled) {
        return;
      }
      cancelRequested = true;
      worker.postMessage({ type: "cancel" } satisfies SplitWorkerRequest);
    },
  };
}
