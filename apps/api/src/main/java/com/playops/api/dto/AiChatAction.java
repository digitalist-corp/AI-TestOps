package com.playops.api.dto;

/**
 * AI가 대화 도중 실제로 수행하거나 제안한 작업 한 건.
 *
 * 채팅 답변은 글이라 흘러가 버리지만, "AI 작업 #12를 만들었다" 같은 사실은
 * 사용자가 승인하러 이동할 대상이므로 답변 본문과 분리해 구조화된 카드로 돌려준다.
 *
 * @param type     FIX_TEST · GENERATE_SCENARIO · RUN_PROPOSAL
 * @param status   CREATED(작업이 만들어짐) · PROPOSED(사용자 확인 대기) · FAILED
 * @param jobId    만들어진 AI 작업 id (없으면 null)
 * @param specPath 대상 spec 파일 경로
 * @param grep     실행 제안일 때 좁혀 실행할 케이스 이름 (없으면 null)
 */
public record AiChatAction(
        String type,
        String status,
        String label,
        String detail,
        Long jobId,
        String projectId,
        String specPath,
        String grep
) {
    public static AiChatAction created(String type, String label, String detail, Long jobId,
                                       String projectId, String specPath) {
        return new AiChatAction(type, "CREATED", label, detail, jobId, projectId, specPath, null);
    }

    public static AiChatAction proposed(String label, String detail, String projectId,
                                        String specPath, String grep) {
        return new AiChatAction("RUN_PROPOSAL", "PROPOSED", label, detail, null, projectId, specPath, grep);
    }

    public static AiChatAction failed(String type, String label, String detail) {
        return new AiChatAction(type, "FAILED", label, detail, null, null, null, null);
    }
}
