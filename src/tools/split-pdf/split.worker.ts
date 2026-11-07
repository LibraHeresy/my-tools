import { PDFDocument } from "pdf-lib";
import type {
  SplitWorkerRequest,
  SplitWorkerResponse,
  WorkerGroup,
} from "./splitWorkerTypes";

const context = self as unknown as {
  onmessage: ((event: MessageEvent<SplitWorkerRequest>) => void) | null;
  postMessage: (message: SplitWorkerResponse, transfer?: Transferable[]) => void;
};

let cancelled = false;
let waitingForAck: (() => void) | null = null;

function finish(cancelledJob: boolean) {
  context.postMessage({ type: "done", cancelled: cancelledJob });
}

async function split(
  data: ArrayBuffer,
  groups: WorkerGroup[],
): Promise<void> {
  const source = await PDFDocument.load(new Uint8Array(data), {
    updateMetadata: false,
  });

  for (let index = 0; index < groups.length; index += 1) {
    if (cancelled) {
      finish(true);
      return;
    }

    const group = groups[index];
    const output = await PDFDocument.create();
    const copiedPages = await output.copyPages(
      source,
      group.pages.map((page) => page - 1),
    );

    for (const page of copiedPages) {
      output.addPage(page);
    }

    output.setTitle(group.title);
    output.setCreator("PDF 工具台");
    output.setProducer("PDF 工具台");

    const bytes = await output.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

    if (cancelled) {
      finish(true);
      return;
    }

    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    context.postMessage({ type: "part", index, bytes: buffer }, [buffer]);

    await new Promise<void>((resolve) => {
      waitingForAck = resolve;
    });
    waitingForAck = null;

    if (cancelled) {
      finish(true);
      return;
    }
  }

  finish(false);
}

context.onmessage = (event: MessageEvent<SplitWorkerRequest>) => {
  const message = event.data;

  if (message.type === "start") {
    cancelled = false;
    void split(message.data, message.groups).catch((error: unknown) => {
      context.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }

  if (message.type === "ack") {
    const resolve = waitingForAck;
    waitingForAck = null;
    resolve?.();
    return;
  }

  if (message.type === "cancel") {
    // If a page group is currently being written by the UI, let that write
    // finish and acknowledge it. The worker exits right after the ack.
    cancelled = true;
  }
};
