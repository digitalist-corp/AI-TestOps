package com.playops.api.recorder;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 녹화 컨테이너를 띄우고 지우는 일과, 그 안의 record.js HTTP 서버를 부르는 일.
 * 실제 구현은 DockerRecorderRuntime 이고, 테스트에서는 가짜로 바꿔 끼운다.
 */
public interface RecorderRuntime {

    /** 녹화 컨테이너 하나를 띄우는 데 필요한 값. storageStateFile 은 api 컨테이너 안 경로이며 없으면 null. */
    record ContainerSpec(
            String containerName,
            int port,
            String token,
            String startUrl,
            String baseUrl,
            Path storageStateFile
    ) {
    }

    /** record.js 가 2xx 가 아닌 응답을 줬거나 부를 수 없을 때. status 0 은 연결 실패. */
    class CallException extends RuntimeException {
        private final int status;

        public CallException(int status, String message) {
            super(message);
            this.status = status;
        }

        public int status() {
            return status;
        }
    }

    void ensureImage();

    void start(ContainerSpec spec);

    void remove(String containerName);

    /** 이름이 prefix 로 시작하는 컨테이너 이름들 (재시작 때 남은 rec-* 정리용). */
    List<String> listContainers(String prefix);

    /** 이 포트를 지금 열 수 있는지 (api 와 녹화 컨테이너는 네트워크 공간을 같이 쓴다). */
    boolean isPortFree(int port);

    RecorderDtos.RecorderState state(int port, String token);

    byte[] screenshot(int port, String token);

    RecorderDtos.RecorderState action(int port, String token, Map<String, Object> action);

    RecorderDtos.RecorderState putSteps(int port, String token, List<RecorderDtos.RecordedStep> steps);
}
