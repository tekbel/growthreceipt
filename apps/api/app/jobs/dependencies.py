from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.database import get_engine
from app.jobs.agent_jobs import AgentJobStore, PostgresAgentJobStore


def get_agent_job_store() -> AgentJobStore:
    return PostgresAgentJobStore(async_sessionmaker(get_engine(), expire_on_commit=False))


AgentJobs = Annotated[AgentJobStore, Depends(get_agent_job_store)]
