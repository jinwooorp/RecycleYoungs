package kr.ac.recycleyoungs.score;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.HexFormat;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.type.LogicalType;

/** 메모리 바이트만 다루는 엄격한 스냅샷 codec. 파일·DB·Spring Context를 사용하지 않는다. */
public final class ScoreSnapshotCodec {
  private static final DateTimeFormatter UTC_TIME =
      new DateTimeFormatterBuilder().appendInstant(-1).toFormatter();
  private static final JsonMapper MAPPER =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
          .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
          // 일반 scalar 옵션만으로는 숫자→String 변환이 차단되지 않는다. 원본 표현 계약을 따로 고정한다.
          .withCoercionConfig(
              LogicalType.Textual,
              config ->
                  config
                      .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                      .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                      .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail))
          .build();

  /** 기대 결과도 함께 보존하되 inputSnapshotId의 해시 대상은 payload뿐이다. */
  public byte[] encode(ScoreSnapshotArtifact artifact) {
    return canonicalJson(MAPPER.valueToTree(artifact));
  }

  public byte[] canonicalPayload(ScoreSnapshotArtifact.Payload payload) {
    return canonicalJson(MAPPER.valueToTree(payload));
  }

  /** 손상·중복 키·누락·알 수 없는 필드·해시·재현 불일치를 안전한 오류로 거부한다. */
  public ScoreSnapshotArtifact decode(byte[] json) {
    try {
      // 잘못된 UTF-8을 대체 문자로 조용히 바꾸거나 BOM을 입력에 허용하지 않는다.
      String text =
          StandardCharsets.UTF_8
              .newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT)
              .onUnmappableCharacter(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(json))
              .toString();
      if (text.startsWith("\ufeff")) throw new IllegalArgumentException();
      var tree = MAPPER.readTree(text);
      var artifact = MAPPER.treeToValue(tree, ScoreSnapshotArtifact.class);
      artifact.replay();
      return artifact;
    } catch (RuntimeException | CharacterCodingException error) {
      // 매핑 오류 원문에는 원본 문자열 등이 포함될 수 있다. 외부 오류의 cause도 전달하지 않는다.
      throw new IllegalArgumentException("스냅샷 형식·해시·재현 검증 실패");
    }
  }

  static byte[] canonicalJson(JsonNode node) {
    var output = new StringBuilder();
    append(node, output);
    return output.toString().getBytes(StandardCharsets.UTF_8);
  }

  /** UTF-16 코드 유닛 순서가 아닌 Unicode 코드 포인트 순서를 사용한다. */
  static int compareCodePoints(String left, String right) {
    int a = 0, b = 0;
    while (a < left.length() && b < right.length()) {
      int x = left.codePointAt(a), y = right.codePointAt(b);
      if (x != y) return Integer.compare(x, y);
      a += Character.charCount(x);
      b += Character.charCount(y);
    }
    return Integer.compare(left.length() - a, right.length() - b);
  }

  private static void append(JsonNode node, StringBuilder out) {
    if (node.isObject()) {
      out.append('{');
      boolean first = true;
      for (String key :
          node.propertyNames().stream().sorted(ScoreSnapshotCodec::compareCodePoints).toList()) {
        if (!first) out.append(',');
        first = false;
        quote(key, out);
        out.append(':');
        var value = node.get(key);
        if (java.util.Set.of("startedAt", "finishedAt", "publishedAt", "requestedAt").contains(key)
            && value.isString())
          quote(UTC_TIME.format(OffsetDateTime.parse(value.stringValue()).toInstant()), out);
        else append(value, out);
      }
      out.append('}');
    } else if (node.isArray()) {
      out.append('[');
      boolean first = true;
      for (JsonNode item : node) {
        if (!first) out.append(',');
        first = false;
        append(item, out);
      }
      out.append(']');
    } else if (node.isString()) quote(node.stringValue(), out);
    else if (node.isNull()) out.append("null");
    else if (node.isBoolean() || node.isIntegralNumber()) out.append(node.toString());
    else throw new IllegalArgumentException("정규 JSON에는 문자열·정수 개수·boolean·null만 허용");
  }

  private static void quote(String value, StringBuilder out) {
    out.append('"');
    for (int i = 0; i < value.length(); ) {
      int cp = value.codePointAt(i);
      i += Character.charCount(cp);
      switch (cp) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (cp < 32) {
            out.append("\\u00")
                .append(Character.forDigit(cp / 16, 16))
                .append(Character.forDigit(cp % 16, 16));
          } else if (cp >= 0xd800 && cp <= 0xdfff)
            throw new IllegalArgumentException("짝이 없는 surrogate");
          else out.appendCodePoint(cp);
        }
      }
    }
    out.append('"');
  }

  static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA-256 사용 불가");
    }
  }
}
