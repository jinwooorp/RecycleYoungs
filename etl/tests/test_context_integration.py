"""Resource/migration guards are inert without explicit fresh target execution."""
import importlib
import unittest


class ContextIntegrationTests(unittest.TestCase):
    def test_budget_rejects_insufficient_memory_storage_and_unbounded_rows(self):
        m = importlib.import_module('api_integration')
        counts = {'seoul-stores':800000,'seoul-sales':400000,'semas-stores':25000}
        budget = m.context_resource_budget(8319504384,counts,46508,700*1024**3)
        self.assertLess(budget['database_peak_bytes'],2*1024**3)
        self.assertEqual(budget['tmpfs_bytes'],2*1024**3)
        for memory,rows,context,free in [(2*1024**3,counts,46508,700*1024**3),
            (8319504384,counts,46508,1024),(8319504384,counts|{'seoul-sales':4000000},46508,700*1024**3)]:
            with self.assertRaises(ValueError):m.context_resource_budget(memory,rows,context,free)

    def test_fresh_and_upgrade_migration_receipts_validate_versions_and_checksums(self):
        m=importlib.import_module('api_integration')
        for scenario,versions in [('fresh',['1','2','3','4','5']),('upgrade',['5'])]:
            value = dict(operation='migrate',flywayVersion='12.4.0',migrationsExecuted=len(versions),
                migrations=[dict(version=v,filepath='V'+v+'__synthetic.sql') for v in versions])
            m.validate_context_migration(value,scenario)
            value['migrationsExecuted']=4
            with self.assertRaises(ValueError):m.validate_context_migration(value,scenario)
