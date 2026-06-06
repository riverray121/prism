import json
import logging
import sys

from .schema import PingCommand, PongEvent

# Log to stderr so the stdout JSON-lines channel stays clean.
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stderr,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("sidecar")


def main() -> None:
    log.info("sidecar started")
    # Read one JSON command per line from stdin; write one JSON event per line to stdout.
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            log.warning("invalid JSON: %r", line)
            continue
        # M0 supports a single command: ping echoes pong.
        if msg.get("type") == "ping":
            PingCommand.model_validate(msg)
            print(PongEvent(type="pong").model_dump_json(), flush=True)
        else:
            log.warning("unknown command: %r", msg)
    log.info("sidecar stdin closed, exiting")


if __name__ == "__main__":
    main()
