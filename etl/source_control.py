"""Inert source control: inspect only, plus an in-memory SIMULATED_ONLY model.

No backend, connector, executor, persisted state or source mutation permission
exists here. CLI flags/config/environment cannot enable execution. The model
checks caller-supplied claims, not measured DB/Git/file identities. Its approval
and HMAC evidence are test fixtures, never human approval or actual audit PASS.
HMAC detects changed/cross-instance tokens; it is not a security boundary
against code controlling this Python process. A fresh instance never resumes
old evidence. Durable crash detection/provenance still require future design.

Future measured V2/V3 verification must call source_validation.validate_preservation
on complete audits before any real gate. This module deliberately does not wire
that validator to the synthetic model or collect evidence. Timeout/process exit
cannot establish rollback; actual DB state remains UNMEASURED throughout.
Use ``python -B etl/source_control.py`` for bytecode-free inspect execution.
Ordinary Python may create import caches; global bytecode settings are not changed.
"""
import argparse
from copy import deepcopy
import hashlib
import hmac
import json
import math
import re
import secrets
import time

if __package__:
    from .control import STAGES, digest, encode
else:
    from control import STAGES, digest, encode

KIND = 'SIMULATED_ONLY'
SCOPE = ['V2', 'V3', 'ADMIN_POLYGON', 'COMMERCIAL_POLYGON']
MAX_TTL = 1800
PLAN_KEYS = {'run_id', 'git_head', 'target', 'scope', 'hashes', 'validation_policy_hash'}
TARGET_KEYS = {'database', 'user', 'system_identifier', 'container_id', 'container_name',
               'image_id', 'network_id', 'host', 'port', 'data_directory', 'volume_name'}
APPROVAL_KEYS = {'kind', 'run_id', 'plan_hash', 'target', 'scope', 'issued_at', 'expires_at',
                 'user_confirmation', 'latest_verification', 'backup_recovery'}
TOKEN_KEYS = {'kind', 'run_id', 'plan_hash', 'approval_hash', 'stage', 'sequence',
              'previous', 'outcome', 'issued_at', 'expires_at', 'evidence_refs', 'seal'}


class SourceControlError(RuntimeError):
    def __init__(self, category, message):
        super().__init__(message)
        self.category = category


def _reject(category, message):
    raise SourceControlError(category, message)


