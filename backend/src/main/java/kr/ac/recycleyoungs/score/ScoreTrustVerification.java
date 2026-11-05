package kr.ac.recycleyoungs.score;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Arrays;

/** 호출자가 제공한 독립 기준에 대한 내부 결합 진단. 자동 설정·승인·캐시·DB·REST 연결은 없다. */
public final class ScoreTrustVerification {
  public enum Status {
    TRUST_BASIS_MISSING,
    FILE_OR_INTEGRITY_FAILURE,
    REVOCATION_OR_REVISION_FAILURE,
    BINDING_FAILURE,
    BINDING_VERIFIED
  }

  public enum Phase {
    CONFIGURATION,
    INPUT_FILES,
    TRUST_PIN,
    PREVIOUS_TRUST_PIN,
    BINDING,
    FILE_STABILITY
  }

  public enum HistoryCheck {
    NOT_PROVIDED,
    REVISION_FLOOR_ONLY,
    CHECKED
  }

  /** 기대값의 출처·권한·최신성은 공급자 책임이다. 이전 기록 해시는 해당 경로와 함께 제공한다. */
  public record TrustBasis(
      String expectedTrustSha256, String previousExpectedSha256, Long minimumRevision) {}

  /** 경로 존재 여부는 신뢰 기준을 대신하지 않는다. 이전 기록이 없으면 previousRecord는 null이다. */
  public record InputFiles(
      Path trustRecord, Path manifest, Path snapshotBundle, Path previousRecord) {}

  /** 파일 경로·원문·승인 ID·예외를 담지 않는 일회 진단 결과. 공개 허용 결과는 제공하지 않는다. */
  public record Result(Status status, Phase phase, HistoryCheck historyCheck) {
    public InternalScoreResult.PublicationState publicationState() {
      return InternalScoreResult.PublicationState.NOT_APPROVED;
    }

    public ScoreApprovalManifestVerifier.SourceTrust sourceTrust() {
      return ScoreApprovalManifestVerifier.SourceTrust.NOT_ESTABLISHED;
    }

    public boolean r03Complete() {
      return false;
    }
  }

  /** 후속 단계에는 검증한 동일 바이트의 참조를 전달한다. 공개 승인 토큰이 아니다. */
  public record Inspection(Result result, ScoreSnapshotReference reference) {}

  @FunctionalInterface
  interface Reader {
    byte[] read(Path path, Path repository) throws IOException;
  }

  private final Path repository;
  private final Reader reader;

  /** 저장소 위치는 호출자가 지정한다. 생성·Spring 기동만으로 파일에 접근하지 않는다. */
  public ScoreTrustVerification(Path repository) {
    this(repository, ScoreSnapshotFiles::read);
  }

  ScoreTrustVerification(Path repository, Reader reader) {
    this.repository = repository;
    this.reader = reader;
  }

  /** 매번 새로 읽고 검증한다. 성공은 읽은 바이트에 한정되며 이후 철회·현재 DB의 승인을 뜻하지 않는다. */
  public Result verify(TrustBasis basis, InputFiles files) {
    return inspect(basis, files).result();
  }

  /** 결합 검증과 같은 바이트를 후속 DB 대조로 전달한다. 기존 verify()의 결과 계약은 유지한다. */
  public Inspection inspect(TrustBasis basis, InputFiles files) {
    var phase = Phase.CONFIGURATION;
    try {
      configuration(basis, files);
      phase = Phase.INPUT_FILES;
      byte[] trust = reader.read(files.trustRecord(), repository);
      byte[] manifest = reader.read(files.manifest(), repository);
      byte[] bundle = reader.read(files.snapshotBundle(), repository);
      byte[] previous =
          files.previousRecord() == null ? null : reader.read(files.previousRecord(), repository);

      phase = Phase.TRUST_PIN;
      var currentRecord = pinned(trust, basis.expectedTrustSha256());
      ScoreTrustRecord previousRecord = null;
      if (previous != null) {
        phase = Phase.PREVIOUS_TRUST_PIN;
        previousRecord = pinned(previous, basis.previousExpectedSha256());
      }
      phase = Phase.BINDING;
      // 운영 측의 단조 기준은 최소 리비전만 검사한다. 철회 이력이나 동일 리비전 내용 검사를 대신하지 않는다.
      if (basis.minimumRevision() != null && currentRecord.revision() < basis.minimumRevision())
        return stopped(Status.REVOCATION_OR_REVISION_FAILURE, phase);
      var binding = new ScoreTrustRecordVerifier().verify(trust, manifest, bundle, previousRecord);
      var reference = ScoreSnapshotReference.decode(bundle);

      phase = Phase.FILE_STABILITY;
      unchanged(files.trustRecord(), trust);
      unchanged(files.manifest(), manifest);
      unchanged(files.snapshotBundle(), bundle);
      if (previous != null) unchanged(files.previousRecord(), previous);

      var history =
          binding.revisionCheck() == ScoreTrustRecordVerifier.RevisionCheck.CHECKED
              ? HistoryCheck.CHECKED
              : basis.minimumRevision() == null
                  ? HistoryCheck.NOT_PROVIDED
                  : HistoryCheck.REVISION_FLOOR_ONLY;
      return new Inspection(new Result(Status.BINDING_VERIFIED, phase, history), reference);
    } catch (ScoreTrustRecordVerifier.VerificationFailure failure) {
      return stopped(
          switch (failure.kind()) {
            case RECORD_INTEGRITY -> Status.FILE_OR_INTEGRITY_FAILURE;
            case REVOCATION_OR_REVISION -> Status.REVOCATION_OR_REVISION_FAILURE;
            case BINDING -> Status.BINDING_FAILURE;
          },
          phase);
    } catch (Exception failure) {
      // 원본 메시지·원인을 결과에 넣지 않으며 과거 성공을 보관하거나 대신 반환하지 않는다.
      return stopped(
          phase == Phase.CONFIGURATION
              ? Status.TRUST_BASIS_MISSING
              : Status.FILE_OR_INTEGRITY_FAILURE,
          phase);
    }
  }

  private void configuration(TrustBasis basis, InputFiles files) {
    if (repository == null || reader == null || basis == null || files == null)
      throw new IllegalArgumentException();
    ScoreApprovalManifest.hash(basis.expectedTrustSha256());
    path(files.trustRecord());
    path(files.manifest());
    path(files.snapshotBundle());
    if (files.previousRecord() != null || basis.previousExpectedSha256() != null) {
      path(files.previousRecord());
      ScoreApprovalManifest.hash(basis.previousExpectedSha256());
    }
    if (basis.minimumRevision() != null && basis.minimumRevision() < 1)
      throw new IllegalArgumentException();
  }

  private static void path(Path value) {
    if (value == null
        || !value.isAbsolute()
        || !value.equals(value.normalize())
        || value.getFileName() == null) throw new IllegalArgumentException();
  }

  private static ScoreTrustRecord pinned(byte[] bytes, String expected) {
    var codec = new ScoreTrustRecordCodec();
    var record = codec.decode(bytes);
    if (!expected.equals(codec.sha256(record))) throw new IllegalArgumentException();
    return record;
  }

  private void unchanged(Path path, byte[] bytes) throws IOException {
    if (!Arrays.equals(bytes, reader.read(path, repository))) throw new IOException();
  }

  private static Inspection stopped(Status status, Phase phase) {
    return new Inspection(new Result(status, phase, HistoryCheck.NOT_PROVIDED), null);
  }
}
