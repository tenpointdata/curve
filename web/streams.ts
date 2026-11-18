import { RequestBytes, unpackBytes } from "./bytes.ts";
import { record, responseHasBody, responseInit, type CurveRequestHead } from "./wire.ts";

export type Dispatch = (id: number, head: CurveRequestHead, request: Request) => Promise<Response>;
type Resume = (state: unknown, input: unknown) => unknown;
type Advance = (state: unknown) => unknown;
type Handler = (id: number, head: CurveRequestHead) => unknown;

function outputStream(
  initial: unknown,
  input: RequestBytes,
  advance: Advance,
  resume: Resume,
  closeInput: () => Promise<void>,
  signal: AbortSignal,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let state = record(initial, "Web.BodyOutput");
  let advanceOnPull = false;
  let closed = false;

  return new ReadableStream({
    async pull(controller) {
      try {
        if (advanceOnPull && !signal.aborted) {
          state = record(advance(state), "Web.BodyOutput");
          advanceOnPull = false;
        }
        while (!closed && !signal.aborted) {
          switch (state.$) {
            case "BodyRead": {
              const chunk = await input.read();
              if (closed || signal.aborted) break;
              state = record(resume(state, chunk), "Web.BodyOutput");
              continue;
            }
            case "BodyWrite":
              controller.enqueue(unpackBytes(state.bytes));
              advanceOnPull = true;
              return;
            case "BodyStop":
              break;
            case "BodyAbort":
              throw new Error("Curve aborted the HTTP response body");
            default:
              throw new Error("Expected Web.BodyOutput");
          }
          break;
        }
        if (!closed) {
          closed = true;
          controller.close();
          await closeInput();
        }
      } catch (error) {
        if (!closed) {
          closed = true;
          controller.error(error);
          await closeInput();
        }
      }
    },
    async cancel() {
      closed = true;
      await closeInput();
    },
  }, { highWaterMark: 0 });
}

export function createStreamingHandler(app: Readonly<Record<string, unknown>>, maxBodyBytes: number): Dispatch {
  if (typeof app.handle_stream !== "function" || typeof app["Web:stream_resume"] !== "function" ||
      typeof app["Web:advance_body"] !== "function" || typeof app["Web:resume_body"] !== "function" ||
      app.handle !== undefined || app.handle_action !== undefined) {
    throw new Error("Export only handle_stream(U32, Web.RequestHead) -> Web.StreamAction for a streaming application");
  }
  const handle = app.handle_stream as Handler;
  const resume = app["Web:stream_resume"] as Resume;
  const advance = app["Web:advance_body"] as Advance;
  const resumeBody = app["Web:resume_body"] as Resume;

  return async (id, head, request) => {
    const input = new RequestBytes(request.body, maxBodyBytes);
    const abort = () => { void input.cancel(); };
    request.signal.addEventListener("abort", abort, { once: true });
    const closeInput = () => {
      request.signal.removeEventListener("abort", abort);
      return input.cancel();
    };
    try {
      let action = record(handle(id, head), "Web.StreamAction");
      while (action.$ === "StreamRead") {
        const chunk = await input.read();
        action = record(resume(action, chunk), "Web.StreamAction");
      }
      if (action.$ !== "StreamReply") throw new Error("Expected Web.StreamReply");
      const init = responseInit(action);
      if (!responseHasBody(head.method, init.status)) {
        void closeInput();
        return new Response(null, init);
      }
      return new Response(outputStream(action.body, input, advance, resumeBody, closeInput, request.signal), init);
    } catch (error) {
      void closeInput();
      throw error;
    }
  };
}
