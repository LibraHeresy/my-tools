export interface WorkerGroup {
  start: number;
  end: number;
  pages: number[];
  title: string;
}

export type SplitWorkerRequest =
  | {
      type: "start";
      data: ArrayBuffer;
      groups: WorkerGroup[];
    }
  | { type: "ack" }
  | { type: "cancel" };

export type SplitWorkerResponse =
  | {
      type: "part";
      index: number;
      bytes: ArrayBuffer;
    }
  | { type: "done"; cancelled: boolean }
  | { type: "error"; message: string };
