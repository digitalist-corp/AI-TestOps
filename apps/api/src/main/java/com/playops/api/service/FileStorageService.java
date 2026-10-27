package com.playops.api.service;

import com.playops.api.exception.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class FileStorageService {

    private final ProjectService projectService;
    private static final List<String> EXPLORER_HIDDEN_SEGMENTS = List.of(
            ".git",
            ".hg",
            ".svn",
            ".cache",
            ".gradle",
            ".idea",
            ".next",
            ".playwright",
            ".turbo",
            ".vscode",
            "build",
            "coverage",
            "dist",
            "node_modules",
            "out",
            "playwright-report",
            "target",
            "test-results"
    );

    public FileStorageService(ProjectService projectService) {
        this.projectService = projectService;
    }

    public void uploadZip(String projectId, MultipartFile file) {
        if (file.isEmpty()) {
            throw new ApiException(400, "File is empty");
        }

        String filename = file.getOriginalFilename();
        if (filename == null || !filename.toLowerCase().endsWith(".zip")) {
            throw new ApiException(400, "Only .zip files are supported");
        }

        Path projectPath = projectService.getProjectPath(projectId);
        try {
            Files.createDirectories(projectPath);
            clearDirectory(projectPath);

            try (InputStream is = file.getInputStream();
                 ZipInputStream zis = new ZipInputStream(is)) {
                ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    if (entry.isDirectory()) {
                        Files.createDirectories(projectPath.resolve(stripRoot(entry.getName())));
                    } else {
                        Path target = projectPath.resolve(stripRoot(entry.getName()));
                        Files.createDirectories(target.getParent());
                        Files.copy(zis, target, StandardCopyOption.REPLACE_EXISTING);
                    }
                    zis.closeEntry();
                }
            }
        } catch (IOException e) {
            throw new ApiException(500, "Failed to upload files: " + e.getMessage());
        }
    }

    public void uploadFiles(String projectId, MultipartFile[] files) {
        if (files == null || files.length == 0) {
            throw new ApiException(400, "No files provided");
        }

        Path projectPath = projectService.getProjectPath(projectId);
        try {
            Files.createDirectories(projectPath);
            for (MultipartFile file : files) {
                if (file.isEmpty()) continue;
                String relativePath = file.getOriginalFilename();
                if (relativePath == null) continue;
                Path target = projectPath.resolve(relativePath);
                Files.createDirectories(target.getParent());
                Files.copy(file.getInputStream(), target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new ApiException(500, "Failed to upload files: " + e.getMessage());
        }
    }

    public List<String> listFiles(String projectId) {
        Path projectPath = projectService.getProjectPath(projectId);
        if (!Files.exists(projectPath)) {
            return List.of();
        }

        List<String> result = new ArrayList<>();
        try {
            collectExplorerFiles(projectPath, projectPath, result);
            result.sort(String::compareTo);
        } catch (IOException e) {
            throw new ApiException(500, "Failed to list files: " + e.getMessage());
        }
        return result;
    }

    public String readFile(String projectId, String relativePath) {
        if (isRestrictedFile(relativePath)) {
            throw new ApiException(403, "Viewing environment files is not allowed");
        }
        Path file = resolveFile(projectId, relativePath);
        if (!Files.exists(file)) {
            throw new ApiException(404, "File not found: " + relativePath);
        }
        try {
            return Files.readString(file);
        } catch (IOException e) {
            throw new ApiException(500, "Failed to read file: " + e.getMessage());
        }
    }

    public void writeFile(String projectId, String relativePath, String content) {
        if (isRestrictedFile(relativePath)) {
            throw new ApiException(403, "Editing environment files is not allowed");
        }
        Path file = resolveFile(projectId, relativePath);
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, content != null ? content : "", StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new ApiException(500, "Failed to write file: " + e.getMessage());
        }
    }

    public Path resolveFile(String projectId, String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            throw new ApiException(400, "PATH_NOT_ALLOWED", "File path is required");
        }
        String normalized = relativePath.replace('\\', '/').trim();
        if (normalized.startsWith("/") || normalized.contains("..")) {
            throw new ApiException(400, "PATH_NOT_ALLOWED", "Invalid file path");
        }
        Path projectPath = projectService.getProjectPath(projectId).toAbsolutePath().normalize();
        Path resolved = projectPath.resolve(normalized).normalize();
        if (!resolved.startsWith(projectPath)) {
            throw new ApiException(400, "PATH_NOT_ALLOWED", "Invalid file path");
        }
        try {
            if (Files.exists(projectPath)) {
                Path realProjectRoot = projectPath.toRealPath();
                Path check = resolved;
                while (check != null && !Files.exists(check)) {
                    check = check.getParent();
                }
                if (check != null) {
                    Path realCheck = check.toRealPath();
                    if (!realCheck.startsWith(realProjectRoot)) {
                        throw new ApiException(400, "PATH_NOT_ALLOWED", "Symlink escape detected");
                    }
                }
            }
        } catch (IOException e) {
            throw new ApiException(400, "PATH_NOT_ALLOWED", "Invalid file path");
        }
        return resolved;
    }

    private void clearDirectory(Path dir) throws IOException {
        if (!Files.exists(dir)) return;
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder())
                    .filter(p -> !p.equals(dir))
                    .forEach(p -> {
                        try {
                            Files.deleteIfExists(p);
                        } catch (IOException ignored) {}
                    });
        }
    }

    private String stripRoot(String entryName) {
        String normalized = entryName.replace('\\', '/');
        if (normalized.contains("/")) {
            String[] parts = normalized.split("/", 2);
            if (parts.length == 2 && !parts[0].contains(".")) {
                return parts[1];
            }
        }
        return normalized;
    }

    private boolean isHiddenFromExplorer(String relativePath) {
        String[] segments = relativePath.replace('\\', '/').split("/");
        for (String segment : segments) {
            if (EXPLORER_HIDDEN_SEGMENTS.contains(segment)) {
                return true;
            }
        }
        return false;
    }

    private void collectExplorerFiles(Path projectPath, Path directory, List<String> result) throws IOException {
        try (DirectoryStream<Path> entries = Files.newDirectoryStream(directory)) {
            for (Path entry : entries) {
                String relativePath = projectPath.relativize(entry).toString().replace('\\', '/');
                if (isHiddenFromExplorer(relativePath)) {
                    continue;
                }
                if (Files.isDirectory(entry)) {
                    collectExplorerFiles(projectPath, entry, result);
                } else if (Files.isRegularFile(entry)) {
                    result.add(relativePath);
                }
            }
        }
    }

    private boolean isRestrictedFile(String relativePath) {
        if (relativePath == null) {
            return false;
        }
        String normalized = relativePath.replace('\\', '/').trim();
        String fileName = normalized.contains("/")
                ? normalized.substring(normalized.lastIndexOf('/') + 1)
                : normalized;
        return fileName.equals(".env") || fileName.startsWith(".env.");
    }
}
