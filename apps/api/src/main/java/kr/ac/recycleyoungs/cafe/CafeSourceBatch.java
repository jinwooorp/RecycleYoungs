package kr.ac.recycleyoungs.cafe;

import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/** 조회에 사용한 게시본의 게시 시각과 원천 기준년월을 공개한다. */
public record CafeSourceBatch(
    UUID batchId, OffsetDateTime publishedAt, @Nullable String referenceMonth) {

  private static final Pattern REFERENCE_MONTH = Pattern.compile("(?!0000)[0-9]{4}(0[1-9]|1[0-2])");

  public CafeSourceBatch {
    if (referenceMonth != null && !REFERENCE_MONTH.matcher(referenceMonth).matches()) {
      referenceMonth = null;
    }
  }
}
