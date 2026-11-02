FROM golang:1.24.2-alpine AS source
RUN apk add --no-cache git
WORKDIR /src/k6
RUN git init && git remote add origin https://github.com/grafana/k6.git && \
    git fetch --depth 1 origin 41b4984b7594a8828bfa724ae32b49c15c76b13d && \
    git checkout --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = 41b4984b7594a8828bfa724ae32b49c15c76b13d
ENV CGO_ENABLED=0

FROM source AS regression-original
COPY clock_regression_test.go lib/netext/httpext/lab_clock_test.go
RUN sed -i 's/time.Now()/labCivilNow()/g' lib/netext/httpext/tracer.go
RUN --mount=type=cache,target=/root/.cache/go-build go test ./lib/netext/httpext -run '^TestLabClockStep$' -count=1 -v

FROM source AS patched
COPY monotonic-clock.patch /tmp/monotonic-clock.patch
RUN git apply --check /tmp/monotonic-clock.patch && git apply /tmp/monotonic-clock.patch

FROM patched AS regression-fixed
COPY clock_regression_test.go lib/netext/httpext/lab_clock_test.go
RUN sed -i 's/time.Now()/labCivilNow()/g' lib/netext/httpext/tracer.go
RUN --mount=type=cache,target=/root/.cache/go-build go test ./lib/netext/httpext -run '^TestLabClockStep$' -count=1 -v && touch /clock-regression-passed

FROM patched AS builder
COPY --from=regression-fixed /clock-regression-passed /clock-regression-passed
RUN --mount=type=cache,target=/root/.cache/go-build go test ./lib/netext/httpext -count=1
RUN sed -i 's/const Version = "1.0.0"/const Version = "1.0.0-labclock1"/' internal/build/version.go
RUN --mount=type=cache,target=/root/.cache/go-build go build -trimpath -o /out/k6 .

FROM grafana/k6:1.0.0
COPY --from=builder /out/k6 /usr/bin/k6
COPY --from=source /src/k6/LICENSE.md /usr/share/k6/LICENSE.md
COPY monotonic-clock.patch /usr/share/k6/monotonic-clock.patch
LABEL lab.generator.clock="monotonic-anchor-v1" \
      lab.generator.source="https://github.com/grafana/k6/tree/41b4984b7594a8828bfa724ae32b49c15c76b13d"
