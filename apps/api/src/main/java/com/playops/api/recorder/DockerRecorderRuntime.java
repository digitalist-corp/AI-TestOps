package com.playops.api.recorder;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.exception.ApiException;
import com.playops.api.service.AiRunnerDockerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 녹화 컨테이너를 docker CLI 로 다룬다 (다른 러너 서비스처럼 docker.sock + ProcessBuilder).
 *
 * 컨테이너는 api 와 네트워크 공간을 같이 쓰므로(--network container:playops-api) record.js 를
 * http://127.0.0.1:{port} 로 바로 부를 수 있다. 볼륨은 붙이지 않는다 — 로그인 세션 파일이 필요하면
 * docker create → docker cp → docker start 로 그 파일 하나만 넣는다 (다른 프로젝트 파일이 보이지 않게).
 */
@Component
public class DockerRecorderRuntime implements RecorderRuntime {

    private static final Logger log = LoggerFactory.getLogger(DockerRecorderRuntime.class);
    static final String DEFAULT_IMAGE = "playops-ai-runner:latest";
    static final String STORAGE_STATE_IN_CONTAINER = "/tmp/storage-state.json";

    private final AiRunnerDockerService aiRunnerDockerService;
    private final String image;
    private final String network;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    public DockerRecorderRuntime(AiRunnerDockerService aiRunnerDockerService,
                                 @Value("${playops.recorder.image:" + DEFAULT_IMAGE + "}") String image,
                                 @Value("${playops.recorder.network:container:playops-api}") String network) {
        this.aiRunnerDockerService = aiRunnerDockerService;
        this.image = image;
        this.network = network;
    }

    @Override
    public void ensureImage() {
        try {
            run(List.of("docker", "image", "inspect", image), 10);
        } catch (Exception e) {
            if (!DEFAULT_IMAGE.equals(image)) {
                throw new ApiException(500, "녹화 이미지가 없습니다: " + image);
            }
            aiRunnerDockerService.ensureRunnerImage();
        }
    }

    @Override
    public void start(ContainerSpec spec) {
        boolean withState = spec.storageStateFile() != null;
        try {
            if (!withState) {
                run(containerArgs("run", spec, image, network), 30);
                return;
            }
            run(containerArgs("create", spec, image, network), 30);
            run(List.of("docker", "cp", spec.storageStateFile().toString(),
                    spec.containerName() + ":" + STORAGE_STATE_IN_CONTAINER), 30);
            run(List.of("docker", "start", spec.containerName()), 30);
        } catch (Exception e) {
            remove(spec.containerName());
            throw new ApiException(500, "녹화 컨테이너를 띄우지 못했습니다: " + e.getMessage());
        }
    }

    /** docker run -d / docker create 인자. 테스트에서 모양을 확인한다. */
    static List<String> containerArgs(String verb, ContainerSpec spec, String image, String network) {
        List<String> c = new ArrayList<>(List.of("docker", verb));
        if ("run".equals(verb)) {
            c.add("-d");
        }
        c.addAll(List.of(
                "--rm",
                "--name", spec.containerName(),
                "--network", network,
                // 브라우저 하나가 서버 자원을 다 쓰지 않게 막는다.
                "--memory", "1536m",
                "--cpus", "1.5",
                "--pids-limit", "512",
                "-e", "RECORDER_PORT=" + spec.port(),
                "-e", "RECORDER_TOKEN=" + spec.token(),
                "-e", "RECORDER_START_URL=" + spec.startUrl()
        ));
        if (spec.baseUrl() != null && !spec.baseUrl().isBlank()) {
            c.addAll(List.of("-e", "RECORDER_BASE_URL=" + spec.baseUrl()));
        }
        if (spec.storageStateFile() != null) {
            c.addAll(List.of("-e", "RECORDER_STORAGE_STATE=" + STORAGE_STATE_IN_CONTAINER));
        }
        c.addAll(List.of(image, "node", "/ai-runner/record.js"));
        return c;
    }

