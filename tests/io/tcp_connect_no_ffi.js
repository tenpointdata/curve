// Make io_sys initialization fail once, as on a host without bun:ffi.
function ffi_absent_run() {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "CURVE_SYS");
  Object.defineProperty(globalThis, "CURVE_SYS", {
    configurable: true,
    get() {
      if (prior) {
        Object.defineProperty(globalThis, "CURVE_SYS", prior);
      } else {
        delete globalThis.CURVE_SYS;
      }
      throw new Error("no ffi on this host");
    },
  });
  return { $: CID(Unit) };
}

io_eff(CID(ffi_absent), ffi_absent_run);
