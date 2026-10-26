"""Operator legacy-catalog filtering stays narrow; no DB/Docker access."""
import unittest
import json
import copy
from dev_reference_operator import new_catalog_row

class ReferenceOperatorTests(unittest.TestCase):
    def test_flyway_init_sql_keeps_literal_spaces_in_the_configuration_file(self):
        import dev_reference_operator as operator
        self.assertTrue(callable(getattr(operator,'flyway_configuration',None)))
        text=operator.flyway_configuration({'flyway.initSql':"SET lock_timeout='5s'; SELECT 1",'flyway.user':'ry_api_owner'})
        self.assertIn("flyway.initSql=SET lock_timeout='5s'; SELECT 1\n",text)
        self.assertNotIn('SET\\ ',text)
        with self.assertRaises(ValueError):operator.flyway_configuration({'flyway.user':'owner\nflyway.cleanDisabled=false'})
    def test_only_the_exact_new_relation_types_and_guard_functions_are_filtered(self):
        self.assertTrue(new_catalog_row('columns',('public','api_reference_records_pkey')))
        self.assertTrue(new_catalog_row('types',('public','_api_reference_records')))
        self.assertTrue(new_catalog_row('functions',('public','guard_api_reference_records()')))
        for kind,row in [('columns',('public','api_context_records')),('functions',('public','reject_api_truncate()')),
                         ('functions',('public','guard_api_reference_records(integer)')),('types',('public','api_reference_records_unexpected'))]:
            self.assertFalse(new_catalog_row(kind,row))
    def test_effective_acl_filters_the_relation_column_not_the_role_column(self):
        self.assertTrue(new_catalog_row('effective_acl',('api_writer','public','api_reference_current',True)))
        self.assertFalse(new_catalog_row('effective_acl',('api_reference_current','public','api_current_release',True)))

    def test_every_original_history_column_is_preserved(self):
        import dev_reference_operator as operator
        from api_snapshot import row_digest
        self.assertTrue(callable(getattr(operator,'verify_old_history',None)))
        row=dict(installed_rank=1,version='1',script='V1__initial.sql',checksum=123,success=True,
            installed_by='original_owner',installed_on='2026-01-01T00:00:00Z',execution_time=12,description='initial',type='SQL')
        encoded=lambda r:json.dumps(r,sort_keys=True)
        expected=row_digest([encoded(row)]);operator.verify_old_history(expected,[encoded(row)])
        for field,value in [('installed_by','other'),('installed_on','2026-02-01T00:00:00Z'),('execution_time',99),('description','changed'),('type','JDBC')]:
            changed=copy.deepcopy(row);changed[field]=value
            with self.assertRaisesRegex(ValueError,'REFERENCE_TRANSITION_LEGACY_HISTORY_CHANGED'):
                operator.verify_old_history(expected,[encoded(changed)])

if __name__=='__main__':unittest.main()
