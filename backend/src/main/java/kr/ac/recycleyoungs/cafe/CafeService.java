package kr.ac.recycleyoungs.cafe;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionRepository;
import kr.ac.recycleyoungs.region.RegionResponse.District;
import org.jspecify.annotations.Nullable;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 선택 구·동 검증·카페 게시본·개수·페이지를 하나의 읽기 스냅샷으로 구성한다. */
@Service
@Profile("db")
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class CafeService {

  private final RegionRepository regions;
  private final CafeRepository repository;

  public CafeService(RegionRepository regions, CafeRepository repository) {
    this.regions = regions;
    this.repository = repository;
  }

  public CafeResponse getNearby(
      double longitude,
      double latitude,
      double radiusM,
      List<String> districtCodes,
      int limit,
      int offset) {
    var boundaryBatch = boundaryBatch(districtCodes);
    var batch =
        repository
            .findLatestPublishedBatch()
            .orElseThrow(() -> new ApiException(ApiErrorCode.DATA_NOT_READY));
    var total =
        repository.countNearby(
            batch.batchId(), boundaryBatch, longitude, latitude, radiusM, districtCodes);
    var items =
        repository.findNearby(
            batch.batchId(),
            boundaryBatch,
            longitude,
            latitude,
            radiusM,
            districtCodes,
            limit,
            offset);
    return new CafeResponse(
        items, total, limit, offset, (long) offset + items.size() < total, batch);
  }

  public CafeViewportResponse getViewport(
      double west,
      double south,
      double east,
      double north,
      List<String> districtCodes,
      List<String> dongCodes,
      int limit,
      int offset) {
    var boundaryBatch = viewportBoundaryBatch(districtCodes, dongCodes);
    var batch =
        repository
            .findLatestPublishedBatch()
            .orElseThrow(() -> new ApiException(ApiErrorCode.DATA_NOT_READY));
    var total =
        repository.countViewport(
            batch.batchId(), boundaryBatch, west, south, east, north, districtCodes, dongCodes);
    var items =
        repository.findViewport(
            batch.batchId(),
            boundaryBatch,
            west,
            south,
            east,
            north,
            districtCodes,
            dongCodes,
            limit,
            offset);
    return new CafeViewportResponse(
        items, total, limit, offset, (long) offset + items.size() < total, batch);
  }

  private @Nullable UUID viewportBoundaryBatch(List<String> districtCodes, List<String> dongCodes) {
    if (dongCodes.isEmpty()) return boundaryBatch(districtCodes);
    var boundary =
        regions
            .findLatestPublishedBatch()
            .orElseThrow(() -> new ApiException(ApiErrorCode.DATA_NOT_READY));
    if (!districtCodes.isEmpty()) {
      var currentCodes =
          regions.findDistricts(boundary.batchId()).stream()
              .map(District::districtCode)
              .collect(Collectors.toSet());
      if (!currentCodes.containsAll(districtCodes))
        throw new ApiException(ApiErrorCode.REGION_NOT_FOUND);
    }
    for (var dongCode : dongCodes) {
      // 문자열 접두사나 카페 FK가 아니라 현행 경계 게시본의 실제 부모 구를 검증한다.
      var parent =
          regions
              .findDongDistrict(boundary.batchId(), dongCode)
              .orElseThrow(() -> new ApiException(ApiErrorCode.REGION_NOT_FOUND));
      if (!districtCodes.isEmpty() && !districtCodes.contains(parent))
        throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
    return boundary.batchId();
  }

  private @Nullable UUID boundaryBatch(List<String> districtCodes) {
    @Nullable UUID boundaryBatch = null;
    // 필터 없는 카페 검색은 경계·행정동 FK의 준비 상태에 의존하지 않는다.
    if (!districtCodes.isEmpty()) {
      var boundary =
          regions
              .findLatestPublishedBatch()
              .orElseThrow(() -> new ApiException(ApiErrorCode.DATA_NOT_READY));
      var currentCodes =
          regions.findDistricts(boundary.batchId()).stream()
              .map(District::districtCode)
              .collect(Collectors.toSet());
      if (!currentCodes.containsAll(districtCodes))
        throw new ApiException(ApiErrorCode.REGION_NOT_FOUND);
      boundaryBatch = boundary.batchId();
    }
    return boundaryBatch;
  }
}
