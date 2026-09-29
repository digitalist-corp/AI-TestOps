ARG PLAYWRIGHT_VERSION=1.53.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG PLAYWRIGHT_VERSION=1.53.0
ARG NODE_VERSION=22.16.0

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PATH="/opt/node/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) node_arch="x64" ;; \
      arm64) node_arch="arm64" ;; \
      *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -o /tmp/node.tar.xz; \
    mkdir -p /opt/node; \
    tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1; \
    rm /tmp/node.tar.xz; \
    ln -sf /opt/node/bin/node /usr/local/bin/node; \
    ln -sf /opt/node/bin/npm /usr/local/bin/npm; \
    ln -sf /opt/node/bin/npx /usr/local/bin/npx; \
    corepack enable; \
    npm install -g "@playwright/test@${PLAYWRIGHT_VERSION}"; \
    node -v; \
    npm -v

# run.js(코드 수정) · analyze.js(대상 분석)를 함께 싣는다.
# analyze.js 는 Playwright 를 라이브러리로 쓰므로 전역 설치 경로를 모듈 검색 경로에 넣는다.
ENV NODE_PATH=/opt/node/lib/node_modules
COPY ai-runner/run.js ai-runner/analyze.js /ai-runner/

WORKDIR /workspace

CMD ["node", "/ai-runner/run.js"]
