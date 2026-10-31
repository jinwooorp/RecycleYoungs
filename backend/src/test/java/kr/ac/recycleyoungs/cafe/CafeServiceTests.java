package kr.ac.recycleyoungs.cafe;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.cafe.CafeResponse.Cafe;
import kr.ac.recycleyoungs.region.RegionRepository;
import kr.ac.recycleyoungs.region.RegionResponse.District;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.junit.jupiter.api.Test;

/** 공간적으로 빈 결과와 게시 미준비·선택 구 미존재 및 페이지 끝을 구분한다. */
class CafeServiceTests {

  private final RegionRepository regions = mock(RegionRepository.class);
  private final CafeRepository repository = mock(CafeRepository.class);
  private final CafeService service = new CafeService(regions, repository);
  private final PublishedBatch cafeBatch =
      new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z"));
  private final PublishedBatch boundary =
      new PublishedBatch(new UUID(0, 1), OffsetDateTime.parse("2026-10-01T00:00:00Z"));

  @Test
  void requiresPreparedCafePublication() {
    expectError(List.of(), ApiErrorCode.DATA_NOT_READY);
    verifyNoInteractions(regions);
  }

  @Test
  void requiresBoundaryOnlyWhenDistrictFilterIsSpecified() {
    expectError(List.of("00110"), ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void rejectsMissingCurrentDistrictBeforeCafeReadiness() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    when(regions.findDistricts(boundary.batchId()))
        .thenReturn(List.of(new District("00110", "예시구")));
    expectError(List.of("00110", "99999"), ApiErrorCode.REGION_NOT_FOUND);
    verifyNoInteractions(repository);
  }

  @Test
  void keepsEmptySpatialResultSeparateFromUnpreparedDataset() {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(cafeBatch));
    when(repository.findNearby(cafeBatch.batchId(), null, 127, 37, 500, List.of(), 100, 0))
        .thenReturn(List.of());
    var response = service.getNearby(127, 37, 500, List.of(), 100, 0);
    assertThat(response).isEqualTo(new CafeResponse(List.of(), 0, 100, 0, false, cafeBatch));
    verifyNoInteractions(regions);
  }

  @Test
  void keepsCafeBatchAndBoundaryBatchSeparateAndCountsBeforePaging() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    when(regions.findDistricts(boundary.batchId()))
        .thenReturn(List.of(new District("00110", "예시구")));
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(cafeBatch));
    when(repository.countNearby(
            cafeBatch.batchId(), boundary.batchId(), 127, 37, 500, List.of("00110")))
        .thenReturn(3L);
    var items = List.of(new Cafe("000001", "예시카페", null, "I21201", "카페", null, null, 127, 37, 0));
    when(repository.findNearby(
            cafeBatch.batchId(), boundary.batchId(), 127, 37, 500, List.of("00110"), 1, 1))
        .thenReturn(items);
    var response = service.getNearby(127, 37, 500, List.of("00110"), 1, 1);
    assertThat(response).isEqualTo(new CafeResponse(items, 3, 1, 1, true, cafeBatch));
  }

  @Test
  void retainsTotalCountOnEmptyPageBeyondLastMatch() {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(cafeBatch));
    when(repository.countNearby(cafeBatch.batchId(), null, 127, 37, 500, List.of())).thenReturn(3L);
    when(repository.findNearby(cafeBatch.batchId(), null, 127, 37, 500, List.of(), 1, 100000))
        .thenReturn(List.of());
    var response = service.getNearby(127, 37, 500, List.of(), 1, 100000);
    assertThat(response).isEqualTo(new CafeResponse(List.of(), 3, 1, 100000, false, cafeBatch));
  }

  private void expectError(List<String> codes, ApiErrorCode code) {
    assertThatThrownBy(() -> service.getNearby(127, 37, 500, codes, 100, 0))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.errorCode()).isEqualTo(code));
  }

  @Test
  void viewportRequiresCafePublicationButNotUnselectedBoundary() {
    expectViewportError(List.of(), ApiErrorCode.DATA_NOT_READY);
    verifyNoInteractions(regions);
  }

  @Test
  void viewportRequiresPreparedBoundaryForSelectedDistrict() {
    expectViewportError(List.of("00110"), ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void viewportRejectsMissingCurrentDistrictBeforeCafeReadiness() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    when(regions.findDistricts(boundary.batchId()))
        .thenReturn(List.of(new District("00110", "예시구")));
    expectViewportError(List.of("00110", "99999"), ApiErrorCode.REGION_NOT_FOUND);
    verifyNoInteractions(repository);
  }

  @Test
  void viewportReturnsReadySourceForSpatiallyEmptyResult() {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(cafeBatch));
    when(repository.findViewport(
            cafeBatch.batchId(), null, 126.99, 36.99, 127.01, 37.01, List.of(), 100, 0))
        .thenReturn(List.of());
    assertThat(service.getViewport(126.99, 36.99, 127.01, 37.01, List.of(), 100, 0))
        .isEqualTo(new CafeViewportResponse(List.of(), 0, 100, 0, false, cafeBatch));
    verifyNoInteractions(regions);
  }

  @Test
  void viewportUsesSeparatePublicationAndBoundaryBatchesWithCountBeforePaging() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    when(regions.findDistricts(boundary.batchId()))
        .thenReturn(List.of(new District("00110", "예시구")));
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(cafeBatch));
    when(repository.countViewport(
            cafeBatch.batchId(),
            boundary.batchId(),
            126.99,
            36.99,
            127.01,
            37.01,
            List.of("00110")))
        .thenReturn(3L);
    var items =
        List.of(
            new CafeViewportResponse.Cafe(
                "000001", "예시카페", null, "I21201", "카페", null, null, 127, 37));
    when(repository.findViewport(
            cafeBatch.batchId(),
            boundary.batchId(),
            126.99,
            36.99,
            127.01,
            37.01,
            List.of("00110"),
            1,
            1))
        .thenReturn(items);
    assertThat(service.getViewport(126.99, 36.99, 127.01, 37.01, List.of("00110"), 1, 1))
        .isEqualTo(new CafeViewportResponse(items, 3, 1, 1, true, cafeBatch));
  }

  @Test
  void viewportKeepsTotalForPageBeyondLastMatch() {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(cafeBatch));
    when(repository.countViewport(
            cafeBatch.batchId(), null, 126.99, 36.99, 127.01, 37.01, List.of()))
        .thenReturn(3L);
    when(repository.findViewport(
            cafeBatch.batchId(), null, 126.99, 36.99, 127.01, 37.01, List.of(), 1, 100000))
        .thenReturn(List.of());
    assertThat(service.getViewport(126.99, 36.99, 127.01, 37.01, List.of(), 1, 100000))
        .isEqualTo(new CafeViewportResponse(List.of(), 3, 1, 100000, false, cafeBatch));
  }

  private void expectViewportError(List<String> codes, ApiErrorCode code) {
    assertThatThrownBy(() -> service.getViewport(126.99, 36.99, 127.01, 37.01, codes, 100, 0))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.errorCode()).isEqualTo(code));
  }
}
