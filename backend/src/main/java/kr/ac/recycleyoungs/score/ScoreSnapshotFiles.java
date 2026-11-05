package kr.ac.recycleyoungs.score;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SecureDirectoryStream;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Objects;

/** 저장소 외부 보호 경로의 읽기·안정성 검사. 출력 기능은 CLI 소스셋에 별도로 둔다. */
final class ScoreSnapshotFiles {
  private static final LinkOption NOFOLLOW = LinkOption.NOFOLLOW_LINKS;
  private static final long MAX_BYTES = 64L * 1024 * 1024;

  private ScoreSnapshotFiles() {}

  record Target(Path path, Path parent, Object parentKey) {}

  static Target validate(Path path, Path repository) throws IOException {
    if (!path.isAbsolute() || !path.equals(path.normalize()) || path.getFileName() == null)
      throw new IOException("정규 절대 경로 필요");
    Path root = repository.toRealPath();
    if (!Files.exists(root.resolve(".git"), NOFOLLOW) || path.startsWith(root))
      throw new IOException("저장소 내부 경로 금지");
    Path parent = path.getParent();
    checkNoLinks(parent);
    if (Files.isSymbolicLink(path)) throw new IOException("링크 파일 금지");
    var attrs = Files.readAttributes(parent, PosixFileAttributes.class, NOFOLLOW);
    var owner =
        parent
            .getFileSystem()
            .getUserPrincipalLookupService()
            .lookupPrincipalByName(System.getProperty("user.name"));
    if (!attrs.isDirectory()
        || attrs.fileKey() == null
        || !attrs.owner().equals(owner)
        || !attrs.permissions().equals(PosixFilePermissions.fromString("rwx------")))
      throw new IOException("소유자 전용 POSIX 디렉터리 필요");
    return new Target(path, parent, attrs.fileKey());
  }

  private static void checkNoLinks(Path parent) throws IOException {
    Path current = parent.getRoot();
    var lookup = parent.getFileSystem().getUserPrincipalLookupService();
    var self = lookup.lookupPrincipalByName(System.getProperty("user.name"));
    var root = lookup.lookupPrincipalByName("root");
    for (Path part : parent) {
      current = current.resolve(part);
      if (Files.isSymbolicLink(current) || !Files.isDirectory(current, NOFOLLOW))
        throw new IOException("경로 링크·부재 금지");
      var attrs = Files.readAttributes(current, PosixFileAttributes.class, NOFOLLOW);
      int mode = (Integer) Files.getAttribute(current, "unix:mode", NOFOLLOW);
      // 다른 사용자가 상위 디렉터리를 교체할 수 있는 경로는 허용하지 않는다. /tmp 같은 sticky 경로는 소유자 보호를 이용한다.
      if ((!attrs.owner().equals(self) && !attrs.owner().equals(root))
          || ((mode & 0022) != 0 && (mode & 01000) == 0)) throw new IOException("신뢰할 수 없는 상위 디렉터리");
    }
    if (!parent.toRealPath().equals(parent)) throw new IOException("실제 경로 불일치");
  }

  static void checkParent(Target target) throws IOException {
    checkNoLinks(target.parent());
    var attrs = Files.readAttributes(target.parent(), PosixFileAttributes.class, NOFOLLOW);
    if (!Objects.equals(attrs.fileKey(), target.parentKey())
        || !attrs.permissions().equals(PosixFilePermissions.fromString("rwx------")))
      throw new IOException("보관 디렉터리 변경");
  }

  /** 지원 시 openat으로 고정한다. macOS 미지원 시에는 검사한 비공개 POSIX 경로만 사용한다. */
  static Directory secureParent(Target target) throws IOException {
    var root = Files.newDirectoryStream(target.parent().getRoot());
    if (!(root instanceof SecureDirectoryStream<Path> current)) {
      root.close();
      checkParent(target);
      return new Directory(target, null);
    }
    try {
      for (Path part : target.parent()) {
        var next = current.newDirectoryStream(part, NOFOLLOW);
        current.close();
        current = next;
      }
      var attrs = current.getFileAttributeView(PosixFileAttributeView.class).readAttributes();
      if (!Objects.equals(attrs.fileKey(), target.parentKey())
          || !attrs.permissions().equals(PosixFilePermissions.fromString("rwx------")))
        throw new IOException("보관 디렉터리 변경");
      return new Directory(target, current);
    } catch (IOException | RuntimeException error) {
      current.close();
      throw error;
    }
  }

  /** 표준 provider의 차이만 흡수한다. 상대 이름은 내부에서 생성한 단일 파일명만 받는다. */
  record Directory(Target target, SecureDirectoryStream<Path> secure) implements AutoCloseable {
    java.nio.channels.SeekableByteChannel open(Path name) throws IOException {
      var options = java.util.Set.of(StandardOpenOption.READ, NOFOLLOW);
      if (secure != null) return secure.newByteChannel(name, options);
      checkParent(target);
      return FileChannel.open(target.parent().resolve(name), options);
    }

    PosixFileAttributes attributes(Path name) throws IOException {
      if (secure != null)
        return secure
            .getFileAttributeView(name, PosixFileAttributeView.class, NOFOLLOW)
            .readAttributes();
      checkParent(target);
      return Files.readAttributes(
          target.parent().resolve(name), PosixFileAttributes.class, NOFOLLOW);
    }

    @Override
    public void close() throws IOException {
      if (secure != null) secure.close();
    }
  }

  static byte[] read(Path path, Path repository) throws IOException {
    return read(path, repository, () -> {});
  }

  /** 테스트에서 채널을 연 직후 파일 변경을 재현한다. 실제 호출은 관찰 동작 없이 같은 검사를 사용한다. */
  static byte[] read(Path path, Path repository, Runnable beforeContentRead) throws IOException {
    var target = validate(path, repository);
    checkParent(target);
    try (var parent = secureParent(target);
        var channel = parent.open(path.getFileName());
        var out = new ByteArrayOutputStream()) {
      var before = parent.attributes(path.getFileName());
      if (!before.isRegularFile() || before.size() == 0 || before.size() > MAX_BYTES)
        throw new IOException("지원 파일 크기·종류 아님");
      beforeContentRead.run();
      var buffer = ByteBuffer.allocate(8192);
      long total = 0;
      while (channel.read(buffer) != -1) {
        buffer.flip();
        total += buffer.remaining();
        if (total > MAX_BYTES) throw new IOException("지원 파일 크기 초과");
        out.write(buffer.array(), 0, buffer.remaining());
        buffer.clear();
      }
      checkParent(target);
      var after = parent.attributes(path.getFileName());
      if (total != before.size()
          || before.size() != after.size()
          || !before.lastModifiedTime().equals(after.lastModifiedTime())
          || !Objects.equals(before.fileKey(), after.fileKey()))
        throw new IOException("검증 중 파일 변경");
      return out.toByteArray();
    }
  }
}
