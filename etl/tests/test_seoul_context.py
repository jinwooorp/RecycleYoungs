"""Synthetic-only contracts for the seven new DB-free context sources."""
from decimal import Decimal
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from api_fixtures import FakeClient, seoul
from app.api_records import CollectionError, Page


def source_row(spec, **changes):
    return dict(STDR_YYQU_CD="20262", ADSTRD_CD="11110515", ADSTRD_CD_NM="합성동",
                **{k: "0" for k in spec.numeric_fields},
                **{k: "합성유형" for k in spec.text_fields}) | changes


class ContextTests(unittest.TestCase):
    def module(self):
        return importlib.import_module("app.seoul_context")

    def test_seven_exact_contracts_and_source_keys(self):
        m = self.module()
        self.assertEqual({s.service: 3 + len(s.numeric_fields) + len(s.text_fields)
                          for s in m.SOURCES.values()}, {
            "VwsmAdstrdFlpopW": 25, "VwsmAdstrdRepopW": 27,
            "VwsmAdstrdWrcPopltnW": 24, "VwsmAdstrdFcltyW": 23,
            "VwsmAdstrdIxQq": 9, "VwsmAdstrdNcmCnsmpW": 14, "VwsmAdstrdAptW": 18})
        for name, spec in m.SOURCES.items():
            row = m.normalize(name, source_row(spec))
            self.assertEqual(row["quarter_code"], "20262")
            self.assertEqual(row["dong_code"], "11110515")
            self.assertEqual(set(row["metrics"]), set(spec.numeric_fields))
            self.assertEqual(set(row["attributes"]), set(spec.text_fields))

    def test_exact_decimal_null_zero_and_big_integer(self):
        m = self.module(); spec = m.SOURCES["seoul-population"]
        row = m.normalize("seoul-population", source_row(spec,
            TOT_FLPOP_CO=Decimal("9007199254740993.25"), ML_FLPOP_CO=None, FML_FLPOP_CO="0"))
        self.assertEqual(row["metrics"]["TOT_FLPOP_CO"], "9007199254740993.25")
        self.assertIsNone(row["metrics"]["ML_FLPOP_CO"])
        self.assertEqual(row["metrics"]["FML_FLPOP_CO"], "0")

    def test_bad_schema_period_scope_and_nonfinite_fail_closed(self):
        m = self.module(); spec = m.SOURCES["seoul-population"]
        for changes in [dict(STDR_YYQU_CD="20265"), dict(ADSTRD_CD="26110515"),
                        dict(ADSTRD_CD="1111051500"), dict(TOT_FLPOP_CO="-1"),
                        dict(TOT_FLPOP_CO="NaN"), dict(TOT_FLPOP_CO=True),
                        dict(TOT_FLPOP_CO=1.5), dict(TOT_FLPOP_CO="1e999999"),
                        dict(UNEXPECTED_INCOME="123")]:
            with self.subTest(changes=changes), self.assertRaises(CollectionError):
                m.normalize("seoul-population", source_row(spec, **changes))
        raw = source_row(spec); del raw["TOT_FLPOP_CO"]
        with self.assertRaises(CollectionError): m.normalize("seoul-population", raw)

    def test_integer_counts_reject_fractional_facility_but_average_is_decimal(self):
        m = self.module()
        with self.assertRaises(CollectionError):
            m.normalize("seoul-facilities", source_row(m.SOURCES["seoul-facilities"], BANK_CO="1.5"))
        row = m.normalize("seoul-apartments", source_row(m.SOURCES["seoul-apartments"], AVRG_AE="12.50"))
        self.assertEqual(row["metrics"]["AVRG_AE"], "12.50")

    def test_all_period_paging_does_not_append_ignored_filter(self):
        m = self.module(); source = "seoul-population"; spec = m.SOURCES[source]
        client = FakeClient(seoul([source_row(spec)], 2, spec.service),
                            seoul([source_row(spec, STDR_YYQU_CD="20251")], 2, spec.service))
        pages = list(m.pages(client, source, "synthetic", page_size=1))
        self.assertTrue(client.calls[0].endswith("/1/1/"))
        self.assertTrue(client.calls[1].endswith("/2/2/"))
        self.assertTrue(client.calls[0].startswith("https://"))
        self.assertEqual(pages[1].source_periods, ("20251",))
        self.assertEqual([p.total for p in pages], [2, 2])

    def test_workers_optional_filter_and_actual_row_period_check(self):
        m = self.module(); spec = m.SOURCES["seoul-workers"]
        client = FakeClient(seoul([source_row(spec)], service=spec.service))
        list(m.pages(client, "seoul-workers", "synthetic", period="20262"))
        self.assertTrue(client.calls[0].endswith("/1/1000/20262"))
        with self.assertRaisesRegex(CollectionError, "QUARTER_MISMATCH"):
            list(m.pages(FakeClient(seoul([source_row(spec)], service=spec.service)),
                         "seoul-workers", "synthetic", period="20261"))

    def test_invalid_request_options_fail_before_network(self):
        m = self.module(); client = FakeClient()
        for source, kwargs in [("seoul-population", dict(period="20262")),
                               ("arbitrary", {}), ("seoul-workers", dict(period="20265")),
                               ("seoul-workers", dict(page_size=True)),
                               ("seoul-workers", dict(page_size=1001))]:
            with self.assertRaises(CollectionError): list(m.pages(client, source, "key", **kwargs))
        with self.assertRaises(CollectionError): list(m.pages(client, "seoul-workers", "sample"))
        with self.assertRaises(CollectionError):
            list(m.pages(client, "seoul-workers", "sample", probe=True, page_size=6))
        self.assertEqual(client.calls, [])

    def test_probe_and_empty_semantics(self):
        m = self.module(); spec = m.SOURCES["seoul-population"]
        client = FakeClient(seoul([source_row(spec)], 9350, spec.service))
        page = next(m.pages(client, "seoul-population", "sample", probe=True, page_size=1, allow_http=True))
        self.assertEqual(page.total, 9350)
        self.assertTrue(client.calls[0].startswith("http://"))
        empty = list(m.pages(FakeClient({"RESULT": {"CODE": "INFO-200"}}), "seoul-population", "key"))
        self.assertEqual(empty[0].records, ())

    def test_short_page_total_change_error_and_wrong_envelope(self):
        m = self.module(); spec = m.SOURCES["seoul-population"]; row = source_row(spec)
        for payloads, size in [([seoul([row], 2, spec.service)], 2),
            ([seoul([row], 2, spec.service), seoul([row], 3, spec.service)], 1),
            ([{"RESULT": {"CODE": "ERROR-300", "MESSAGE": "sensitive"}}], 1),
            ([seoul([row], 1, "wrong")], 1)]:
            with self.subTest(payloads=payloads), self.assertRaises(CollectionError):
                list(m.pages(FakeClient(*payloads), "seoul-population", "key", page_size=size))

    def test_quality_distinguishes_missing_rows_null_zero_and_annual_change(self):
        m = self.module(); name = "seoul-residents"; spec = m.SOURCES[name]
        report = m.QualityReport(name)
        rows = [source_row(spec, STDR_YYQU_CD="20261", ML_REPOP_CO=None),
                source_row(spec, STDR_YYQU_CD="20262", ML_REPOP_CO=None),
                source_row(spec, STDR_YYQU_CD="20262", ADSTRD_CD="11110530", TOT_REPOP_CO="2")]
        for row in rows: report.observe(m.normalize(name, row))
        q = report.finish(complete=True)
        self.assertEqual(q["periods"]["20261"]["row_count"], 1)
        self.assertEqual(q["periods"]["20261"]["absent_from_observed_union"], ["11110530"])
        self.assertEqual(q["fields"]["ML_REPOP_CO"]["null_count"], 2)
        self.assertEqual(q["fields"]["ML_REPOP_CO"]["zero_count"], 1)
        self.assertEqual(q["annual_comparisons"]["20261->20262"]["unchanged"], 1)
        self.assertFalse(q["score_ready"])
        self.assertFalse(q["historical_boundary_compatible"])

    def test_quality_reports_changed_values_name_conflict_and_reconciliation(self):
        m = self.module(); source = "seoul-population"; spec = m.SOURCES[source]
        q = m.QualityReport(source)
        q.observe(m.normalize(source, source_row(spec, STDR_YYQU_CD="20261", TOT_FLPOP_CO="1.25")))
        q.observe(m.normalize(source, source_row(spec, ADSTRD_CD_NM="변경동")))
        result = q.finish(complete=True)
        self.assertEqual(result["name_conflict_count"], 1)
        self.assertEqual(result["fields"]["TOT_FLPOP_CO"]["fractional_count"], 1)
        self.assertGreater(result["reconciliations"]["sex"]["mismatch_count"], 0)
        self.assertEqual(result["reconciliations"]["sex"]["max_absolute_difference"], "1.25")

    def test_writer_new_natural_key_quality_hash_and_probe_unpublished(self):
        m = self.module(); from app.api_artifacts import write_run
        source = "seoul-population"; spec = m.SOURCES[source]
        records = tuple(m.normalize(source, source_row(spec, STDR_YYQU_CD=p)) for p in ["20261", "20262"])
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d); parent.chmod(0o700); out = parent / "run"
            manifest = write_run(out, [Page(1, 2, records, b'{}', ("20261", "20262"))],
                                 source=source, scope={}, mode="collect")
            self.assertTrue(manifest["complete"])
            self.assertFalse(manifest["published"])
            self.assertEqual(manifest["source_periods"], ["20261", "20262"])
            self.assertEqual(manifest["quality_report"]["file"], "quality.json")
            self.assertFalse(json.loads((out / "quality.json").read_text())["score_ready"])
            with self.assertRaisesRegex(CollectionError, "OUTPUT_ALREADY_EXISTS"):
                write_run(out, [], source=source, scope={}, mode="collect")
            probe = write_run(parent / "probe", [Page(1, 9350, records, b'{}', ("20261", "20262"))],
                              source=source, scope={}, mode="probe")
            self.assertFalse(probe["complete"])
            self.assertFalse(json.loads((parent / "probe/quality.json").read_text())["collection_complete"])

    def test_writer_duplicate_or_late_failure_cannot_complete(self):
        m = self.module(); from app.api_artifacts import write_run
        source = "seoul-population"; spec = m.SOURCES[source]
        row = m.normalize(source, source_row(spec))
        def failing():
            yield Page(1, 2, (row,), b'{}', ("20262",))
            raise CollectionError("SOURCE_TOTAL_CHANGED")
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d); parent.chmod(0o700)
            for name, pages in [("duplicate", [Page(1, 2, (row, row), b'{}')]), ("failure", failing())]:
                out = parent / name
                with self.assertRaises(CollectionError): write_run(out, pages, source=source, scope={}, mode="collect")
                manifest = json.loads((out / "manifest.json").read_text())
                self.assertEqual(manifest["status"], "FAILED")
                self.assertFalse(manifest["complete"])
                self.assertFalse(manifest["published"])

    def test_cli_routes_new_sources_and_rejects_silent_period_filter(self):
        m = self.module(); from app.collect_main import main
        with patch('app.collect_main.load_keys', return_value={'SEOUL_OPENAPI_KEY': 'synthetic', 'SEMAS_SERVICE_KEY': ''}), \
             patch('app.collect_main.write_run') as write, patch('app.collect_main.HttpClient') as http:
            self.assertEqual(main(['collect', 'seoul-population', '--quarter', '20262', '--output', '/new']), 2)
            write.assert_not_called(); http.assert_not_called()
            write.return_value = dict(status='COLLECTED_UNPUBLISHED', complete=True, published=False,
                                      received_count=2, declared_count=2)
            self.assertEqual(main(['collect', 'seoul-population', '--output', '/new']), 0)
            self.assertEqual(write.call_args.kwargs['scope']['period_scope'], 'ALL_SOURCE_PERIODS')
            write.return_value = dict(status='QUARANTINED_UNPUBLISHED', complete=False, published=False,
                                      received_count=2, declared_count=2)
            self.assertEqual(main(['collect', 'seoul-consumption', '--quarantine-negative-consumption', '--output', '/new']), 3)
            self.assertTrue(write.call_args.kwargs['scope']['quarantine_negative_consumption'])

    def test_quarantine_is_explicit_only_negative_consumption_and_never_complete(self):
        m = self.module(); from app.api_artifacts import write_run
        source = 'seoul-consumption'; spec = m.SOURCES[source]
        bad = source_row(spec, ETC_EXPNDTR_TOTAMT='-123')
        with self.assertRaises(CollectionError): m.normalize(source, bad)
        client = FakeClient(seoul([bad, source_row(spec, ADSTRD_CD='11110530')], service=spec.service))
        pages = list(m.pages(client, source, 'synthetic', quarantine_negative=True))
        self.assertEqual(len(pages[0].records), 1)
        self.assertEqual(pages[0].quarantined[0]['fields'], ['ETC_EXPNDTR_TOTAMT'])
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d); parent.chmod(0o700)
            manifest = write_run(parent / 'run', pages, source=source, scope={}, mode='collect')
            self.assertEqual(manifest['received_count'], 2)
            self.assertEqual(manifest['normalized_count'], 1)
            self.assertEqual(manifest['quarantined_count'], 1)
            self.assertTrue(manifest['raw_complete'])
            self.assertFalse(manifest['complete'])
            self.assertFalse(manifest['published'])
            self.assertEqual(manifest['status'], 'QUARANTINED_UNPUBLISHED')
            q = json.loads((parent/'run/quality.json').read_text())
            self.assertEqual(q['quarantined_count'], 1)
            self.assertEqual(q['quarantined_period_counts'], {'20262': 1})
            self.assertFalse(q['collection_complete'])
        for source, changes in [('seoul-population', {}), ('seoul-consumption', {'ETC_EXPNDTR_TOTAMT': 'NaN'}),
                                ('seoul-consumption', {'ETC_EXPNDTR_TOTAMT': '-1', 'UNEXPECTED': '0'}),
                                ('seoul-consumption', {'ETC_EXPNDTR_TOTAMT': '-1', 'FD_EXPNDTR_TOTAMT': '1.5'})]:
            spec = m.SOURCES[source]
            with self.assertRaises(CollectionError):
                list(m.pages(FakeClient(seoul([source_row(spec, **changes)], service=spec.service)),
                             source, 'synthetic', quarantine_negative=True))

    def test_quarantined_duplicate_key_still_fails_and_probe_never_raw_complete(self):
        m = self.module(); from app.api_artifacts import write_run
        source = 'seoul-consumption'; spec = m.SOURCES[source]
        row = source_row(spec, ETC_EXPNDTR_TOTAMT='-1')
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d); parent.chmod(0o700)
            for suffix, raw in [('duplicate', [row, row]), ('probe', [row])]:
                pages = m.pages(FakeClient(seoul(raw, service=spec.service)), source, 'synthetic',
                                page_size=len(raw), probe=suffix=='probe', quarantine_negative=True)
                if suffix == 'duplicate':
                    with self.assertRaisesRegex(CollectionError, 'DUPLICATE_SOURCE_KEY'):
                        write_run(parent/suffix, pages, source=source, scope={}, mode='collect')
                else:
                    manifest = write_run(parent/suffix, pages, source=source, scope={}, mode='probe')
                    self.assertFalse(manifest['raw_complete'])

    def test_report_failure_must_clear_completion_flags(self):
        m = self.module(); from app.api_artifacts import write_run
        source = 'seoul-population'; spec = m.SOURCES[source]
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d); parent.chmod(0o700)
            with patch('app.api_artifacts.QualityReport.finish', side_effect=OSError('synthetic disk failure')):
                with self.assertRaises(OSError):
                    write_run(parent/'failed', [Page(1, 1, (m.normalize(source, source_row(spec)),), b'{}')],
                              source=source, scope={}, mode='collect')
            manifest = json.loads((parent/'failed/manifest.json').read_text())
            self.assertEqual(manifest['status'], 'FAILED')
            self.assertFalse(manifest['complete'])
            self.assertFalse(manifest['raw_complete'])

    def test_annual_expectation_conflict_and_observed_missing_rows_are_warnings(self):
        m = self.module(); source = 'seoul-consumption'; spec = m.SOURCES[source]
        q = m.QualityReport(source)
        for changes in [dict(STDR_YYQU_CD='20261'), dict(STDR_YYQU_CD='20262', EXPNDTR_TOTAMT='1'),
                        dict(STDR_YYQU_CD='20261', ADSTRD_CD='11110530')]:
            q.observe(m.normalize(source, source_row(spec, **changes)))
        result = q.finish(complete=True)
        self.assertIn('ANNUAL_REPEAT_EXPECTATION_MISMATCH', result['warnings'])
        self.assertIn('MISSING_ROWS_FROM_OBSERVED_UNION', result['warnings'])
        self.assertEqual(result['reconciliation_basis'], 'CANDIDATE_GROUPINGS_NOT_CONFIRMED_DEFINITIONS')

    def test_all_context_sources_stay_rejected_by_release(self):
        m = self.module(); from app.api_artifacts import write_run
        from app.api_release import prepare_release
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d); parent.chmod(0o700)
            for source, spec in m.SOURCES.items():
                path = parent/source
                write_run(path, [Page(1, 1, (m.normalize(source, source_row(spec)),), b'{}')],
                          source=source, scope={}, mode='collect')
                with self.assertRaises(CollectionError): prepare_release([path])

    def test_annual_comparison_uses_numeric_equality_and_preserves_null(self):
        m = self.module(); source = 'seoul-residents'; spec = m.SOURCES[source]
        q = m.QualityReport(source)
        for period, value in [('20261', '1'), ('20262', '1.00'), ('20263', None)]:
            row = m.normalize(source, source_row(spec, STDR_YYQU_CD=period, TOT_REPOP_CO=value))
            self.assertEqual(row['metrics']['TOT_REPOP_CO'], value)
            q.observe(row)
        result = q.finish(complete=True)
        self.assertEqual(result['annual_comparisons']['20261->20262']['unchanged'], 1)
        self.assertEqual(result['annual_comparisons']['20262->20263']['changed'], 1)


if __name__ == '__main__': unittest.main()