def _require(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        _reject('INSUFFICIENT_EVIDENCE', 'required contract fields absent or unknown')


def _json_copy(value):
    def check(v):
        if isinstance(v, dict):
            if any(not isinstance(k, str) for k in v):
                _reject('INSUFFICIENT_EVIDENCE', 'non-string contract key')
            for item in v.values(): check(item)
        elif isinstance(v, list):
            for item in v: check(item)
        elif v is not None and type(v) not in (str, int, float, bool):
            _reject('INSUFFICIENT_EVIDENCE', 'non-JSON contract value')
    try:
        check(value)
        json.dumps(value, allow_nan=False)
        encode(value)  # Reject unpaired surrogates before hashing or sealing.
        return deepcopy(value)
    except (TypeError, ValueError, OverflowError, RecursionError):
        _reject('INSUFFICIENT_EVIDENCE', 'malformed contract')


def _text(value):
    if not isinstance(value, str) or not value.strip():
        _reject('INSUFFICIENT_EVIDENCE', 'required text absent')


def _hash(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
        _reject('INSUFFICIENT_EVIDENCE', 'required SHA-256 absent')


def _timestamp(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        _reject('UNKNOWN', 'clock or evidence timestamp indeterminate')


def _same(actual, expected):
    if encode(actual) != encode(expected):
        _reject('APPROVAL_MISMATCH', 'simulation approval does not cover plan')


def _contract(plan, approval, now, ttl):
    _require(plan, PLAN_KEYS)
    _text(plan['run_id'])
    if not isinstance(plan['git_head'], str) or not re.fullmatch('[0-9a-f]{40}', plan['git_head']):
        _reject('INSUFFICIENT_EVIDENCE', 'required Git commit hash absent')
    _require(plan['target'], TARGET_KEYS)
    for key in TARGET_KEYS - {'port', 'container_id', 'network_id', 'image_id'}:
        _text(plan['target'][key])
    for key in ('container_id', 'network_id'): _hash(plan['target'][key])
    image = plan['target']['image_id']
    if not isinstance(image, str) or not image.startswith('sha256:'):
        _reject('INSUFFICIENT_EVIDENCE', 'immutable image identity absent')
    _hash(image[7:])
    port = plan['target']['port']
    if type(port) is not int or not 1 <= port <= 65535:
        _reject('INSUFFICIENT_EVIDENCE', 'target port absent or invalid')
    _same(plan['scope'], SCOPE)
    _require(plan['hashes'], ('V2_SQL', 'V3_SQL', 'ADMIN_INPUT', 'COMMERCIAL_INPUT'))
    for value in plan['hashes'].values(): _hash(value)
    _hash(plan['validation_policy_hash'])
    _require(approval, APPROVAL_KEYS)
    _same(approval['kind'], KIND)
    for key in ('run_id', 'target', 'scope'): _same(approval[key], plan[key])
    _same(approval['plan_hash'], digest(plan))
    start, end = approval['issued_at'], approval['expires_at']
    _timestamp(start); _timestamp(end)
    if start > now: _reject('FUTURE_EVIDENCE', 'approval is in the future')
    if end <= now: _reject('STALE', 'simulation approval expired')
    if end <= start or end - start > ttl:
        _reject('EXECUTION_REJECTED', 'approval lifetime exceeds model policy')
    user = approval['user_confirmation']
    _require(user, ('kind', 'actor', 'target_hash', 'scope'))
    _same(user['kind'], KIND); _text(user['actor'])
    _same(user['target_hash'], digest(plan['target'])); _same(user['scope'], plan['scope'])
    verification, backup = approval['latest_verification'], approval['backup_recovery']
    _require(verification, ('kind', 'plan_hash', 'snapshot_id', 'evidence_hash', 'observed_at'))
    _require(backup, ('kind', 'snapshot_id', 'backup_hash', 'restore_hash', 'state', 'observed_at'))
    _same(verification['kind'], KIND); _same(backup['kind'], KIND)
    _same(verification['plan_hash'], digest(plan)); _same(backup['state'], 'VERIFIED')
    _text(verification['snapshot_id']); _same(backup['snapshot_id'], verification['snapshot_id'])
    _hash(verification['evidence_hash']); _hash(backup['backup_hash']); _hash(backup['restore_hash'])
    for proof in (verification, backup):
        _timestamp(proof['observed_at'])
        if proof['observed_at'] > now: _reject('FUTURE_EVIDENCE', 'proof is in the future')
        if now - proof['observed_at'] >= ttl: _reject('STALE', 'proof expired')


def inspect():
    """Return an inert report without reading files, configuration or identity."""
    return {'status': 'NOT_READY', 'mode': 'DISABLED_INSPECT', 'execution_enabled': False,
            'stages': list(STAGES), 'evidence_kind': KIND, 'db_state': 'UNMEASURED',
            'rollback_confirmed': False,
            'preservation_validator': {'module': 'source_validation',
                'function': 'validate_preservation', 'wired': False}}


def deny_execution(approval=None):
    """Unconditional boundary; no approval value can open an execution path."""
    _reject('EXECUTION_REJECTED', 'source execution is not implemented')


class SourceSimulation:
    """Only a pure state/evidence model; never an executor or human authorizer.

    Plan/approval are JSON-like claims with the fields validated by _contract.
    Every transition requires their current copies to detect caller-observed
    changes. This does not measure the real target, Git, inputs or provenance.
    Evidence is issued here only to test transitions, not to assert DB success.
    No resume state, backend, key or execution callback is accepted.
    Accepted count/digests are anchored separately from the mutable ledger and
    updated only on successful admission. This is same-process consistency,
    not external security, human/DB provenance or durable crash recovery.
    """
    def __init__(self, plan, approval, *, clock=time.time, ttl=MAX_TTL):
        self._state = 'SIMULATING'; self.stop_category = None
        self._records = []; self._accepted_digests = (); self._clock = clock
        if type(ttl) not in (int, float) or not math.isfinite(ttl) or not 0 < ttl <= MAX_TTL:
            _reject('EXECUTION_REJECTED', 'invalid model TTL')
        self._ttl = ttl
        self._plan, self._approval = _json_copy(plan), _json_copy(approval)
        self._start = self._time(); self._last = self._start
        _contract(self._plan, self._approval, self._start, ttl)
        self._plan_hash, self._approval_hash = digest(self._plan), digest(self._approval)
        self._deadline = min(self._start + ttl, self._approval['expires_at'])
        self._key = secrets.token_bytes(32)

    @property
    def state(self):
        if self._state != 'STOP':
            try:
                self._guard()
            except SourceControlError:
                pass
        return self._state

    @property
    def records(self):
        return tuple(deepcopy(self._records))

    @property
    def simulated_complete(self):
        if self._state == 'STOP': return False
        try:
            self._guard()
        except SourceControlError:
            return False
        return len(self._accepted_digests) == len(STAGES)

    def inspect(self):
        report = inspect()
        report.update(simulation_state=self.state, stop_category=self.stop_category,
                      simulated_steps=len(self._accepted_digests) if type(self._accepted_digests) is tuple else None)
        return report

    def _halt(self, category, message):
        if self._state == 'STOP':
            _reject('TERMINAL_STOP', 'stopped simulation cannot continue')
        self._state = 'STOP'; self.stop_category = category
        _reject(category, message)

    def _time(self):
        try:
            now = self._clock(); _timestamp(now)
            return now
        except Exception:
            self._halt('UNKNOWN', 'clock unavailable; rollback not established')

    def _seal(self, body):
        return hmac.new(self._key, encode(body), hashlib.sha256).hexdigest()

    def _verify_seal(self, record):
        if type(record) is not dict or set(record) != TOKEN_KEYS:
            self._halt('TAMPERED_EVIDENCE', 'synthetic evidence structure differs')
        try:
            record = _json_copy(record)
        except SourceControlError:
            record = None
        # Raise outside the handler so rejected input exceptions are not exposed.
        if record is None:
            self._halt('TAMPERED_EVIDENCE', 'synthetic evidence encoding differs')
        seal = record['seal']
        body = {k: v for k, v in record.items() if k != 'seal'}
        if not isinstance(seal, str) or not re.fullmatch('[0-9a-f]{64}', seal) or not hmac.compare_digest(seal, self._seal(body)):
            self._halt('TAMPERED_EVIDENCE', 'synthetic evidence seal differs')

    def _guard(self):
        if self._state == 'STOP': _reject('TERMINAL_STOP', 'stopped simulation cannot continue')
        now = self._time()
        if now < self._last: self._halt('FUTURE_EVIDENCE', 'clock moved backwards')
        if now >= self._deadline: self._halt('STALE', 'simulation expired')
        if (type(self._records) is not list or type(self._accepted_digests) is not tuple
                or len(self._accepted_digests) > len(STAGES)
                or len(self._records) != len(self._accepted_digests)):
            self._halt('TAMPERED_EVIDENCE', 'stored synthetic ledger structure differs')
        expected_state = 'SIMULATION_COMPLETE' if len(self._accepted_digests) == len(STAGES) else 'SIMULATING'
        if self._state != expected_state:
            self._halt('TAMPERED_EVIDENCE', 'simulation state differs from accepted count')
        try:
            _contract(self._plan, self._approval, now, self._ttl)
            previous = None
            for index, record in enumerate(self._records):
                self._verify_seal(record)
                if digest(record) != self._accepted_digests[index]:
                    self._halt('TAMPERED_EVIDENCE', 'accepted synthetic record was replaced')
                if record['stage'] != STAGES[index] or record['outcome'] != 'PASS' or record['previous'] != previous:
                    self._halt('TAMPERED_EVIDENCE', 'stored synthetic chain differs')
                previous = digest(record)
        except SourceControlError as exc:
            if self._state == 'STOP': raise
            self._halt(exc.category, str(exc))
        self._last = now
        return now

    def synthetic_evidence(self, stage, outcome, *, evidence_refs):
        now = self._guard()
        if stage not in STAGES or outcome not in ('PASS', 'FAIL', 'UNKNOWN', 'INSUFFICIENT_EVIDENCE'):
            self._halt('ORDER_REJECTED', 'unsupported synthetic stage/outcome')
        try:
            refs = _json_copy(evidence_refs)
        except SourceControlError as exc:
            self._halt(exc.category, str(exc))
        body = {'kind': KIND, 'run_id': self._plan['run_id'], 'plan_hash': self._plan_hash,
                'approval_hash': self._approval_hash, 'stage': stage, 'sequence': STAGES.index(stage),
                'previous': digest(self._records[-1]) if self._records else None,
                'outcome': outcome, 'issued_at': now, 'expires_at': self._deadline,
                'evidence_refs': refs}
        return body | {'seal': self._seal(body)}

    def advance(self, evidence, *, current_plan, current_approval):
        """Advance a synthetic stage only; never dispatch work or accept real PASS."""
        now = self._guard()
        try:
            if digest(_json_copy(current_plan)) != self._plan_hash:
                self._halt('CONTEXT_CHANGED', 'plan/target/inputs/Git/policy changed')
            if digest(_json_copy(current_approval)) != self._approval_hash:
                self._halt('APPROVAL_MISMATCH', 'approval scope or evidence changed')
            record = _json_copy(evidence); _require(record, TOKEN_KEYS)
            if record['run_id'] != self._plan['run_id']:
                self._halt('CROSS_RUN_EVIDENCE', 'evidence belongs to another run')
            self._verify_seal(record)
            if record['kind'] != KIND or record['plan_hash'] != self._plan_hash or record['approval_hash'] != self._approval_hash:
                self._halt('TAMPERED_EVIDENCE', 'synthetic context differs')
            index = len(self._accepted_digests)
            if index >= len(STAGES) or record['stage'] != STAGES[index] or record['sequence'] != index:
                self._halt('ORDER_REJECTED', 'stage omitted, reordered or repeated')
            previous = digest(self._records[-1]) if self._records else None
            if record['previous'] != previous:
                self._halt('TAMPERED_EVIDENCE', 'synthetic chain parent differs')
            _timestamp(record['issued_at']); _timestamp(record['expires_at'])
            if record['issued_at'] > now: self._halt('FUTURE_EVIDENCE', 'future evidence')
            if record['issued_at'] < self._start or now >= record['expires_at'] or record['expires_at'] != self._deadline:
                self._halt('STALE', 'synthetic evidence expired')
            outcome = record['outcome']
            if outcome != 'PASS':
                category = {'FAIL': 'VERIFICATION_FAILED', 'UNKNOWN': 'UNKNOWN',
                            'INSUFFICIENT_EVIDENCE': 'INSUFFICIENT_EVIDENCE'}.get(outcome, 'UNKNOWN')
                self._halt(category, 'synthetic verification did not pass; rollback not established')
            refs = record['evidence_refs']
            if not isinstance(refs, dict) or not refs:
                self._halt('INSUFFICIENT_EVIDENCE', 'synthetic reference hashes absent')
            for value in refs.values(): _hash(value)
            accepted = self._accepted_digests + (digest(record),)
            self._records.append(record)
            self._accepted_digests = accepted
            if len(self._accepted_digests) == len(STAGES): self._state = 'SIMULATION_COMPLETE'
            return deepcopy(record)
        except SourceControlError as exc:
            if self._state == 'STOP': raise
            self._halt(exc.category, str(exc))

    def request_execution(self, approval=None):
        self._halt('EXECUTION_REJECTED', 'source execution is not implemented')

    def resume(self):
        self._halt('TERMINAL_STOP', 'automatic resume is not supported')

    def stop_unknown(self, cause):
        self._halt('UNKNOWN', 'process interruption/timeout does not establish rollback')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Disabled source-safe runner: inspect only', allow_abbrev=False)
    parser.add_argument('--inspect', action='store_true', help='print inert status (default)')
    parser.parse_args(argv)
    print(json.dumps(inspect(), sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
