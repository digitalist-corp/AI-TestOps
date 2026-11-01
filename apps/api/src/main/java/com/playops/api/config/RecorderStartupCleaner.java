package com.playops.api.config;

import com.playops.api.recorder.RecorderService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** 서버가 꺼지면서 남은 녹화 컨테이너(rec-*)를 지운다. 녹화 세션은 메모리에만 있어 다시 이어 붙일 수 없다. */
@Component
public class RecorderStartupCleaner implements ApplicationRunner {

    private final RecorderService recorderService;

    public RecorderStartupCleaner(RecorderService recorderService) {
        this.recorderService = recorderService;
    }

    @Override
    public void run(ApplicationArguments args) {
        recorderService.removeLeftoverContainers();
    }
}
