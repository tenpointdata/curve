let timer_sys;

function timer_hide() {
  timer_sys = Object.getOwnPropertyDescriptor(globalThis, "CURVE_SYS");
  Object.defineProperty(globalThis, "CURVE_SYS", {
    configurable: true,
    get() { throw new Error("timer-only waits must not load bun:ffi"); },
  });
  return { $: CID(Unit) };
}

function timer_restore() {
  if (timer_sys === undefined) delete globalThis.CURVE_SYS;
  else Object.defineProperty(globalThis, "CURVE_SYS", timer_sys);
  return { $: CID(Unit) };
}

io_eff(CID(Timer.hide), timer_hide);
io_eff(CID(Timer.restore), timer_restore);
