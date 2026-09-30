"""Database writes participate in the caller's transaction."""

from psycopg import sql

def copy_rows(conn, table, columns, rows):
    statement = sql.SQL("COPY {} ({}) FROM STDIN").format(
        sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, columns))
    )
    count = 0
    with conn.cursor() as cur:
        with cur.copy(statement) as copy:
            for row in rows:
                # psycopg encodes None as SQL NULL and escapes text itself.
                copy.write_row(row)
                count += 1
    return count

def upsert_rows(conn, table, columns, rows, conflict_columns):
    rows = list(rows)
    if not rows:
        return 0

    statement = sql.SQL("""
        INSERT INTO {} ({}) VALUES ({})
        ON CONFLICT ({}) DO UPDATE SET {}
    """).format(
        sql.Identifier(table),
        sql.SQL(", ").join(map(sql.Identifier, columns)),
        sql.SQL(", ").join(sql.Placeholder() for _ in columns),
        sql.SQL(", ").join(map(sql.Identifier, conflict_columns)),
        sql.SQL(", ").join(
            sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c))
            for c in columns if c not in conflict_columns
        ),
    )
    with conn.cursor() as cur:
        cur.executemany(statement, rows)
    return len(rows)