    @Override
    public void remove(String containerName) {
        try {
            run(List.of("docker", "rm", "-f", containerName), 30);
        } catch (Exception e) {
            // 이미 --rm 으로 지워졌으면 "No such container" — 정상이다.
            log.debug("녹화 컨테이너 삭제 건너뜀 {}: {}", containerName, e.getMessage());
        }
    }

    @Override
    public List<String> listContainers(String prefix) {
        try {
            String out = run(List.of("docker", "ps", "-a", "--filter", "name=^" + prefix, "--format", "{{.Names}}"), 15);
            return Arrays.stream(out.split("\\R")).map(String::trim)
                    .filter(n -> n.startsWith(prefix)).toList();
        } catch (Exception e) {
            log.warn("녹화 컨테이너 목록 조회 실패: {}", e.getMessage());
            return List.of();
        }
    }

    @Override
    public boolean isPortFree(int port) {
        try (ServerSocket socket = new ServerSocket(port, 1, InetAddress.getLoopbackAddress())) {
            socket.setReuseAddress(true);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    @Override
    public RecorderDtos.RecorderState state(int port, String token) {
        return parseState(send(request(port, token, "/state").GET(), Duration.ofSeconds(5)));
    }

    @Override
    public byte[] screenshot(int port, String token) {
        return sendBytes(request(port, token, "/screenshot").GET(), Duration.ofSeconds(15));
    }

    @Override
    public RecorderDtos.RecorderState action(int port, String token, Map<String, Object> action) {
        return parseState(send(request(port, token, "/action")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json(action), StandardCharsets.UTF_8)), Duration.ofSeconds(90)));
    }

    @Override
    public RecorderDtos.RecorderState putSteps(int port, String token, List<RecorderDtos.RecordedStep> steps) {
        return parseState(send(request(port, token, "/steps")
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json(Map.of("steps", steps)), StandardCharsets.UTF_8)), Duration.ofSeconds(10)));
    }

    private HttpRequest.Builder request(int port, String token, String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("X-Recorder-Token", token);
    }

    private String send(HttpRequest.Builder builder, Duration timeout) {
        return new String(sendBytes(builder, timeout), StandardCharsets.UTF_8);
    }

    private byte[] sendBytes(HttpRequest.Builder builder, Duration timeout) {
        HttpResponse<byte[]> res;
        try {
            res = http.send(builder.timeout(timeout).build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CallException(0, "녹화 서버 호출이 중단됐습니다");
        } catch (IOException e) {
            throw new CallException(0, "녹화 서버에 연결하지 못했습니다: " + e.getMessage());
        }
        if (res.statusCode() / 100 != 2) {
            throw new CallException(res.statusCode(), errorMessage(res.body()));
        }
        return res.body();
    }

    private String errorMessage(byte[] body) {
        try {
            JsonNode node = objectMapper.readTree(body);
            if (node.hasNonNull("error")) {
                return node.get("error").asText();
            }
        } catch (Exception ignored) {
            // JSON 이 아니면 아래 기본 문구
        }
        return "녹화 서버 오류";
    }

    private RecorderDtos.RecorderState parseState(String body) {
        try {
            return objectMapper.readValue(body, RecorderDtos.RecorderState.class);
        } catch (Exception e) {
            throw new CallException(502, "녹화 서버 응답을 읽지 못했습니다");
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new ApiException(400, "요청을 JSON 으로 바꾸지 못했습니다");
        }
    }

    private String run(List<String> command, int timeoutSeconds) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        byte[] out = process.getInputStream().readAllBytes();
        if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("docker 명령 시간 초과: " + String.join(" ", command.subList(0, 2)));
        }
        String text = new String(out, StandardCharsets.UTF_8).trim();
        if (process.exitValue() != 0) {
            throw new IllegalStateException(text);
        }
        return text;
    }
}
