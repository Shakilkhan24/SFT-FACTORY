# The factory's toolchain image.
#
# This image is what the T2 sandbox runs. It is pinned BY DIGEST, never by tag: a tag
# moves, and a factory whose build environment moves underneath it produces results that
# cannot be reproduced or audited.
#
#   docker build -t ghcr.io/<owner>/factory-node . \
#     --build-arg NODE_IMAGE=node@sha256:<digest>
#
#   docker push ghcr.io/<owner>/factory-node
#   docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/<owner>/factory-node
#
# The digest from that last command is what goes into `.factory/repo.yml` and into
# `definition/` — never the tag.
#
# T-0.05 requires a "digest-pinnable toolchain Dockerfile". The digest is supplied at
# build time by the owner, because the owner is the one who can verify the upstream
# digest against the upstream release notes.

ARG NODE_IMAGE=node:26-alpine

FROM ${NODE_IMAGE}

# The image runs as a non-root user. The container's privilege is one of the isolation
# controls (ADR-0020): a container that runs as root has nothing left to drop.
RUN addgroup -S factory && adduser -S -G factory factory

# The toolchain the target repo's commands need. `gitleaks` is listed by the pack's
# repo.yml template in the securityScan command; it must be present in the image or the
# scan silently does nothing (pack 03 §4.9 marks its availability `[VERIFY]`).
RUN apk add --no-cache git tini ripgrep gitleaks

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

WORKDIR /workspace

# The workspace is owned by the non-root user so the container can write to it. The host
# bind-mount is set up by the T2 runtime; the container never gets the host's docker
# socket (ADR-0020).
RUN mkdir -p /workspace && chown factory:factory /workspace
USER factory

# `tini` reaps the zombies a build tool leaves behind. Without an init, a long CI run
# leaks processes until the container's pid limit is hit.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--version"]

# Labels. `org.opencontainers.image.*` is what makes the digest traceable back to a
# source revision when someone asks "what was in the image when this task ran?".
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/<owner>/software-factory" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="factory-node" \
      org.opencontainers.image.description="Toolchain image for the Software Factory T2 sandbox"
