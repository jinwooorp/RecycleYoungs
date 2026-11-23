package kr.ac.recycleyoungs.region;

import java.util.List;
import java.util.stream.Collectors;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionResponse.BoundaryFeature;
import kr.ac.recycleyoungs.region.RegionResponse.BoundaryProperties;
import kr.ac.recycleyoungs.region.RegionResponse.District;
import kr.ac.recycleyoungs.region.RegionResponse.DistrictList;
import kr.ac.recycleyoungs.region.RegionResponse.DongList;
import kr.ac.recycleyoungs.region.RegionResponse.NearbyRegions;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** 게시 데이터 준비 상태와 지역 미존재를 구분하고 행정구역 응답을 구성한다. */
@Service
@Profile("db")
// 배치 선택 직후 새 ETL이 게시되어도 이름·경계·배치 정보를 하나의 스냅샷에서 읽는다.
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class RegionService {

  private final RegionRepository repository;
  private final JsonMapper jsonMapper;

  public RegionService(RegionRepository repository, JsonMapper jsonMapper) {
    this.repository = repository;
    this.jsonMapper = jsonMapper;
  }

  public DistrictList getDistricts() {
    var batch = requiredBatch();
    return new DistrictList(repository.findDistricts(batch.batchId()));
  }

  public DongList getDongs(String districtCode) {
    var batch = requiredBatch();
    repository
        .findDistrict(batch.batchId(), districtCode)
        .orElseThrow(() -> new ApiException(ApiErrorCode.REGION_NOT_FOUND));
    return new DongList(repository.findDongs(batch.batchId(), districtCode));
  }

  public BoundaryFeature getDistrictBoundary(String districtCode) {
    var batch = requiredBatch();
    var boundary =
        repository
            .findDistrictBoundary(batch.batchId(), districtCode)
            .orElseThrow(() -> new ApiException(ApiErrorCode.REGION_NOT_FOUND));
    return feature("DISTRICT", boundary, batch);
  }

  public BoundaryFeature getDongBoundary(String dongCode) {
    var batch = requiredBatch();
    var boundary =
        repository
            .findDongBoundary(batch.batchId(), dongCode)
            .orElseThrow(() -> new ApiException(ApiErrorCode.REGION_NOT_FOUND));
    return feature("DONG", boundary, batch);
  }

  public NearbyRegions getNearby(
      double longitude, double latitude, double radiusM, List<String> districtCodes) {
    var batch = requiredBatch();
    if (!districtCodes.isEmpty()) {
      var currentCodes =
          repository.findDistricts(batch.batchId()).stream()
              .map(District::districtCode)
              .collect(Collectors.toSet());
      // 반경 밖의 정상 구는 빈 결과지만, 현재 게시본에 없는 지정 구는 404로 구분한다.
      if (!currentCodes.containsAll(districtCodes)) {
        throw new ApiException(ApiErrorCode.REGION_NOT_FOUND);
      }
    }
    return new NearbyRegions(
        batch,
        repository.findNearbyDistricts(
            batch.batchId(), longitude, latitude, radiusM, districtCodes),
        repository.findNearbyDongs(batch.batchId(), longitude, latitude, radiusM, districtCodes));
  }

  private PublishedBatch requiredBatch() {
    return repository
        .findLatestPublishedBatch()
        .orElseThrow(() -> new ApiException(ApiErrorCode.DATA_NOT_READY));
  }

  private BoundaryFeature feature(
      String type, RegionRepository.BoundaryRow boundary, PublishedBatch batch) {
    // JSON 문자열을 그대로 내보내면 geometry가 이중 인코딩되므로 객체로 변환한다.
    return new BoundaryFeature(
        "Feature",
        boundary.code(),
        jsonMapper.readTree(boundary.geometry()),
        new BoundaryProperties(
            type, boundary.code(), boundary.name(), boundary.districtCode(), batch));
  }
}
