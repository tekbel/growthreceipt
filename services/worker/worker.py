import asyncio
import logging
import signal

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("northstar.worker")


async def run() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(name, stop.set)
    logger.info("worker ready; no persistent queue adapter configured")
    await stop.wait()
    logger.info("worker stopped")


if __name__ == "__main__":
    asyncio.run(run())

