import { record, type CurveList } from "./wire.ts";

export const BODY_CHUNK_BYTES = 16 * 1024;

type BodyInput =
  | { $: "BodyChunk"; bytes: CurveList<number> }
  | { $: "BodyEnd" | "BodyTooLarge" | "BodyFailed" };

function packBytes(bytes: Uint8Array): CurveList<number> {
  let list: CurveList<number> = { $: "Nil" };
  for (let index = bytes.length - 1; index >= 0; index--) {
    list = { $: "Con", head: bytes[index], tail: list };
  }
  return list;
}

export function unpackBytes(value: unknown): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(BODY_CHUNK_BYTES);
  let size = 0;
  let cell = record(value, "Curve byte list");
  while (cell.$ === "Con" && size < output.length) {
    if (typeof cell.head !== "number" || !Number.isInteger(cell.head) || cell.head < 0 || cell.head > 255) {
      throw new Error("HTTP stream bytes must be integers between 0 and 255");
    }
    output[size++] = cell.head;
    cell = record(cell.tail, "Curve byte list tail");
  }
  if (cell.$ !== "Nil" || size === 0) {
    throw new Error("HTTP stream chunks must contain 1 to " + BODY_CHUNK_BYTES + " bytes");
  }
  return output.subarray(0, size);
}

export class RequestBytes {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private pending?: Uint8Array;
  private offset = 0;
  private total = 0;
  private finished = false;
  private cancelled = false;

  constructor(private readonly source: ReadableStream<Uint8Array> | null, private readonly limit: number) {}

  async read(): Promise<BodyInput> {
    if (this.finished) {
      if (this.cancelled) return this.fail();
      throw new Error("HTTP request body has already ended");
    }
    if (this.source === null) {
      this.finish();
      return { $: "BodyEnd" };
    }
    const reader = this.reader ??= this.source.getReader();
    while (!this.pending) {
      let next: Awaited<ReturnType<typeof reader.read>>;
      try {
        next = await reader.read();
      } catch {
        return this.fail();
      }
      if (this.finished) return this.fail();
      if (next.done) {
        this.finish();
        return { $: "BodyEnd" };
      }
      this.total += next.value.byteLength;
      if (this.total > this.limit) {
        await this.cancel();
        this.cancelled = false;
        return { $: "BodyTooLarge" };
      }
      if (next.value.byteLength > 0) {
        this.pending = next.value;
        this.offset = 0;
      }
    }
    const end = Math.min(this.offset + BODY_CHUNK_BYTES, this.pending.byteLength);
    const bytes = packBytes(this.pending.subarray(this.offset, end));
    this.offset = end;
    if (end === this.pending.byteLength) this.pending = undefined;
    return { $: "BodyChunk", bytes };
  }

  async cancel(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.cancelled = true;
    this.pending = undefined;
    const reader = this.reader;
    this.reader = undefined;
    try {
      await (reader ? reader.cancel() : this.source?.cancel());
    } catch {
      // A peer disconnect may already have errored the native stream.
    } finally {
      reader?.releaseLock();
    }
  }

  private finish(): void {
    this.finished = true;
    this.cancelled = false;
    this.pending = undefined;
    this.reader?.releaseLock();
    this.reader = undefined;
  }

  private fail(): BodyInput {
    this.finish();
    return { $: "BodyFailed" };
  }
}
