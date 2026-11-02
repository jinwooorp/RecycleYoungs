package kr.ac.recycleyoungs.score;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Objects;
import java.util.Set;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 두 독립 단위의 아티팩트를 한 파일로 게시한다. 승인 manifest가 아니며 제품 JAR에서 제외한다. */
record ScoreSnapshotBundle(ScoreSnapshotArtifact district, ScoreSnapshotArtifact dong) {
  private static final String VERSION = "score-snapshot-bundle-v1";
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  ScoreSnapshotBundle {
    Objects.requireNonNull(district);
    Objects.requireNonNull(dong);
    district.replay();
    dong.replay();
    var a = district.payload();
    var b = dong.payload();
    if (a.input().unit() != ScoreCalculation.RegionUnit.DISTRICT
        || b.input().unit() != ScoreCalculation.RegionUnit.DONG
        || !a.snapshotSchemaVersion().equals(b.snapshotSchemaVersion())
        || !a.algorithmVersion().equals(b.algorithmVersion())
        || !a.input().quarterCode().equals(b.input().quarterCode())
        || !a.input().industryCode().equals(b.input().industryCode())
        || !a.policy().equals(b.policy())
        || !a.input().boundary().equals(b.input().boundary())
        || district.requestedAt() == null
        || !district.requestedAt().equals(dong.requestedAt()))
      throw new IllegalArgumentException("두 단위의 판본·정책·조회 시점 불일치");
    var parents = new HashMap<String, String>();
    a.input().regions().forEach(r -> parents.put(r.regionCode(), r.regionName()));
    for (var r : b.input().regions())
      if (!Objects.equals(parents.get(r.districtCode()), r.districtName()))
        throw new IllegalArgumentException("동의 부모 구가 전체 구 경계와 불일치");
    var batches = new HashMap<java.util.UUID, ScoreInputSnapshot.BatchMetadata>();
    for (var artifact : java.util.List.of(district, dong))
      for (var batch : artifact.payload().batches()) {
        var previous = batches.put(batch.batchId(), batch);
        if (previous != null && !previous.equals(batch))
          throw new IllegalArgumentException("같은 배치의 판본 불일치");
      }
  }

  byte[] encode() {
    var codec = new ScoreSnapshotCodec();
    var root = JSON.createObjectNode();
    root.put("bundleSchemaVersion", VERSION);
    root.set("district", JSON.readTree(codec.encode(district)));
    root.set("dong", JSON.readTree(codec.encode(dong)));
    return ScoreSnapshotCodec.canonicalJson(root);
  }

  static ScoreSnapshotBundle decode(byte[] bytes) {
    try {
      String text =
          StandardCharsets.UTF_8
              .newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT)
              .onUnmappableCharacter(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(bytes))
              .toString();
      if (text.startsWith("\ufeff")) throw new IllegalArgumentException();
      var root = JSON.readTree(text);
      if (!root.isObject()
          || !Set.copyOf(root.propertyNames())
              .equals(Set.of("bundleSchemaVersion", "district", "dong"))
          || !root.get("bundleSchemaVersion").isString()
          || !VERSION.equals(root.get("bundleSchemaVersion").stringValue()))
        throw new IllegalArgumentException();
      var codec = new ScoreSnapshotCodec();
      return new ScoreSnapshotBundle(
          codec.decode(ScoreSnapshotCodec.canonicalJson(root.get("district"))),
          codec.decode(ScoreSnapshotCodec.canonicalJson(root.get("dong"))));
    } catch (Exception error) {
      throw new IllegalArgumentException("스냅샷 묶음 형식·해시·재현 검증 실패");
    }
  }

  void printSummary(java.io.PrintStream out) {
    var a = district.payload().coverage();
    var b = dong.payload().coverage();
    out.println(
        "districtBoundary="
            + a.boundaryRegionCount()
            + " districtEligible="
            + a.eligibleRegionCount()
            + " districtExcluded="
            + a.excludedRegionCount()
            + " dongBoundary="
            + b.boundaryRegionCount()
            + " dongEligible="
            + b.eligibleRegionCount()
            + " dongExcluded="
            + b.excludedRegionCount());
    out.println(
        "districtInputSnapshotId="
            + district.inputSnapshotId()
            + " dongInputSnapshotId="
            + dong.inputSnapshotId());
    out.println("publication=NOT_APPROVED sourceTrust=NOT_ESTABLISHED R03_COMPLETE=false");
  }
}
