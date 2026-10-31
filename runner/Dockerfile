# Piston (self-hosted code execution), pinned, with small fixes for judging
# realistic test data. The build fails if an upstream line changes, so a patch
# can never silently stop applying.
#
# 1. The API keeps Express's default 100 KB request body limit, which rejects
#    larger test inputs. Raised to PISTON_BODY_LIMIT (default 64mb).
# 2. stdin is written, ended and then immediately destroyed, which discards
#    whatever has not been flushed to the pipe yet: programs see only the first
#    ~200 KB of a large input. Keep the stream alive and ignore EPIPE instead
#    (a program may exit without reading all of its input).
# 3. Packages are downloaded at run time into a volume, so their scripts cannot
#    be edited here. A stage script in /usr/local/lib/codr-piston/<package>/
#    (copied from overrides/) replaces the package's own; isolate mounts /usr
#    read-only in every sandbox, so the script is visible there. Used to make
#    TypeScript compile for the bundled Node.js (overrides/typescript/compile).
FROM ghcr.io/engineer-man/piston@sha256:2f66b7456189c4d713aa986d98eccd0b6ee16d26c7ec5f21b30e942756fd127a

COPY overrides/ /usr/local/lib/codr-piston/

RUN sed -i "s/app.use(body_parser.json());/app.use(body_parser.json({ limit: process.env.PISTON_BODY_LIMIT || '64mb' }));/" /piston_api/src/index.js \
 && grep -q "PISTON_BODY_LIMIT" /piston_api/src/index.js \
 && sed -i "s/proc.stdin.destroy();/proc.stdin.on('error', () => {});/" /piston_api/src/job.js \
 && ! grep -q "proc.stdin.destroy" /piston_api/src/job.js \
 && grep -q "proc.stdin.on('error'" /piston_api/src/job.js \
 && sed -i "s|path.join(this.runtime.pkgdir, file),|((o) => require('fs').existsSync(o) ? o : path.join(this.runtime.pkgdir, file))(path.join('/usr/local/lib/codr-piston', path.basename(path.dirname(this.runtime.pkgdir)), file)),|" /piston_api/src/job.js \
 && grep -q "/usr/local/lib/codr-piston" /piston_api/src/job.js \
 && chmod -R a+rX /usr/local/lib/codr-piston
