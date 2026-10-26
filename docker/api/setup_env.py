"""Create local env files without a host Python installation or a database."""
import argparse
import os
from pathlib import Path


def prepare(root):
    root = Path(root).absolute()
    targets = [('etl', 'api.env'), ('frontend', '.env.local')]
    results = []
    for directory, name in targets:
        folder = root / directory
        path = folder / name
        template = folder / (name + '.example')
        if any(p.is_symlink() for p in (root, folder, path, template)):
            raise ValueError('SETUP_SYMLINK_REJECTED')
        if path.exists():
            if not path.is_file():
                raise ValueError('SETUP_REGULAR_FILE_REQUIRED')
            results.append(('EXISTS', directory + '/' + name))
            continue
        content = template.read_bytes().replace(b'\r\n', b'\n')
        # Exclusive creation preserves existing settings, including concurrent setup.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as target:
            target.write(content)
            # On Linux the helper runs as root; files must belong to the host user.
            # Desktop translates ownership/ACLs on the shared host filesystem.
            if hasattr(os, 'geteuid') and os.geteuid() == 0:
                info = folder.stat()
                os.fchown(target.fileno(), info.st_uid, info.st_gid)
        results.append(('CREATED', directory + '/' + name))
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/config'))
    args = parser.parse_args()
    for status, path in prepare(args.root):
        print(status, path)
