"""체크포인트는 같은 PostgreSQL 의 별도 스키마(langgraph)에 둔다. Flyway 는 이 스키마를 건드리지 않는다 (E-01 결정).

노드가 MCP 도구(비동기)를 부르므로 비동기 saver 를 쓴다. 연결은 풀로 — postgres 가 재시작되거나 연결이 끊겨도
다음 요청에서 다시 연결한다(check_connection). 스키마 이름은 소문자 식별자만 쓴다(search_path 는 따옴표 없이 소문자로 읽힘).
"""
from contextlib import asynccontextmanager

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver


@asynccontextmanager
async def open_saver(database_url: str, schema: str = "langgraph"):
    async with await psycopg.AsyncConnection.connect(database_url, autocommit=True) as conn:
        await conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
    kwargs = {"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row,
              "options": f"-c search_path={schema}", "application_name": "ai-service"}
    async with AsyncConnectionPool(database_url, max_size=5, kwargs=kwargs, open=False,
                                   check=AsyncConnectionPool.check_connection) as pool:
        saver = AsyncPostgresSaver(pool)
        await saver.setup()
        yield saver
