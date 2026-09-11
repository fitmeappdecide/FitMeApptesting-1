from loguru import logger


async def notify_job_complete(user_id: str, job_id: str) -> None:
    logger.info("tryon_job_complete user_id={} job_id={}", user_id, job_id)

