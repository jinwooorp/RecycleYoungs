package com.example.backend.admindong;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
public class DecisionEvidenceService {
    @io.swagger.v3.oas.annotations.media.Schema(name="DecisionOverall")
    public record Overall(String status,@io.swagger.v3.oas.annotations.media.Schema(types={"integer","null"},description="현행 계약에서 항상 null") Integer value,Map<String,Integer> weights,List<String> reasonCodes) {}
    @io.swagger.v3.oas.annotations.media.Schema(name="DecisionReference")
    public record Reference(String dongCode,String status,ContextResponses.Context context,String reason) {}
    @io.swagger.v3.oas.annotations.media.Schema(name="DecisionEvidenceResponse")
    public record Response(String modelVersion,ApiResponses.Quarter quarter,String spatialUnit,String industryCode,
        ConsumptionScoreService.Response consumption,ChangeScoreService.Response change,List<Reference> references,
        Overall overall,DataPublication.Metadata metadata) {}
    private final ConsumptionScoreService consumption;
    private final ChangeScoreService change;
    private final AdminDongContextService context;
    public DecisionEvidenceService(ConsumptionScoreService consumption,ChangeScoreService change,AdminDongContextService context) {
        this.consumption=consumption;this.change=change;this.context=context;
    }
    public Response evidence(DecisionQuery query) {
        var volume=consumption.scores(query.codes(),query.quarterCode(),query.dataVersion());
        var movement=change.scores(query.codes(),query.quarterCode(),query.dataVersion());
        if (!volume.quarter().code().equals(query.quarterCode()) || !movement.quarter().code().equals(query.quarterCode())
            || !java.util.Objects.equals(volume.metadata(),movement.metadata())) throw new DataIntegrityException();
        var references=query.codes().stream().map(code->{
            try {
                var value=context.contextIfPresent(new QueryValidator.StatsQuery(code,"CAFE",query.quarterCode(),query.dataVersion()));
                if (value==null) return new Reference(code,"UNAVAILABLE",null,"NO_ROW");
                if (!java.util.Objects.equals(value.metadata(),volume.metadata())) throw new DataIntegrityException();
                return new Reference(code,"AVAILABLE",value,null);
            } catch (ContextUnavailableException ex) { return new Reference(code,"UNAVAILABLE",null,"CONTEXT_UNAVAILABLE"); }
        }).toList();
        // Both existing relative scores use cafe transactions. They describe
        // different questions but are not independent evidence for a total.
        var overall=new Overall("UNAVAILABLE",null,Map.of(),List.of("SHARED_TRANSACTION_SOURCE",
            "REFERENCE_ONLY_CONTEXT","ACCESSIBILITY_SPATIAL_UNVERIFIED","COST_REPRESENTATIVENESS_UNVERIFIED",
            "CONSUMPTION_WITHHELD","CROSS_DOMAIN_CALIBRATION_UNAVAILABLE"));
        return new Response("decision-evidence-v1",volume.quarter(),"ADMINISTRATIVE_DONG","CAFE",volume,movement,references,overall,volume.metadata());
    }
}
