import copy
import csv
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import etl_commercial_areas, etl_stores, main
from app.loaders import copy_rows
from app.preflight import InputSpec, validate_input
from app.utils import clean_float, clean_int, find_file, read_csv


class InputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data_dir = Path(self.temp.name)
        self.spec = InputSpec("stores", "sample.csv", "utf-8", ("id", "name"), ("id",))

    def write(self, rows):
        path = self.data_dir / self.spec.filename
        with path.open("w", encoding="utf-8", newline="") as dest:
            csv.writer(dest).writerows(rows)
        return path

    def test_missing_and_duplicate_input_are_rejected(self):
        with self.assertRaises(FileNotFoundError):
            find_file(self.data_dir, self.spec.filename)
        self.write([("id", "name"), ("1", "cafe")])
        nested = self.data_dir / "nested"
        nested.mkdir()
        (nested / self.spec.filename).touch()
        with self.assertRaisesRegex(ValueError, "여러 개"):
            find_file(self.data_dir, self.spec.filename)

    def test_missing_header_is_rejected(self):
        self.write([("id",), ("1",)])
        with self.assertRaisesRegex(ValueError, "필수 컬럼"):
            validate_input(self.data_dir, self.spec)

    def test_empty_and_duplicate_keys_are_rejected(self):
        for rows, error in (
            ([("id", "name")], "데이터 행"),
            ([("id", "name"), ("", "cafe")], "필수 값"),
            ([("id", "name"), ("1", "a"), ("1", "b")], "중복 키"),
        ):
            with self.subTest(error=error):
                self.write(rows)
                with self.assertRaisesRegex(ValueError, error):
                    validate_input(self.data_dir, self.spec)

    def test_structural_error_and_wrong_period_are_rejected(self):
        self.write([("id", "name"), ("1", "a", "extra")])
        with self.assertRaisesRegex(ValueError, "개수 불일치"):
            validate_input(self.data_dir, self.spec)
        spec = InputSpec(
            "stores", self.spec.filename, "utf-8", ("id", "기준_년분기_코드"),
            ("id",), expected_quarters=("20251",),
        )
        self.write([("id", "기준_년분기_코드"), ("1", "20261")])
        with self.assertRaisesRegex(ValueError, "예상 밖 분기"):
            validate_input(self.data_dir, spec)

    def test_csv_preserves_codes_and_literal_na(self):
        path = self.write([("id", "name"), ("001", "NA")])
        row = read_csv(path, encoding="utf-8").iloc[0]
        self.assertEqual(row["id"], "001")
        self.assertEqual(row["name"], "NA")

    def test_annual_input_requires_all_expected_quarters(self):
        spec = InputSpec(
            "stores", self.spec.filename, "utf-8", ("id", "기준_년분기_코드"),
            ("id",), expected_quarters=("20251", "20252", "20253", "20254"),
        )
        self.write([("id", "기준_년분기_코드"), ("1", "20251")])
        with self.assertRaisesRegex(ValueError, "분기가 누락"):
            validate_input(self.data_dir, spec)
        self.write([("id", "기준_년분기_코드")] + [
            (str(index), quarter) for index, quarter in enumerate(spec.expected_quarters)
        ])
        report = validate_input(self.data_dir, spec)
        self.assertEqual(report.quarters, spec.expected_quarters)


