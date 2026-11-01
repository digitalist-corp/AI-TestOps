package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.ScenarioOrigin;
import com.playops.api.entity.SiteNode;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteNodeRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RecordedFlowServiceTest {

    private static final String BASE = "https://shop.example.com";

    // ---------------------------------------------------------------- 순수 변환

    @Test
    void routeKeysFollowStepOrderDropOtherOriginsAndCollapseRepeats() {
        List<String> urls = List.of(
                "https://shop.example.com/",
                "https://shop.example.com/products?page=2",
                "https://shop.example.com/products",      // 같은 화면이 이어짐 → 하나로
                "https://pay.other.com/checkout",          // 다른 출처 → 제외
                "https://shop.example.com/products/42/",
                "http://shop.example.com/cart",            // scheme 이 다르면 다른 출처
                "https://shop.example.com:8443/cart",      // port 가 다르면 다른 출처
                "/cart#top",                               // 상대 경로는 baseUrl 기준
                "https://shop.example.com/");

        assertThat(RecordedFlowService.routeKeysOf(urls, BASE))
                .containsExactly("/", "/products", "/products/42", "/cart", "/");
    }

    @Test
    void routeKeyOfIgnoresNonHttpAndBlank() {
        assertThat(RecordedFlowService.routeKeyOf("about:blank", BASE)).isNull();
        assertThat(RecordedFlowService.routeKeyOf(null, BASE)).isNull();
        assertThat(RecordedFlowService.routeKeyOf("https://x.com/a/", null)).isEqualTo("/a");
    }

    @Test
    void selectorKeysUseTheSameFormatAsScreenElements() {
        List<String> keys = RecordedFlowService.selectorKeysOf(java.util.Arrays.asList(
                null,
                "getByLabel('이메일')",
                "getByRole('button', { name: '로그인' })",
                "getByRole('button', { name: '로그인' })",
                "getByRole('navigation').getByRole('link', { name: '홈' })",
                "getByTestId('cart').nth(1)"));

        assertThat(keys).containsExactly("label|이메일", "role|button|로그인", "role|navigation|", "role|link|홈", "testid|cart");
        // 사이트 탐색 요소에서 만든 키와 같아야 실행 결과가 지도에 반영된다.
        assertThat(SiteMapPromptService.keysOf(Map.of("role", "button", "name", "로그인"))).contains("role|button|로그인");
    }

    @Test
    void matchesRecordedPathToParameterizedScreens() {
        List<String> routes = List.of("/", "/products", "/products/:id", "/docs/[...slug]", "/blog/[id]", "/orders/new");

        assertThat(RecordedFlowService.matchRoute("/products", routes)).isEqualTo("/products");
        assertThat(RecordedFlowService.matchRoute("/products/42", routes)).isEqualTo("/products/:id");
        assertThat(RecordedFlowService.matchRoute("/blog/hello", routes)).isEqualTo("/blog/[id]");
        assertThat(RecordedFlowService.matchRoute("/docs/a/b", routes)).isEqualTo("/docs/[...slug]");
        assertThat(RecordedFlowService.matchRoute("/orders/new", routes)).isEqualTo("/orders/new");
        assertThat(RecordedFlowService.matchRoute("/products/42/reviews", routes)).isNull();
    }

    @Test
    void recordedElementIsObservedUnlessItDependsOnOrder() {
        Map<String, Object> button = RecordedFlowService.elementFor("getByRole('button', { name: '담기' })", false);
        assertThat(button).containsEntry("role", "button").containsEntry("name", "담기")
                .containsEntry("verification", "OBSERVED");
        assertThat(SiteMapPromptService.keysOf(button)).containsExactly("role|button|담기");

        Map<String, Object> fragile = RecordedFlowService.elementFor("getByText('상품').nth(2)", true);
        assertThat(fragile).containsEntry("text", "상품").containsEntry("duplicate", true)
                .containsEntry("verification", "UNVERIFIED");

        Map<String, Object> scoped = RecordedFlowService.elementFor("getByRole('navigation').getByRole('link', { name: '홈' })", false);
        assertThat(scoped).containsEntry("role", "link").containsEntry("scope", Map.of("role", "navigation"));
    }

    @Test
    void mergeAddsMissingElementAndUpgradesUnverifiedButKeepsTestResults() {
        List<Map<String, Object>> elements = new ArrayList<>();
        elements.add(new java.util.HashMap<>(Map.of("role", "button", "name", "담기", "verification", "UNVERIFIED")));
        elements.add(new java.util.HashMap<>(Map.of("testId", "cart", "verification", "FAILED")));

        assertThat(RecordedFlowService.mergeElement(elements,
                RecordedFlowService.elementFor("getByRole('button', { name: '담기' })", false))).isTrue();
        assertThat(elements.get(0)).containsEntry("verification", "OBSERVED");

        assertThat(RecordedFlowService.mergeElement(elements, RecordedFlowService.elementFor("getByTestId('cart')", false))).isFalse();
        assertThat(elements.get(1)).containsEntry("verification", "FAILED");

        assertThat(RecordedFlowService.mergeElement(elements, RecordedFlowService.elementFor("getByLabel('수량')", false))).isTrue();
        assertThat(elements).hasSize(3);
        assertThat(RecordedFlowService.mergeElement(elements, RecordedFlowService.elementFor("getByLabel('수량')", false))).isFalse();
    }

    // ---------------------------------------------------------------- 저장소에 반영

    @Test
    @SuppressWarnings("unchecked")
    void recordAddsObservedElementsCreatesMissingScreensAndWritesOrigin() throws Exception {
        SiteNodeRepository nodeRepository = mock(SiteNodeRepository.class);
        ScenarioOriginRepository originRepository = mock(ScenarioOriginRepository.class);
        SiteNode products = new SiteNode();
        products.setProjectId("p");
        products.setRouteKey("/products/:id");
        products.setOrigin("CODE");
        products.setElements("[{\"role\":\"button\",\"name\":\"담기\",\"verification\":\"UNVERIFIED\"}]");
        when(nodeRepository.findByProjectIdOrderByRouteKey("p")).thenReturn(List.of(products));
        when(originRepository.findByProjectIdAndSpecPath(anyString(), anyString())).thenReturn(Optional.empty());
        SiteMapPromptService prompt = new SiteMapPromptService(nodeRepository, null, originRepository, null);
        RecordedFlowService service = new RecordedFlowService(nodeRepository, prompt);

        service.record("p", "tests/recorded/order.spec.ts", BASE, List.of(
                new RecordedFlowService.RecordedAction(BASE + "/products/7", null, false),                         // goto
                new RecordedFlowService.RecordedAction(BASE + "/products/7", "getByRole('button', { name: '담기' })", false),
                new RecordedFlowService.RecordedAction(BASE + "/cart", "getByRole('link', { name: '장바구니' })", false),
                new RecordedFlowService.RecordedAction("https://pay.other.com/x", "getByRole('button', { name: '결제' })", false),
                new RecordedFlowService.RecordedAction("https://pay.other.com/x", "getByText('완료')", false)));

        ArgumentCaptor<Iterable<SiteNode>> saved = ArgumentCaptor.forClass(Iterable.class);
        verify(nodeRepository).saveAll(saved.capture());
        Map<String, SiteNode> byRoute = StreamSupport.stream(saved.getValue().spliterator(), false)
                .collect(Collectors.toMap(SiteNode::getRouteKey, n -> n));
        ObjectMapper json = new ObjectMapper();
        List<Map<String, Object>> productElements = json.readValue(byRoute.get("/products/:id").getElements(), new TypeReference<>() {});
        // 담기는 이미 있던 요소라 OBSERVED 로 올리고, 장바구니 링크는 클릭 직전 화면(상품)에 새로 더한다.
        assertThat(productElements).extracting(e -> e.get("name")).containsExactly("담기", "장바구니");
        assertThat(productElements).extracting(e -> e.get("verification")).containsOnly("OBSERVED");
        // 지도에 없던 /cart 는 녹화 화면으로 만든다. 결제 버튼은 /cart 에서 눌렀다.
        SiteNode cart = byRoute.get("/cart");
        assertThat(cart.getOrigin()).isEqualTo("RECORDED");
        assertThat(cart.getUrl()).isEqualTo(BASE + "/cart");
        assertThat(cart.getElements()).contains("결제").doesNotContain("완료");

        ArgumentCaptor<ScenarioOrigin> origin = ArgumentCaptor.forClass(ScenarioOrigin.class);
        verify(originRepository).save(origin.capture());
        assertThat(origin.getValue().getSource()).isEqualTo("RECORDED");
        assertThat(origin.getValue().getRouteKeys()).isEqualTo("[\"/products/:id\",\"/cart\"]");
        assertThat(origin.getValue().getSelectorKeys()).contains("role|button|담기", "role|link|장바구니", "text|완료");
    }

    @Test
    void recordOriginKeepsKnownRoutesAndSourceWhenAiFixesWithoutPickingScreens() {
        ScenarioOriginRepository originRepository = mock(ScenarioOriginRepository.class);
        ScenarioOrigin existing = new ScenarioOrigin();
        existing.setProjectId("p");
        existing.setSpecPath("tests/recorded/order.spec.ts");
        existing.setRouteKeys("[\"/\",\"/cart\"]");
        existing.setSource("RECORDED");
        when(originRepository.findByProjectIdAndSpecPath("p", "tests/recorded/order.spec.ts")).thenReturn(Optional.of(existing));
        when(originRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        SiteMapPromptService prompt = new SiteMapPromptService(null, null, originRepository, null);

        prompt.recordOrigin("p", "tests/recorded/order.spec.ts", List.of(), List.of("role|button|담기"));

        assertThat(existing.getRouteKeys()).isEqualTo("[\"/\",\"/cart\"]");
        assertThat(existing.getSource()).isEqualTo("RECORDED");
        assertThat(existing.getSelectorKeys()).isEqualTo("[\"role|button|담기\"]");
    }
}
