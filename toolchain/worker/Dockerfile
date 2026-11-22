# A clean Linux release worker: the base image by digest and only the tools
# curve-toolchain.sh needs to unpack and check its inputs. Bun, Lean, Curve and
# the kernel come from the mirror, never from this image.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip zstd \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home worker
USER worker
WORKDIR /home/worker
