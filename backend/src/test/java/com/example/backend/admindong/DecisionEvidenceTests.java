package com.example.backend.admindong;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.util.LinkedMultiValueMap;

class DecisionEvidenceTests {
    @Test void normalContextUnavailabilityDoesNotMarkASharedTransactionForRollback() {
        var lookup=mock(AdminDongRepository.class);var repo=mock(AdminDongContextRepository.class);
        when(lookup.lookup()).thenReturn(new AdminDongRepository.Lookup(List.of(new ApiResponses.NamedCode("11110515","청운효자동")),
            List.of(new AdminDongRepository.Industry(1,"CAFE","카페","CS100010",true)),List.of(new ApiResponses.Quarter("20251","2025년 1분기"))));
        var manager=mock(org.springframework.transaction.PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new org.springframework.transaction.support.SimpleTransactionStatus());
        var factory=new org.springframework.aop.framework.ProxyFactory(new AdminDongContextService(lookup,repo));
        factory.addAdvice(new org.springframework.transaction.interceptor.TransactionInterceptor(manager,
            new org.springframework.transaction.annotation.AnnotationTransactionAttributeSource()));
        var proxied=(AdminDongContextService)factory.getProxy();
        assertThatThrownBy(()->proxied.context(new QueryValidator.StatsQuery("11110515","CAFE","20251","legacy-unversioned")))
            .isInstanceOf(ContextUnavailableException.class);
        verify(manager,never()).rollback(any());
        verify(manager).commit(any());
    }
    @Test void requiresOneCommonVersionAndAtMostThreeDistinctCandidates() {
        var params=new LinkedMultiValueMap<String,String>();
        params.setAll(Map.of("dongCodes","11110515,11110530","quarterCode","20251","dataVersion","a".repeat(64)));
        assertThat(DecisionQuery.parse(params).codes()).hasSize(2);
        params.set("dongCodes","11110515,11110515");
        assertThatThrownBy(()->DecisionQuery.parse(params)).isInstanceOf(InvalidQueryException.class);
        params.set("dongCodes","11110515");params.remove("dataVersion");
        assertThatThrownBy(()->DecisionQuery.parse(params)).isInstanceOf(InvalidQueryException.class);
    }
    @Test void incompleteDomainsNeverBecomeAReweightedTotal() {
        var consumption=mock(ConsumptionScoreService.class);var change=mock(ChangeScoreService.class);
        var context=mock(AdminDongContextService.class);
        var version="a".repeat(64);var codes=List.of("11110515");
        var quarter=new ApiResponses.Quarter("20251","2025년 1분기");
        var metadata=new DataPublication.Metadata(version,"2026-10-24T00:00:00Z","202606","I21201","UNVERIFIED");
        when(consumption.scores(codes,"20251",version)).thenReturn(new ConsumptionScoreService.Response(quarter,"model","b".repeat(64),425,30,"source","UNVERIFIED",List.of(),metadata));
        when(change.scores(codes,"20251",version)).thenReturn(new ChangeScoreService.Response(quarter,"20244","model","c".repeat(64),424,30,"source","UNVERIFIED",List.of(),metadata));
        when(context.contextIfPresent(any())).thenThrow(new ContextUnavailableException());
        var result=new DecisionEvidenceService(consumption,change,context).evidence(new DecisionQuery(codes,"20251",version));
        assertThat(result.overall().value()).isNull();
        assertThat(result.overall().status()).isEqualTo("UNAVAILABLE");
        assertThat(result.overall().weights()).isEmpty();
        assertThat(result.overall().reasonCodes()).contains("SHARED_TRANSACTION_SOURCE","COST_REPRESENTATIVENESS_UNVERIFIED","CONSUMPTION_WITHHELD");
        assertThat(result.references().getFirst().status()).isEqualTo("UNAVAILABLE");
        assertThat(result.references().getFirst().reason()).isEqualTo("CONTEXT_UNAVAILABLE");
        doReturn(null).when(context).contextIfPresent(any());
        assertThat(new DecisionEvidenceService(consumption,change,context).evidence(new DecisionQuery(codes,"20251",version))
            .references().getFirst().reason()).isEqualTo("NO_ROW");
    }
}
