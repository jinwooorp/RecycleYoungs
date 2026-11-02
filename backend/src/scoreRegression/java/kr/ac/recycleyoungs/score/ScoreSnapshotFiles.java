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

/** 명시한 외부 비공개 디렉터리만 사용한다. 완성한 파일을 하드 링크로 게시해 덮어쓰기를 막는다. */
final class ScoreSnapshotFiles {
  private static final LinkOption NOFOLLOW = LinkOption.NOFOLLOW_LINKS;
  private static final long MAX_BYTES = 64L * 1024 * 1024;

  private ScoreSnapshotFiles() {}

  record Target(Path path, Path parent, Object parentKey) {}

  static Target prepareOutput(Path path, Path repository) throws IOException {
    var target = validate(path, repository);
    if (Files.exists(path, NOFOLLOW)) throw new IOException("기존 출력 거부");
    return target;
  }

  private static Target validate(Path path, Path repository) throws IOException {
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

  private static void checkParent(Target target) throws IOException {
    checkNoLinks(target.parent());
    var attrs = Files.readAttributes(target.parent(), PosixFileAttributes.class, NOFOLLOW);
    if (!Objects.equals(attrs.fileKey(), target.parentKey())
        || !attrs.permissions().equals(PosixFilePermissions.fromString("rwx------")))
      throw new IOException("보관 디렉터리 변경");
  }

  /** 지원 시 openat으로 고정한다. macOS 미지원 시에는 검사한 비공개 POSIX 경로만 사용한다. */
  private static Directory secureParent(Target target) throws IOException {
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
  private record Directory(Target target, SecureDirectoryStream<Path> secure)
      implements AutoCloseable {
    java.nio.channels.SeekableByteChannel open(Path name, boolean create) throws IOException {
      var options =
          create
              ? java.util.Set.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, NOFOLLOW)
              : java.util.Set.of(StandardOpenOption.READ, NOFOLLOW);
      var perms =
          PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"));
      if (secure != null)
        return create
            ? secure.newByteChannel(name, options, perms)
            : secure.newByteChannel(name, options);
      checkParent(target);
      return create
          ? FileChannel.open(target.parent().resolve(name), options, perms)
          : FileChannel.open(target.parent().resolve(name), options);
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

    void readOnly(Path name) throws IOException {
      var perms = PosixFilePermissions.fromString("r--------");
      if (secure != null)
        secure
            .getFileAttributeView(name, PosixFileAttributeView.class, NOFOLLOW)
            .setPermissions(perms);
      else {
        checkParent(target);
        Files.setPosixFilePermissions(target.parent().resolve(name), perms);
      }
    }

    void delete(Path name) throws IOException {
      if (secure != null) secure.deleteFile(name);
      else {
        checkParent(target);
        Files.delete(target.parent().resolve(name));
      }
    }

    @Override
    public void close() throws IOException {
      if (secure != null) secure.close();
    }
  }

  static void saveNew(Target target, byte[] bytes) throws IOException {
    if (bytes.length == 0 || bytes.length > MAX_BYTES) throw new IOException("지원 파일 크기 초과");
    checkParent(target);
    try (var parent = secureParent(target)) {
      Path stage = Path.of(".score-snapshot-" + java.util.UUID.randomUUID() + ".part");
      Object stageKey = null;
      boolean created = false, published = false, complete = false;
      try {
        try (var channel = parent.open(stage, true)) {
          created = true;
          stageKey = parent.attributes(stage).fileKey();
          if (stageKey == null || !(channel instanceof FileChannel file))
            throw new IOException("안전 파일 기능 미지원");
          var buffer = ByteBuffer.wrap(bytes);
          while (buffer.hasRemaining()) channel.write(buffer);
          file.force(true);
        }
        parent.readOnly(stage);
        checkParent(target);
        // ATOMIC_MOVE는 일부 OS에서 기존 대상을 교체한다. createLink는 대상이 있으면 원자적으로 실패한다.
        Files.createLink(target.path(), target.parent().resolve(stage));
        published = true;
        checkParent(target);
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

  static byte[] read(Path path, Path repository) throws IOException {
    var target = validate(path, repository);
    checkParent(target);
    try (var parent = secureParent(target);
        var channel = parent.open(path.getFileName(), false);
        var out = new ByteArrayOutputStream()) {
      var before = parent.attributes(path.getFileName());
      if (!before.isRegularFile() || before.size() == 0 || before.size() > MAX_BYTES)
        throw new IOException("지원 파일 크기·종류 아님");
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
