"""Explicit private credentials, without sourcing shell or importing DB config."""
import os
from pathlib import Path
import stat

from .api_records import CollectionError

PROJECT_ROOT = Path(__file__).resolve().parents[2]
KEY_NAMES = ("SEOUL_OPENAPI_KEY", "SEMAS_SERVICE_KEY")


def outside_project(path):
    path = Path(path).expanduser()
    if not path.is_absolute() or path.is_symlink() or path.parent.is_symlink():
        raise CollectionError("PRIVATE_ABSOLUTE_PATH_REQUIRED")
    resolved = path.resolve()
    if resolved.is_relative_to(PROJECT_ROOT) or any((p / ".git").exists() for p in resolved.parents):
        raise CollectionError("PRIVATE_PATH_OUTSIDE_GIT_REQUIRED")
    return path


def private_parent(path, *, create=False):
    path = outside_project(path)
    if create and not path.parent.exists():
        path.parent.mkdir(mode=0o700, parents=True)
    info = path.parent.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise CollectionError("PRIVATE_PARENT_0700_REQUIRED")
    return path


def key_file_path(path, *, create=False):
    path = Path(path).expanduser().absolute()
    if path.is_symlink() or path.parent.is_symlink():
        raise CollectionError("PRIVATE_ABSOLUTE_PATH_REQUIRED")
    if path.resolve() == PROJECT_ROOT / "etl" / "api.env":
        info = path.parent.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise CollectionError("CONFIG_PARENT_OWNER_MISMATCH")
        return path
    return private_parent(path, create=create)


def init_config(path):
    path = key_file_path(path, create=True)
    template = (PROJECT_ROOT / "etl" / "api.env.example").read_bytes()
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise CollectionError("CONFIG_ALREADY_EXISTS") from None
    with os.fdopen(fd, "wb") as target:
        target.write(template)


def validate_key(name, value):
    if not value:
        return ""
    if not isinstance(value, str) or len(value) > 512 or any(c.isspace() for c in value):
        raise CollectionError("INVALID_API_KEY")
    if any(c in value for c in "$`\\\"'<>;&|"):
        raise CollectionError("INVALID_API_KEY")
    if name == "SEMAS_SERVICE_KEY" and "%" in value:
        raise CollectionError("SEMAS_DECODING_KEY_REQUIRED")
    return value


def load_keys(path=None, *, environ=None):
    values = {}
    if path is None:
        env = os.environ if environ is None else environ
        values = {name: env.get(name, "") for name in KEY_NAMES}
    else:
        path = key_file_path(path)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "r", encoding="utf-8") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
                raise CollectionError("PRIVATE_CONFIG_0600_REQUIRED")
            content = source.read(16385)
        if len(content) > 16384:
            raise CollectionError("CONFIG_TOO_LARGE")
        return parse_keys(content)
    return {name: validate_key(name, values.get(name, "")) for name in KEY_NAMES}


def parse_keys(content):
    """Parse explicit configuration bytes without opening another credentials file."""
    content = content.removeprefix('\ufeff')  # UTF-8 BOM from Windows editors.
    values = {}
    for line in content.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, separator, value = line.partition("=")
        name, value = name.strip(), value.strip()
        if not separator or name not in KEY_NAMES or name in values:
            raise CollectionError("INVALID_CONFIG_LINE")
        values[name] = value
    return {name: validate_key(name, values.get(name, "")) for name in KEY_NAMES}
