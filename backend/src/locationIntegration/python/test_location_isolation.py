"""No Docker calls: regression tests for the disposable controller's safety gates."""
import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


def controller(optimize=0):
    path = Path(__file__).with_name('location_isolation.py')
    namespace = {'__file__': str(path), '__name__': 'isolated_controller_test'}
    with patch.object(sys, 'stdin', io.StringIO('')), contextlib.redirect_stdout(io.StringIO()):
        exec(compile(path.read_text(), str(path), 'exec', optimize=optimize), namespace)
    return namespace


def network(value, members=None):
    return {'Id': value['network_id'], 'Name': value['NETWORK'], 'Internal': True,
            'Labels': {value['LABEL']: value['OWNER']}, 'Containers': members or {}}


class IsolationControllerTests(unittest.TestCase):
    def test_unknown_runner_entrypoint_rejected_before_docker(self):
        value = controller()
        value['docker'] = Mock()
        with self.assertRaisesRegex(RuntimeError, 'entrypoint'):
            value['start_runner']('unapproved.Executor')
        value['docker'].assert_not_called()

    def test_optimized_execution_preserves_ownership_guard(self):
        value = controller(optimize=1)
        value['network_id'] = 'a' * 64
        wrong = network(value)
        wrong['Labels'][value['LABEL']] = 'unowned'
        value['docker'] = Mock(return_value=json.dumps([wrong]))
        with self.assertRaisesRegex(RuntimeError, 'ownership'):
            value['inspect_network']()

    def test_no_resources_cleanup_does_not_call_docker(self):
        value = controller()
        value['docker'] = Mock()
        self.assertEqual({}, value['cleanup']()['ownedResources'])
        value['docker'].assert_not_called()

    def test_partial_prepare_cleans_only_owned_empty_network(self):
        value = controller()
        value['network_id'] = 'a' * 64
        value['docker'] = Mock(side_effect=[json.dumps([network(value)]), 'removed'])
        result = value['cleanup']()
        self.assertEqual([], result['ownedResources']['containers'])
        self.assertEqual([('network', 'inspect', 'a' * 64), ('network', 'rm', 'a' * 64)],
                         [call.args for call in value['docker'].call_args_list])

    def test_partial_prepare_with_unowned_member_stops_without_mutation(self):
        value = controller()
        value['network_id'] = 'a' * 64
        value['docker'] = Mock(return_value=json.dumps([network(value, {'foreign': {}})]))
        with self.assertRaisesRegex(RuntimeError, 'unowned'):
            value['cleanup']()
        self.assertEqual(1, value['docker'].call_count)

    def test_full_cleanup_rejects_bad_identity_before_mutation(self):
        value = controller()
        value['network_id'], value['db_id'] = 'a' * 64, 'b' * 64
        value['verify_db'] = Mock(side_effect=RuntimeError('identity differs'))
        value['docker'] = Mock()
        with self.assertRaisesRegex(RuntimeError, 'identity differs'):
            value['cleanup']()
        value['docker'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
