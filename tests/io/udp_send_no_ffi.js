// Fail one FFI access. io_fail catches it after address validation.
function udp_no_ffi_arm(socket) {
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
  return socket;
}

io_eff(CID(UdpNoFfi.arm), udp_no_ffi_arm);
