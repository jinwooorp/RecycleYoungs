package kr.ac.recycleyoungs.score;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Objects;
import kr.ac.recycleyoungs.score.ScoreSnapshotFiles.Target;

/** 명시 내보내기 전용 쓰기 기능. 제품 JAR과 내부 신뢰 검증에는 포함하지 않는다. */
final class ScoreSnapshotOutput {
  private static final LinkOption NOFOLLOW = LinkOption.NOFOLLOW_LINKS;
  private static final long MAX_BYTES = 64L * 1024 * 1024;

  private ScoreSnapshotOutput() {}

  static Target prepareOutput(Path path, Path repository) throws IOException {
    var target = ScoreSnapshotFiles.validate(path, repository);
    if (Files.exists(path, NOFOLLOW)) throw new IOException("기존 출력 거부");
    return target;
  }

  static void saveNew(Target target, byte[] bytes) throws IOException {
    if (bytes.length == 0 || bytes.length > MAX_BYTES) throw new IOException("지원 파일 크기 초과");
    ScoreSnapshotFiles.checkParent(target);
    try (var parent = new Directory(ScoreSnapshotFiles.secureParent(target))) {
      Path stage = Path.of(".score-snapshot-" + java.util.UUID.randomUUID() + ".part");
      Object stageKey = null;
      boolean created = false, published = false, complete = false;
      try {
        try (var channel = parent.open(stage)) {
          created = true;
          stageKey = parent.attributes(stage).fileKey();
          if (stageKey == null || !(channel instanceof FileChannel file))
            throw new IOException("안전 파일 기능 미지원");
          var buffer = ByteBuffer.wrap(bytes);
          while (buffer.hasRemaining()) channel.write(buffer);
          file.force(true);
        }
        parent.readOnly(stage);
        ScoreSnapshotFiles.checkParent(target);
        // ATOMIC_MOVE는 일부 OS에서 기존 대상을 교체한다. createLink는 대상이 있으면 원자적으로 실패한다.
        Files.createLink(target.path(), target.parent().resolve(stage));
        published = true;
        ScoreSnapshotFiles.checkParent(target);
        if (!Objects.equals(parent.attributes(target.path().getFileName()).fileKey(), stageKey))
          throw new IOException("게시 파일 불일치");
        parent.delete(stage);
        created = false;
        complete = true;
      } finally {
        try {
          if (!complete && published) deleteOwn(parent, target.path().getFileName(), stageKey);
        } finally {
          if (created) deleteOwn(parent, stage, stageKey);
        }
      }
    }
  }

  private static void deleteOwn(Directory directory, Path name, Object key) throws IOException {
    // 기존 파일이나 다른 실행이 만든 파일은 정리하지 않는다.
    try {
      if (key != null && Objects.equals(directory.attributes(name).fileKey(), key))
        directory.delete(name);
    } catch (java.nio.file.NoSuchFileException absent) {
      /* 이미 없는 항목을 복원하거나 다른 파일을 지우지 않는다. */
    }
  }

  private record Directory(ScoreSnapshotFiles.Directory directory) implements AutoCloseable {
    java.nio.channels.SeekableByteChannel open(Path name) throws IOException {
      var options =
          java.util.Set.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, NOFOLLOW);
      var perms =
          PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"));
      if (directory.secure() != null)
        return directory.secure().newByteChannel(name, options, perms);
      ScoreSnapshotFiles.checkParent(directory.target());
      return FileChannel.open(directory.target().parent().resolve(name), options, perms);
    }

    java.nio.file.attribute.PosixFileAttributes attributes(Path name) throws IOException {
      return directory.attributes(name);
    }

    private void readOnly(Path name) throws IOException {
      var perms = PosixFilePermissions.fromString("r--------");
      if (directory.secure() != null)
        directory
            .secure()
            .getFileAttributeView(name, PosixFileAttributeView.class, NOFOLLOW)
            .setPermissions(perms);
      else {
        ScoreSnapshotFiles.checkParent(directory.target());
        Files.setPosixFilePermissions(directory.target().parent().resolve(name), perms);
      }
    }

    private void delete(Path name) throws IOException {
      if (directory.secure() != null) directory.secure().deleteFile(name);
      else {
        ScoreSnapshotFiles.checkParent(directory.target());
        Files.delete(directory.target().parent().resolve(name));
      }
    }

    @Override
    public void close() throws IOException {
      directory.close();
    }
  }
}
