package kr.ac.recycleyoungs.score;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatterBuilder;
import java.util.List;
import java.util.Set;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.cfg.EnumFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.type.LogicalType;

/** 승인 주장만 직렬화하며 파일을 발급하거나 저장하지 않는다. */
public final class ScoreApprovalManifestCodec {
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          // enum의 ordinal 숫자 해석은 일반 scalar 변환 차단과 별개이므로 명시적으로 막는다.
          .enable(EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
          .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
          .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
          .withCoercionConfig(
              LogicalType.Textual,
              c ->
                  c.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                      .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                      .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail))
          .build();

  /** 기존 입력 해시는 건드리지 않고 manifest 전체의 별도 정규 바이트를 만든다. */
  public byte[] encode(ScoreApprovalManifest manifest) {
    try {
      ObjectNode tree = JSON.valueToTree(manifest);
      for (String field : List.of("policyApproval", "sourceVerification", "coverageApproval")) {
        var evidence = (ObjectNode) tree.get(field);
        var time = evidence.get("approvedAt");
        if (!time.isNull())
          evidence.put(
              "approvedAt",
              new DateTimeFormatterBuilder()
                  .appendInstant(-1)
                  .toFormatter()
                  .format(OffsetDateTime.parse(time.stringValue()).toInstant()));
      }
      return ScoreSnapshotCodec.canonicalJson(tree);
    } catch (RuntimeException error) {
      throw new IllegalArgumentException("manifest 직렬화 실패");
    }
  }

  public ScoreApprovalManifest decode(byte[] json) {
    try {
      String text =
          StandardCharsets.UTF_8
              .newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT)
              .onUnmappableCharacter(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(json.clone()))
              .toString();
      if (text.startsWith("\ufeff")) throw new IllegalArgumentException();
      var tree = JSON.readTree(text);
      requireTextTimes(tree);
      var manifest = JSON.treeToValue(tree, ScoreApprovalManifest.class);
      // 짝 없는 surrogate 등 정규 JSON에서 표현할 수 없는 문자열도 입구에서 거부한다.
      encode(manifest);
      return manifest;
    } catch (Exception error) {
      throw new IllegalArgumentException("manifest 형식 검증 실패");
    }
  }

  public String sha256(ScoreApprovalManifest manifest) {
    return ScoreSnapshotCodec.sha256(encode(manifest));
  }

  /** 날짜 역직렬화기는 숫자 epoch도 받으므로 ISO 문자열 계약을 매핑 전에 검사한다. */
  private static void requireTextTimes(JsonNode node) {
    if (node.isObject()) {
      for (String key : node.propertyNames()) {
        var value = node.get(key);
        if (Set.of("approvedAt", "startedAt", "finishedAt", "publishedAt").contains(key)
            && !value.isNull()
            && !value.isString()) throw new IllegalArgumentException();
        requireTextTimes(value);
      }
    } else if (node.isArray()) {
      for (var value : node) requireTextTimes(value);
    }
  }
}
