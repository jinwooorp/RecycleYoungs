"""Check source CSVs before opening a database connection."""

import csv
from dataclasses import dataclass
from pathlib import Path

from .utils import find_file


@dataclass(frozen=True)
class InputSpec:
    name: str
    filename: str
    encoding: str
    required: tuple[str, ...]
    keys: tuple[str, ...]
    not_null: tuple[str, ...] = ()
    expected_quarters: tuple[str, ...] = ()


@dataclass(frozen=True)
class InputReport:
    path: Path
    rows: int
    quarters: tuple[str, ...]


def validate_input(data_dir, spec):
    path = find_file(data_dir, spec.filename)
    quarters = set()
    keys = set()
    row_count = 0
    with path.open(encoding=spec.encoding, newline="") as source:
        reader = csv.reader(source, strict=True)
        header = next(reader, [])
        missing = set(spec.required) - set(header)
        if missing:
            raise ValueError(f"{spec.filename}: 필수 컬럼 누락 {sorted(missing)}")
        if len(header) != len(set(header)):
            raise ValueError(f"{spec.filename}: 중복 컬럼 이름")
        indexes = {name: header.index(name) for name in spec.keys + spec.not_null}
        quarter_index = (
            header.index("기준_년분기_코드") if spec.expected_quarters else None
        )
        for row in reader:
            # Completely blank physical lines are also ignored by pandas.
            if not row:
                continue
            if len(row) != len(header):
                raise ValueError(f"{spec.filename}:{reader.line_num}: 컬럼 개수 불일치")
            if any(not row[index].strip() for index in indexes.values()):
                raise ValueError(f"{spec.filename}:{reader.line_num}: 필수 값 누락")
            key = tuple(row[indexes[name]].strip() for name in spec.keys)
            if key in keys:
                raise ValueError(f"{spec.filename}:{reader.line_num}: 중복 키 {key}")
            keys.add(key)
            if quarter_index is not None:
                quarter = row[quarter_index].strip()
                if quarter not in spec.expected_quarters:
                    raise ValueError(
                        f"{spec.filename}:{reader.line_num}: 예상 밖 분기 {quarter!r}"
                    )
                quarters.add(quarter)
            row_count += 1
    if not row_count:
        raise ValueError(f"{spec.filename}: 데이터 행이 없습니다")
    if spec.expected_quarters:
        missing_quarters = set(spec.expected_quarters) - quarters
        if missing_quarters:
            raise ValueError(
                f"{spec.filename}: 연간 입력의 분기가 누락되었습니다 {sorted(missing_quarters)}"
            )
    return InputReport(path, row_count, tuple(sorted(quarters)))


def validate_inputs(data_dir, specs):
    reports = {}
    for spec in specs:
        report = validate_input(data_dir, spec)
        reports[spec.name] = report
        periods = f"; quarters={','.join(report.quarters)}" if report.quarters else ""
        print(f"[validate:{spec.name}] {report.rows:,} rows; {report.path}{periods}")
    return reports
