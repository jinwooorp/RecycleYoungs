from psycopg.rows import dict_row

def load_industry_map(conn):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            SELECT im.source, im.source_code, im.industry_id
            FROM industry_mappings im
        """)
        rows = cur.fetchall()

    return {(r["source"], r["source_code"]): r["industry_id"] for r in rows}
