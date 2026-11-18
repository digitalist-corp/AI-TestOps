"""체크포인트는 같은 PostgreSQL 의 별도 스키마(langgraph)에 둔다. Flyway 는 이 스키마를 건드리지 않는다 (E-01 결정)."""
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from langgraph.checkpoint.postgres import PostgresSaver


@contextmanager
def open_saver(database_url: str, schema: str = "langgraph"):
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
    with psycopg.connect(database_url, autocommit=True, prepare_threshold=0, row_factory=dict_row,
                         options=f"-c search_path={schema}") as conn:
        saver = PostgresSaver(conn)
        saver.setup()
        yield saver
