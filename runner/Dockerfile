# Piston (self-hosted code execution), pinned, with two small fixes for judging
# realistic test data. The build fails if either upstream line changes, so a
# patch can never silently stop applying.
#
# 1. The API keeps Express's default 100 KB request body limit, which rejects
#    larger test inputs. Raised to PISTON_BODY_LIMIT (default 64mb).
# 2. stdin is written, ended and then immediately destroyed, which discards
#    whatever has not been flushed to the pipe yet: programs see only the first
#    ~200 KB of a large input. Keep the stream alive and ignore EPIPE instead
#    (a program may exit without reading all of its input).
FROM ghcr.io/engineer-man/piston@sha256:2f66b7456189c4d713aa986d98eccd0b6ee16d26c7ec5f21b30e942756fd127a

RUN sed -i "s/app.use(body_parser.json());/app.use(body_parser.json({ limit: process.env.PISTON_BODY_LIMIT || '64mb' }));/" /piston_api/src/index.js \
 && grep -q "PISTON_BODY_LIMIT" /piston_api/src/index.js \
 && sed -i "s/proc.stdin.destroy();/proc.stdin.on('error', () => {});/" /piston_api/src/job.js \
 && ! grep -q "proc.stdin.destroy" /piston_api/src/job.js \
 && grep -q "proc.stdin.on('error'" /piston_api/src/job.js
