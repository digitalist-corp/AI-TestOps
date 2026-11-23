import { Catalog } from '@a2ui/web_core/v1_0';
import type { ReactCatalogComponent } from '@a2ui/react';
import { ButtonView, ChatButton, ChatColumn, Column, Notice, Row, ScreenList, Section, TextView } from './parts/common';
import { CheckList, ChoiceList, TextInput } from './parts/inputs';

/**
 * 우리 A2UI 카탈로그. A2UI 기본 카탈로그는 쓰지 않고, 부품 구현(`parts/`)을 두 카탈로그가 나눠 쓴다.
 * - onboarding/v1: 첫 실행 브리핑 (docs/design/onboarding-briefing-contract.md)
 * - chat/v1: 채팅 질문 화면 (docs/design/chat-a2ui-contract.md)
 */
export const ONBOARDING_CATALOG_ID = 'https://playops.dev/a2ui/catalogs/onboarding/v1';
export const CHAT_CATALOG_ID = 'https://playops.dev/a2ui/catalogs/chat/v1';

export const onboardingCatalog = new Catalog<ReactCatalogComponent>(ONBOARDING_CATALOG_ID, '1.0', [
  Column,
  Section,
  TextView,
  Notice,
  ScreenList,
  CheckList,
  ButtonView,
]);

export const chatCatalog = new Catalog<ReactCatalogComponent>(CHAT_CATALOG_ID, '1.0', [
  ChatColumn,
  Row,
  Section,
  TextView,
  Notice,
  CheckList,
  ChoiceList,
  TextInput,
  ChatButton,
]);