class LoaderTests(unittest.TestCase):
    def test_copy_preserves_nulls_and_special_text_without_committing(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        writer = cursor.copy.return_value.__enter__.return_value
        row = ("store", None, "\\N", "quoted\ttext\nnext", None)
        self.assertEqual(copy_rows(conn, "stores", ["id", "industry", "name", "address", "geom"], iter([row])), 1)
        writer.write_row.assert_called_once_with(row)
        conn.commit.assert_not_called()

    def test_store_chunk_preserves_nullable_industry_and_geometry(self):
        from store_fixtures import mapped_mock_connection
        conn, cursor, _ = mapped_mock_connection()
        writer = cursor.copy.return_value.__enter__.return_value
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "stores.csv"
            with path.open("w", encoding="utf-8-sig", newline="") as dest:
                csv_writer = csv.DictWriter(dest, fieldnames=etl_stores.USECOLS)
                csv_writer.writeheader()
                csv_writer.writerow({
                    "상가업소번호": "0001", "상호명": "cafe",
                    "시군구코드": "01110", "경도": "127.0", "위도": "37.5",
                })
                csv_writer.writerow({"상가업소번호": "0002", "상호명": "no coordinates"})
            with redirect_stdout(StringIO()), patch.object(etl_stores, "STORE_CHUNK_SIZE", 1):
                etl_stores.run(conn, path)
        rows = [call.args[0] for call in writer.write_row.call_args_list]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][0], "0001")
        self.assertIsNone(rows[0][11])
        self.assertEqual(rows[0][12], "01110")
        self.assertEqual(rows[0][-1], "SRID=4326;POINT(127.0 37.5)")
        self.assertIsNone(rows[1][-1])
        conn.commit.assert_not_called()

    def test_area_missing_coordinates_use_typed_null_parameters(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "areas.csv"
            with path.open("w", encoding="cp949", newline="") as dest:
                csv_writer = csv.DictWriter(dest, fieldnames=etl_commercial_areas.REQUIRED)
                csv_writer.writeheader()
                csv_writer.writerow({"상권_코드": "001", "상권_코드_명": "test"})
            with redirect_stdout(StringIO()), patch.object(etl_commercial_areas, "AREA_SOURCE_CRS", "EPSG:4326"):
                etl_commercial_areas.run(conn, path)
        statement, params = cursor.execute.call_args.args
        self.assertEqual(params[-4:], (None, None, None, None))
        self.assertEqual(statement.count("%s::double precision IS NULL"), 2)
        conn.commit.assert_not_called()

    def test_numbers_are_precise_and_invalid_values_fail(self):
        self.assertEqual(clean_int("9007199254740993"), 9007199254740993)
        self.assertEqual(clean_int("12.0"), 12)
        self.assertIsNone(clean_int("  "))
        self.assertIsNone(clean_float(None))
        for value in ("oops", "12.5", "Infinity"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                clean_int(value)
        with self.assertRaises(ValueError):
            clean_float("inf")


class FakeConnection:
    def __init__(self):
        self.rows = ["existing data"]
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def transaction(self):
        conn = self

        class Transaction:
            def __enter__(self):
                self.before = copy.deepcopy(conn.rows)

            def __exit__(self, exc_type, exc, traceback):
                if exc_type:
                    conn.rows = self.before
                    conn.rolled_back = True
                else:
                    conn.committed = True
                return False

        return Transaction()

    def close(self):
        self.closed = True


class MainTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data_dir = Path(self.temp.name)
        self.specs = (
            InputSpec("store_stats_dong", "stats.csv", "utf-8", ("id",), ("id",)),
            InputSpec("stores", "stores.csv", "utf-8", ("id",), ("id",)),
        )
        for spec in self.specs:
            (self.data_dir / spec.filename).write_text("id\n001\n", encoding="utf-8")
        self.addCleanup(patch.stopall)
        patch.object(main, "INPUTS", self.specs).start()
        self.jobs = {spec.name: MagicMock() for spec in self.specs}
        patch.object(main, "JOBS", self.jobs).start()
        self.connect = patch.object(main, "get_connection").start()
        self.args = ["--data-dir", str(self.data_dir)]

    def run_main(self, *args):
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            return main.main(self.args + list(args))

    def test_validation_only_never_connects(self):
        self.assertEqual(self.run_main("--validate-only"), 0)
        self.connect.assert_not_called()

    def test_preflight_failure_never_connects(self):
        (self.data_dir / "stores.csv").unlink()
        self.assertEqual(self.run_main(), 1)
        self.connect.assert_not_called()

    def test_area_load_requires_explicit_crs_before_connection(self):
        area = InputSpec("commercial_areas", "stats.csv", "utf-8", ("id",), ("id",))
        with patch.object(main, "INPUTS", (area,)), patch.object(main, "JOBS", {"commercial_areas": MagicMock()}), patch.object(main, "AREA_SOURCE_CRS", ""):
            self.assertEqual(self.run_main(), 1)
            self.connect.assert_not_called()
            self.assertEqual(self.run_main("--validate-only"), 0)

    def test_only_validates_and_loads_selected_inputs(self):
        (self.data_dir / "stats.csv").unlink()
        conn = FakeConnection()
        self.connect.return_value = conn
        self.assertEqual(self.run_main("--only", "stores"), 0)
        self.jobs["store_stats_dong"].assert_not_called()
        self.jobs["stores"].assert_called_once_with(conn, self.data_dir / "stores.csv")
        self.assertTrue(conn.committed)
        self.assertTrue(conn.closed)

    def test_later_failure_rolls_back_the_whole_selected_run(self):
        conn = FakeConnection()
        self.connect.return_value = conn
        self.jobs["store_stats_dong"].side_effect = lambda db, path: db.rows.clear()
        self.jobs["stores"].side_effect = ValueError("later chunk failed")
        self.assertEqual(self.run_main(), 1)
        self.assertEqual(conn.rows, ["existing data"])
        self.assertTrue(conn.rolled_back)
        self.assertFalse(conn.committed)
        self.assertTrue(conn.closed)


if __name__ == "__main__":
    unittest.main()
