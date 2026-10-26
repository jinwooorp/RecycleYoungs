"""Descriptive audit only; no database, secrets or score publication."""
import importlib
import unittest

class DecisionAuditTests(unittest.TestCase):
    def module(self):
        try:return importlib.import_module('app.decision_audit')
        except ModuleNotFoundError:self.fail('reproducible decision indicator audit is missing')
    def test_exact_ties_and_large_values_do_not_pass_through_float(self):
        m=self.module();r=m.percentiles({'a':9007199254740993,'b':9007199254740993,'c':9007199254740994})
        self.assertEqual(str(r['a']),'25');self.assertEqual(str(r['c']),'100')
    def test_missing_zero_and_first_period_are_separate_and_no_total_is_published(self):
        m=self.module()
        rows=[('20251',f'11{i:06}',str(i+1)) for i in range(35)]
        rows += [('20252',f'11{i:06}',str((i+1)*2)) for i in range(33)]
        rows += [('20252','11000033',None),('20252','11000034','0')]
        result=m.audit(rows)
        self.assertFalse(result['overall_publishable']);self.assertIsNone(result['overall_score'])
        self.assertIsNone(result['periods'][0]['growth'])
        self.assertEqual(result['periods'][1]['source_null'],1)
        self.assertEqual(result['periods'][1]['zero'],1)
        self.assertEqual(result['periods'][1]['growth']['valid'],34)
        self.assertTrue(result['periods'][1]['weight_sensitivity']['diagnostic_only'])
    def test_duplicate_dong_and_negative_values_are_not_silently_fixed(self):
        m=self.module()
        with self.assertRaisesRegex(ValueError,'AUDIT_DUPLICATE_KEY'):m.audit([('20251','11110515','1'),('20251','11110515','2')])
        result=m.audit([('20251','11110515','-1')])
        self.assertEqual(result['periods'][0]['invalid_negative'],1)
        self.assertEqual(result['periods'][0]['valid'],0)

if __name__=='__main__':unittest.main()
