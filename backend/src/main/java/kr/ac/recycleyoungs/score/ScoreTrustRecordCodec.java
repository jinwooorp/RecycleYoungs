package kr.ac.recycleyoungs.score;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatterBuilder;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.cfg.EnumFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.type.LogicalType;

/** 별도 신뢰 기록의 엄격한 메모리 직렬화. 발급·저장·신뢰 경로 로드는 하지 않는다. */
public final class ScoreTrustRecordCodec {
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
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

  public byte[] encode(ScoreTrustRecord record) {
    try {
      ObjectNode tree = JSON.valueToTree(record);
      for (var revocation : tree.get("revocations")) {
        var node = (ObjectNode) revocation;
        node.put(
            "revokedAt",
            new DateTimeFormatterBuilder()
                .appendInstant(-1)
                .toFormatter()
                .format(OffsetDateTime.parse(node.get("revokedAt").stringValue()).toInstant()));
      }
      return ScoreSnapshotCodec.canonicalJson(tree);
    } catch (RuntimeException error) {
      throw new IllegalArgumentException("신뢰 기록 직렬화 실패");
    }
  }

  public ScoreTrustRecord decode(byte[] json) {
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
      // 날짜의 숫자 epoch 수용과 정수의 묵시적 형변환을 필드 경계에서 차단한다.
      if (!tree.isObject() || !tree.has("revision") || !tree.get("revision").isIntegralNumber())
        throw new IllegalArgumentException();
      if (tree.has("revocations") && tree.get("revocations").isArray())
        for (var revocation : tree.get("revocations"))
          if (!revocation.isObject()
              || !revocation.has("revokedAt")
              || !revocation.get("revokedAt").isString()) throw new IllegalArgumentException();
      var record = JSON.treeToValue(tree, ScoreTrustRecord.class);
      // 짝 없는 surrogate도 정규 JSON 생성 검사로 거부한다.
      encode(record);
      return record;
    } catch (Exception error) {
      throw new IllegalArgumentException("신뢰 기록 형식 검증 실패");
    }
  }

  /** 진위나 보호된 배포 경로의 증거가 아닌 정규 바이트 식별값이다. */
  public String sha256(ScoreTrustRecord record) {
    return ScoreSnapshotCodec.sha256(encode(record));
  }
}
