import math
from decimal import Decimal, InvalidOperation
import pandas as pd

def clean_text(value):
    if pd.isna(value):
        return None
    value = str(value).strip()
    return value if value else None

def clean_int(value):
    text = clean_text(value)
    if text is None:
        return None
    try:
        return int(text)
    except ValueError:
        try:
            number = Decimal(text)
            if not number.is_finite() or number != number.to_integral_value():
                raise ValueError(f"정수로 변환할 수 없습니다: {value!r}")
            return int(number)
        except InvalidOperation as exc:
            raise ValueError(f"정수로 변환할 수 없습니다: {value!r}") from exc

def clean_float(value):
    text = clean_text(value)
    if text is None:
        return None
    number = float(text)
    if not math.isfinite(number):
        raise ValueError(f"유한한 실수로 변환할 수 없습니다: {value!r}")
    return number

def read_csv(path, **kwargs):
    return pd.read_csv(
        path,
        encoding=kwargs.pop("encoding", "cp949"),
        dtype=kwargs.pop("dtype", str),
        keep_default_na=kwargs.pop("keep_default_na", False),
        low_memory=False,
        **kwargs,
    )

def find_file(data_dir, exact_name):
    matches = sorted(path for path in data_dir.rglob(exact_name) if path.is_file())
    if not matches:
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {exact_name}")
    if len(matches) != 1:
        raise ValueError(f"동일한 이름의 입력 파일이 여러 개입니다: {exact_name}: {matches}")
    return matches[0]
