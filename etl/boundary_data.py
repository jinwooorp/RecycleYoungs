"""Pinned official boundary ZIPs and byte-preserved public validation evidence.

The public report bundle is a reversible snapshot of already published reports.
It is not new validation evidence. Source geometry and the approved six repairs
remain governed by app.spatial_sources and app.spatial_geometry.
"""
import base64
from dataclasses import replace
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit, parse_qsl
from urllib.request import HTTPRedirectHandler, Request, build_opener

from app.spatial_sources import SPECS


ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'data/boundaries/public-reports.json'
REPORTS = {
    'admin-report.json': (22454, '676671b3de305fe45d63f6fd7c6f3f5bbf1a23f01aa5da6e05ddaf3c8aa5fae3'),
    'commercial-report.json': (485933, '5f64f4fe6d59f3831e413ddd7a47490bb628a35b5c35ae44ca6b26b1148fdbd2'),
    'repair-report.json': (269967, '133b23b6ed9dc07fe8ba3f6801acc499f8232eef3f12b902d917e87d81716e74'),
}
DOWNLOADS = {
    'admin': {
        'url': 'https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?infId=OA-22160&seq=1&infSeq=3&useCache=false',
        'bytes': 1676539, 'sha256': SPECS['admin'].archive_sha256,
    },
    'commercial': {
        'url': 'https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?infId=OA-15560&seq=5&infSeq=3&useCache=false',
        'bytes': 2123078, 'sha256': SPECS['commercial'].archive_sha256,
    },
}


def report_bytes(bundle=None):
    bundle = json.loads(BUNDLE.read_text(encoding='utf-8')) if bundle is None else bundle
    if bundle.get('schema_version') != 1 or set(bundle.get('reports', {})) != set(REPORTS):
        raise ValueError('BOUNDARY_REPORT_BUNDLE_INVALID')
    result = {}
    for name, (size, digest) in REPORTS.items():
        item = bundle['reports'][name]
        if item.get('bytes') != size or item.get('sha256') != digest:
            raise ValueError('BOUNDARY_REPORT_IDENTITY_CHANGED')
        encoded = base64.b64decode(item['gzip_base64'], validate=True)
        with gzip.GzipFile(fileobj=io.BytesIO(encoded)) as stream:
            data = stream.read(size + 1)
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('BOUNDARY_REPORT_BYTES_CHANGED')
        if not isinstance(json.loads(data), dict):
            raise ValueError('BOUNDARY_REPORT_INVALID')
        result[name] = data
    return result


def boundary_specs():
    return {
        kind: replace(spec, report_hashes={
            role: REPORTS['repair-report.json' if role == 'repair' else kind + '-report.json'][1]
            for role in spec.report_hashes
        }, report_artifacts={
            role: 'repair-report.json' if role == 'repair' else kind + '-report.json'
            for role in spec.report_hashes
        }) for kind, spec in SPECS.items()
    }


def official_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname != 'datafile.seoul.go.kr'
            or parsed.username is not None or parsed.password is not None
            or parsed.port not in (None, 443) or parsed.fragment
            or parsed.path != '/bigfile/iot/inf/nio_download.do'
            or sorted(parse_qsl(parsed.query)) not in [
                sorted(parse_qsl(urlsplit(item['url']).query)) for item in DOWNLOADS.values()]):
        raise ValueError('BOUNDARY_DOWNLOAD_URL_REJECTED')


class OfficialRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        official_url(newurl)
        return super().redirect_request(request, response, code, message, headers, newurl)


def download_verified(url, size, digest, *, opener=None):
    official_url(url)
    if type(size) is not int or not 0 < size < 5_000_000 or not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('BOUNDARY_DOWNLOAD_IDENTITY_INVALID')
    opener = build_opener(OfficialRedirects()).open if opener is None else opener
    with opener(Request(url), timeout=30) as response:
        data = response.read(size + 1)
    if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('BOUNDARY_ARCHIVE_CHANGED')
    return data


def prepare_boundaries(folder, *, downloader=download_verified):
    folder = Path(folder)
    if folder.is_symlink():
        raise ValueError('BOUNDARY_DIRECTORY_SYMLINK_REJECTED')
    names = [kind + '.zip' for kind in DOWNLOADS] + list(REPORTS)
    for name in names:
        path = folder / name
        if path.exists() or path.is_symlink():
            raise FileExistsError('BOUNDARY_INPUT_ALREADY_EXISTS: ' + name)
    files = report_bytes()
    for kind, item in DOWNLOADS.items():
        files[kind + '.zip'] = downloader(item['url'], item['bytes'], item['sha256'])
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, data in files.items():
        fd = os.open(folder / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
    return {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
