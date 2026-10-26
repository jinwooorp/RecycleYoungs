"""Reproducible descriptive audit, separate from published indicator models.

Weight alternatives are diagnostics over two existing transaction indicators,
not a proposed all-domain score. No individual composite or total is published.
Original integers and growth comparisons use exact integer/Fraction arithmetic.
"""
from fractions import Fraction
import math
import re
from statistics import correlation,median


def require(ok,code):
    if not ok:raise ValueError(code)


def percentiles(values):
    ordered=sorted(values.values());size=len(ordered)
    if size<2:return {}
    from bisect import bisect_left,bisect_right
    return {key:Fraction(100*(bisect_left(ordered,value)+bisect_right(ordered,value)-1),2*(size-1)) for key,value in values.items()}


def rounded_score(value):
    # The public Java percentile rounds nonnegative values HALF_UP to an integer.
    return (2*value.numerator+value.denominator)//(2*value.denominator)


def rank_correlation(a,b):
    keys=sorted(set(a)&set(b))
    if len(keys)<3:return None
    x=percentiles({k:a[k] for k in keys});y=percentiles({k:b[k] for k in keys})
    if len(set(x.values()))<2 or len(set(y.values()))<2:return None
    # Only bounded ranks, never source counts, enter floating-point statistics.
    return format(correlation([float(x[k]) for k in keys],[float(y[k]) for k in keys]),'.6f')


def weight_sensitivity(volume,growth):
    keys=sorted(set(volume)&set(growth))
    if len(keys)<30:return None
    a={k:rounded_score(v) for k,v in percentiles(volume).items()}
    b={k:rounded_score(v) for k,v in percentiles(growth).items()}
    ranks={w:percentiles({k:Fraction(w*a[k]+(100-w)*b[k],100) for k in keys}) for w in [0,25,50,75,100]}
    spans=[max(r[k] for r in ranks.values())-min(r[k] for r in ranks.values()) for k in keys]
    anchor={k for k,v in ranks[50].items() if v>=90}
    return dict(diagnostic_only=True,published_composites=False,paired_cohort=len(keys),
        transaction_scale_weights_percent=[0,25,50,75,100],max_rank_percentile_span=format(float(max(spans)),'.4f'),
        median_rank_percentile_span=format(float(median(spans)),'.4f'),
        top_decile_membership_changes_from_equal_weights={str(w):len(anchor^{k for k,v in r.items() if v>=90}) for w,r in ranks.items()})


def previous(period):
    return str(int(period[:4])-1)+'4' if period[-1]=='1' else period[:4]+str(int(period[-1])-1)


def audit(rows):
    periods={}
    for period,code,value in rows:
        period=str(period)
        require(bool(re.fullmatch('[1-9][0-9]{3}[1-4]',period)) and bool(re.fullmatch('11[0-9]{6}',code)),'AUDIT_SCOPE_REJECTED')
        current=periods.setdefault(period,{})
        require(code not in current,'AUDIT_DUPLICATE_KEY')
        require(value is None or isinstance(value,str) and bool(re.fullmatch('-?(0|[1-9][0-9]*)',value)),'AUDIT_INTEGER_REQUIRED')
        parsed=None if value is None else int(value)
        require(parsed is None or -9223372036854775808<=parsed<=9223372036854775807,'AUDIT_BIGINT_RANGE')
        current[code]=parsed
    result=[]
    for period,current in sorted(periods.items()):
        valid={k:v for k,v in current.items() if v is not None and v>=0};ordered=sorted(valid.values())
        quantiles={str(q):str(ordered[max(0,math.ceil(q*len(ordered)/100)-1)]) if ordered else None for q in [10,50,90,99]}
        before=periods.get(previous(period));growth=None;sensitivity=None;rho=None;stability=None
        if before is not None:
            eligible={k:Fraction(v-before[k],before[k]) for k,v in valid.items() if before.get(k) is not None and before[k]>0}
            growth=dict(valid=len(eligible),missing_previous=sum(k not in before for k in current),
                null_previous=sum(k in before and before[k] is None for k in current),zero_previous=sum(before.get(k)==0 for k in current),
                invalid_previous=sum(before.get(k) is not None and before[k]<0 for k in current),minimum_cohort_pass=len(eligible)>=30)
            sensitivity=weight_sensitivity(valid,eligible);rho=rank_correlation(valid,eligible)
            stability=rank_correlation(valid,{k:v for k,v in before.items() if v is not None and v>=0})
        result.append(dict(quarter=period,reported_rows=len(current),valid=len(valid),source_null=sum(v is None for v in current.values()),
            invalid_negative=sum(v is not None and v<0 for v in current.values()),zero=sum(v==0 for v in current.values()),
            minimum_cohort_pass=len(valid)>=30,nearest_rank_transaction_quantiles=quantiles,growth=growth,
            scale_growth_rank_correlation=rho,previous_period_scale_rank_correlation=stability,weight_sensitivity=sensitivity))
    return dict(audit_model='decision-indicator-audit-v1',minimum_cohort=30,periods=result,
        overall_publishable=False,overall_score=None,limitations=['SHARED_TRANSACTION_SOURCE','NOT_CAUSAL_OR_PREDICTIVE',
            'CONTEXT_SPATIAL_AND_TEMPORAL_UNVERIFIED','ACCESSIBILITY_SPATIAL_UNVERIFIED','COST_REPRESENTATIVENESS_UNVERIFIED',
            'CONSUMPTION_WITHHELD','WEIGHTS_DIAGNOSTIC_ONLY'])
