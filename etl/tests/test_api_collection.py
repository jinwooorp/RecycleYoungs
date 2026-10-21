import importlib
import importlib.util
import ast
from decimal import Decimal
from pathlib import Path
import unittest
from urllib.parse import parse_qs, urlsplit

from api_fixtures import FakeClient, sales, seoul, semas, stats, store


class CollectionTests(unittest.TestCase):
    def module(self, name):
        self.assertIsNotNone(importlib.util.find_spec("app." + name),
                             "DB-free API collection module is required")
        return importlib.import_module("app." + name)

    def test_stats_preserves_null_zero_codes_and_rates(self):
        m = self.module("api_records")
        row = m.normalize_store_stats(stats(STOR_CO=None, OPBIZ_RT=Decimal("1.25")), "20251")
        self.assertIsNone(row["store_count"])
        self.assertEqual(row["closing_store_count"], "0")
        self.assertEqual(row["opening_rate"], "1.25")
        self.assertEqual(row["industry_code"], "CAFE")

    def test_stats_preserves_other_and_unknown_industries(self):
        m = self.module("api_records")
        self.assertEqual(m.normalize_store_stats(stats(SVC_INDUTY_CD="CS200028"), "20251")["industry_code"], "HAIR")
        self.assertIsNone(m.normalize_store_stats(stats(SVC_INDUTY_CD="CS999999"), "20251")["industry_code"])

    def test_legacy_text_trimming_preserves_punctuation_and_identifier_zeroes(self):
        m = self.module('api_records')
        row = m.normalize_store(store(bizesId=' 000001 ', bizesNm=' A,B ',
                                     brchNm='  ', indsMclsNm='비알코올 '), 'I21201')
        self.assertEqual(row['source_store_id'], '000001')
        self.assertEqual(row['name'], 'A,B')
        self.assertIsNone(row['branch_name'])
        self.assertEqual(row['source_medium_category_name'], '비알코올')

    def test_store_scope_and_derived_industry_use_normalized_codes(self):
        m = self.module('api_records')
        for industry in (None, 'I21201'):
            with self.subTest(industry=industry):
                row = m.normalize_store(store(indsSclsCd=' I21201 ', ctprvnCd=' 11 ',
                                              stdrYm=' 202606 '), industry,
                                        source_reference_month='202606')
                self.assertEqual(row['source_small_category_code'], 'I21201')
                self.assertEqual(row['industry_code'], 'CAFE')
                self.assertEqual(row['source_reference_month'], '202606')

    def test_sales_all_fields_and_exact_integer(self):
        m = self.module("api_records")
        value = Decimal("9007199254740993.0")
        row = m.normalize_sales(sales(THSMON_SELNG_AMT=value, TMZON_06_11_SELNG_CO="7"), "20251")
        self.assertEqual(row["sales_amount"], "9007199254740993")
        self.assertEqual(row["time_06_11_transactions"], "7")
        self.assertEqual(row["age_60_plus_sales"], "0")
        self.assertEqual(len(row), 54)  # 53 source fields plus internal industry code

    def test_sales_targets_match_existing_etl_contract_without_importing_db(self):
        m = self.module("api_records")
        tree = ast.parse((Path(__file__).parents[1] / "app" / "etl_sales.py").read_text())
        targets = set()
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in
                    ("SALES_AMOUNT_FIELDS", "TRANSACTION_FIELDS") for t in node.targets):
                targets.update(pair[1] for pair in ast.literal_eval(node.value))
        row = m.normalize_sales(sales(), "20251")
        self.assertEqual(targets, set(row) - {"quarter_code", "dong_code", "dong_name",
                         "source_industry_code", "source_industry_name", "industry_code"})

    def test_invalid_numeric_or_schema_fails_closed(self):
        m = self.module("api_records")
        for value in ["1.5", "NaN", "Infinity", -1, True, "9223372036854775808", 1.0]:
            with self.subTest(value=value), self.assertRaises(m.CollectionError):
                m.normalize_store_stats(stats(STOR_CO=value), "20251")
        row = stats(); del row["STOR_CO"]
        with self.assertRaises(m.CollectionError):
            m.normalize_store_stats(row, "20251")
        with self.assertRaises(m.CollectionError):
            m.normalize_store_stats(stats(STDR_YYQU_CD="20252"), "20251")

    def test_store_coordinates_and_source_codes_are_preserved(self):
        m = self.module("api_records")
        row = m.normalize_store(store(lon=None), "I21201")
        self.assertIsNone(row["longitude"])
        self.assertIsNone(row["location"])
        self.assertEqual(row["latitude"], "37.58")
        self.assertEqual(row["dong_code"], "1111051500")
        self.assertEqual(row["source_store_id"], "000001")
        self.assertEqual(row["source_reference_month"], "202606")

    def test_store_rejects_wrong_scope_axis_or_month(self):
        m = self.module("api_records")
        for change in [dict(ctprvnCd="26"), dict(signguCd="26110"),
                       dict(indsSclsCd="I21202"), dict(lon="37", lat="127"),
                       dict(lat="NaN"), dict(stdrYm="202613")]:
            with self.subTest(change=change), self.assertRaises(m.CollectionError):
                m.normalize_store(store(**change), "I21201")

    def test_seoul_paging_and_no_automatic_http(self):
        m = self.module("seoul_api")
        client = FakeClient(seoul([stats()], 2), seoul([stats(ADSTRD_CD="11110530")], 2))
        pages = list(m.pages(client, "stores", "20251", "synthetic-key", page_size=1))
        self.assertEqual([p.number for p in pages], [1, 2])
        self.assertEqual(len(pages[0].records), 1)
        self.assertTrue(all(u.startswith("https://") for u in client.calls))
        self.assertIn("/2/2/20251", client.calls[1])

    def test_seoul_probe_is_one_bounded_page(self):
        m = self.module("seoul_api")
        client = FakeClient(seoul([stats()], 1000000))
        pages = list(m.pages(client, "stores", "20251", "sample", page_size=1, probe=True, allow_http=True))
        self.assertEqual(len(pages), 1)
        self.assertTrue(client.calls[0].startswith("http://"))

    def test_semas_probe_does_not_require_collecting_a_large_scope(self):
        m = self.module("semas_api")
        result = list(m.pages(FakeClient(semas([store()], 1000000, size=1)), "key", page_size=1, probe=True))
        self.assertEqual(len(result), 1)

    def test_seoul_error_empty_short_page_and_changing_total(self):
        m = self.module("seoul_api")
        e = self.module("api_records").CollectionError
        for payloads, size in [([{"RESULT": {"CODE": "INFO-100", "MESSAGE": "secret"}}], 1),
                               ([seoul([stats()], 2)], 2),
                               ([seoul([stats()], 2), seoul([stats()], 3)], 1)]:
            with self.subTest(payloads=payloads), self.assertRaises(e):
                list(m.pages(FakeClient(*payloads), "stores", "20251", "key", page_size=size))
        result = list(m.pages(FakeClient({"RESULT": {"CODE": "INFO-200"}}), "stores", "20251", "key"))
        self.assertEqual(result[0].total, 0)
        self.assertEqual(result[0].records, ())

    def test_seoul_rejects_invalid_request_before_network(self):
        m = self.module("seoul_api")
        e = self.module("api_records").CollectionError
        client = FakeClient()
        for service, quarter, size in [("reqStoreModify", "20251", 1), ("stores", "20255", 1),
                                       ("stores", "20251", 1001)]:
            with self.assertRaises(e):
                list(m.pages(client, service, quarter, "key", page_size=size))
        self.assertEqual(client.calls, [])

    def test_semas_paging_filter_encoding_and_envelopes(self):
        m = self.module("semas_api")
        second = semas([store(bizesId="000002")], 2, page=2, size=1)
        second["body"]["items"] = {"item": second["body"]["items"]}
        client = FakeClient(semas([store()], 2, size=1), {"response": second})
        result = list(m.pages(client, "a+/=", industry="I21201", page_size=1))
        self.assertEqual(len(result), 2)
        query = parse_qs(urlsplit(client.calls[0]).query)
        self.assertEqual(query["ServiceKey"], ["a+/="])
        self.assertEqual(query["key"], ["11"])
        self.assertEqual(query["indsSclsCd"], ["I21201"])
        self.assertTrue(client.calls[0].startswith("https://apis.data.go.kr/"))

    def test_semas_rejects_header_page_total_and_reference_changes(self):
        m = self.module("semas_api")
        e = self.module("api_records").CollectionError
        bad = semas([store()], 1, size=1); bad["header"]["resultCode"] = "30"
        for payloads in [[bad], [semas([store()], 1, page=2, size=1)],
                         [semas([store()], 2, size=1), semas([store(bizesId="2")], 3, page=2, size=1)],
                         [semas([store()], 2, size=1), semas([store(bizesId="2", stdrYm="202607")], 2, page=2, size=1)]]:
            with self.subTest(payloads=payloads), self.assertRaises(e):
                list(m.pages(FakeClient(*payloads), "key", page_size=1))

    def test_semas_reads_reference_month_from_header_without_mutating_rows(self):
        m = self.module("semas_api")
        payload = semas([store()], size=1)
        self.assertNotIn("stdrYm", payload["body"]["items"][0])
        page = next(m.pages(FakeClient(payload), "key", page_size=1, probe=True))
        self.assertEqual(page.source_periods, ("202606",))
        self.assertEqual(page.records[0]["source_reference_month"], "202606")
        self.assertNotIn("stdrYm", payload["body"]["items"][0])

    def test_semas_rejects_missing_invalid_or_conflicting_header_reference(self):
        m = self.module("semas_api")
        e = self.module("api_records").CollectionError
        missing = semas([store()], size=1); del missing["header"]["stdrYm"]
        invalid = semas([store()], size=1); invalid["header"]["stdrYm"] = "202613"
        conflict = semas([store()], size=1); conflict["body"]["items"][0]["stdrYm"] = "202607"
        for payload in (missing, invalid, conflict):
            with self.subTest(payload=payload), self.assertRaises(e):
                list(m.pages(FakeClient(payload), "key", page_size=1))

    def test_semas_empty_page_retains_header_reference(self):
        m = self.module("semas_api")
        page = next(m.pages(FakeClient(semas([], size=1)), "key", page_size=1))
        self.assertEqual(page.records, ())
        self.assertEqual(page.source_periods, ("202606",))


if __name__ == "__main__":
    unittest.main()
