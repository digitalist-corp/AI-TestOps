/**
 * 데모샵 (Demo Shop) 공통 애플리케이션 스크립트
 * - 순수 바닐라 JS, 외부 의존성 없음
 * - localStorage 기반 상태 관리 (로그인, 장바구니, 주문)
 */

// 1. 상품 마스터 데이터 (6개 품목)
const PRODUCTS = [
  {
    id: 1,
    name: "프리미엄 노이즈 캔슬링 헤드폰",
    category: "음향기기",
    price: 189000,
    description: "주변 소음을 효과적으로 차단하는 액티브 노이즈 캔슬링(ANC) 기능과 최대 40시간 연속 재생이 가능한 프리미엄 무선 헤드폰입니다. 인체공학적 메모리폼 이어쿠션으로 오랜 시간 착용해도 편안합니다.",
    svg: `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="프리미엄 노이즈 캔슬링 헤드폰 이미지">
      <path d="M25 65C25 45.67 40.67 30 60 30C79.33 30 95 45.67 95 65" stroke="#3b82f6" stroke-width="6" stroke-linecap="round"/>
      <rect x="18" y="58" width="16" height="34" rx="8" fill="#1d4ed8"/>
      <rect x="86" y="58" width="16" height="34" rx="8" fill="#1d4ed8"/>
      <rect x="22" y="64" width="8" height="22" rx="4" fill="#93c5fd"/>
      <rect x="90" y="64" width="8" height="22" rx="4" fill="#93c5fd"/>
    </svg>`
  },
  {
    id: 2,
    name: "인체공학 무선 버티컬 마우스",
    category: "주변기기",
    price: 45000,
    description: "손목의 부담을 최소화하는 57도 인체공학적 각도 설계. 정밀한 옵티컬 센서와 부드럽고 조용한 무소음 클릭 스위치로 편안하고 생산적인 업무 환경을 제공합니다.",
    svg: `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="인체공학 무선 버티컬 마우스 이미지">
      <path d="M40 92C40 92 38 48 65 30C76 22 84 28 84 38C84 48 84 82 84 88C84 94 78 96 70 96L40 92Z" fill="#2563eb" fill-opacity="0.15" stroke="#2563eb" stroke-width="4"/>
      <path d="M55 40C55 35.5817 58.5817 32 63 32C67.4183 32 71 35.5817 71 40V50C71 54.4183 67.4183 58 63 58C58.5817 58 55 54.4183 55 50V40Z" fill="#3b82f6"/>
      <rect x="61" y="38" width="4" height="8" rx="2" fill="#ffffff"/>
      <path d="M42 72C48 74 58 74 65 70" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  {
    id: 3,
    name: "텐키리스 기계식 키보드",
    category: "주변기기",
    price: 89000,
    description: "콤팩트한 87키 텐키리스 배열로 책상 위 마우스 공간을 넓게 확보해 줍니다. 부드러운 타건감의 리니어 적축 스위치와 은은한 화이트 LED 백라이트가 탑재되어 있습니다.",
    svg: `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="텐키리스 기계식 키보드 이미지">
      <rect x="15" y="38" width="90" height="46" rx="6" fill="#1e293b"/>
      <rect x="20" y="44" width="8" height="7" rx="1.5" fill="#64748b"/>
      <rect x="31" y="44" width="8" height="7" rx="1.5" fill="#64748b"/>
      <rect x="42" y="44" width="8" height="7" rx="1.5" fill="#64748b"/>
      <rect x="53" y="44" width="8" height="7" rx="1.5" fill="#64748b"/>
      <rect x="64" y="44" width="8" height="7" rx="1.5" fill="#64748b"/>
      <rect x="75" y="44" width="8" height="7" rx="1.5" fill="#64748b"/>
      <rect x="86" y="44" width="14" height="7" rx="1.5" fill="#ef4444"/>
      <rect x="20" y="54" width="10" height="7" rx="1.5" fill="#64748b"/>
      <rect x="33" y="54" width="8" height="7" rx="1.5" fill="#94a3b8"/>
      <rect x="44" y="54" width="8" height="7" rx="1.5" fill="#94a3b8"/>
      <rect x="55" y="54" width="8" height="7" rx="1.5" fill="#94a3b8"/>
      <rect x="66" y="54" width="8" height="7" rx="1.5" fill="#94a3b8"/>
      <rect x="77" y="54" width="8" height="7" rx="1.5" fill="#94a3b8"/>
      <rect x="88" y="54" width="12" height="7" rx="1.5" fill="#3b82f6"/>
      <rect x="20" y="64" width="12" height="7" rx="1.5" fill="#64748b"/>
      <rect x="35" y="64" width="8" height="7" rx="1.5" fill="#94a3b8"/>
      <rect x="46" y="64" width="30" height="7" rx="1.5" fill="#3b82f6"/>
      <rect x="79" y="64" width="8" height="7" rx="1.5" fill="#94a3b8"/>
      <rect x="90" y="64" width="10" height="7" rx="1.5" fill="#64748b"/>
    </svg>`
  },
  {
    id: 4,
    name: "고속 충전 C타입 보조배터리 20000mAh",
    category: "충전기/배터리",
    price: 32000,
    description: "최대 65W PD 고속 충전을 지원하여 노트북부터 스마트폰, 태블릿까지 빠르고 안정적으로 충전합니다. 20000mAh 대용량 배터리와 잔량 표시 LED 인디케이터를 갖추었습니다.",
    svg: `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="고속 충전 보조배터리 이미지">
      <rect x="35" y="24" width="50" height="76" rx="8" fill="#334155" stroke="#1e293b" stroke-width="3"/>
      <rect x="44" y="32" width="12" height="4" rx="2" fill="#94a3b8"/>
      <rect x="64" y="32" width="12" height="4" rx="2" fill="#94a3b8"/>
      <circle cx="45" cy="50" r="2.5" fill="#22c55e"/>
      <circle cx="53" cy="50" r="2.5" fill="#22c55e"/>
      <circle cx="61" cy="50" r="2.5" fill="#22c55e"/>
      <circle cx="69" cy="50" r="2.5" fill="#22c55e"/>
      <text x="60" y="84" font-size="9" font-weight="700" fill="#94a3b8" text-anchor="middle" font-family="sans-serif">20000</text>
    </svg>`
  },
  {
    id: 5,
    name: "알루미늄 듀얼 힌지 노트북 거치대",
    category: "데스크용품",
    price: 27000,
    description: "항공기 등급의 견고한 알루미늄 합금으로 제작되어 타이핑 시에도 흔들림 없는 안정성을 자랑합니다. 자유로운 높이 및 각도 조절로 목과 허리의 피로를 덜어줍니다.",
    svg: `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="알루미늄 노트북 거치대 이미지">
      <path d="M25 90H95" stroke="#64748b" stroke-width="5" stroke-linecap="round"/>
      <path d="M40 88L70 48" stroke="#3b82f6" stroke-width="6" stroke-linecap="round"/>
      <path d="M45 42L85 54" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/>
      <path d="M42 41L45 48" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>
      <circle cx="40" cy="88" r="4" fill="#1d4ed8"/>
      <circle cx="70" cy="48" r="4" fill="#1d4ed8"/>
    </svg>`
  },
  {
    id: 6,
    name: "4K 울트라 HD 광각 웹캠",
    category: "화상/영상",
    price: 75000,
    description: "선명한 4K 30fps 고화질 영상과 노이즈 캔슬링 듀얼 마이크가 내장되어 있어 재택근무, 온라인 강의 및 라이브 스트리밍에 최적의 성능을 발휘합니다. 프라이버시 셔터 기본 제공.",
    svg: `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="4K 울트라 HD 웹캠 이미지">
      <rect x="25" y="36" width="70" height="34" rx="17" fill="#1e293b"/>
      <circle cx="60" cy="53" r="13" fill="#334155" stroke="#64748b" stroke-width="2"/>
      <circle cx="60" cy="53" r="7" fill="#0284c7"/>
      <circle cx="62" cy="51" r="2.5" fill="#ffffff"/>
      <circle cx="36" cy="53" r="2" fill="#22c55e"/>
      <circle cx="84" cy="53" r="2" fill="#94a3b8"/>
      <path d="M60 70V84" stroke="#64748b" stroke-width="4" stroke-linecap="round"/>
      <path d="M42 86H78" stroke="#475569" stroke-width="5" stroke-linecap="round"/>
    </svg>`
  }
];

// 2. 포맷 유틸리티
function formatPrice(num) {
  return Number(num).toLocaleString('ko-KR') + '원';
}

// 3. 인증 관련 모듈 (localStorage)
const AUTH_KEY = 'demo_shop_auth';
const CART_KEY = 'demo_shop_cart';
const LAST_ORDER_KEY = 'demo_shop_last_order';

const Auth = {
  isLoggedIn() {
    try {
      const data = localStorage.getItem(AUTH_KEY);
      if (!data) return false;
      const parsed = JSON.parse(data);
      return parsed && parsed.username === 'demo';
    } catch (e) {
      return false;
    }
  },

  getCurrentUser() {
    if (!this.isLoggedIn()) return null;
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY));
    } catch (e) {
      return null;
    }
  },

  login(username, password) {
    if (username === 'demo' && password === 'demo1234') {
      localStorage.setItem(AUTH_KEY, JSON.stringify({
        username: 'demo',
        loginTime: new Date().toISOString()
      }));
      return true;
    }
    return false;
  },

  logout() {
    localStorage.removeItem(AUTH_KEY);
    window.location.href = 'login.html';
  },

  requireAuth(targetUrl) {
    if (!this.isLoggedIn()) {
      const redirect = targetUrl || (window.location.pathname.split('/').pop() + window.location.search);
      window.location.replace(`login.html?next=${encodeURIComponent(redirect)}`);
      return false;
    }
    return true;
  }
};

// 4. 장바구니 관련 모듈 (localStorage)
const Cart = {
  getItems() {
    try {
      const data = localStorage.getItem(CART_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  saveItems(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    updateHeaderBadge();
  },

  getCount() {
    const items = this.getItems();
    return items.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
  },

  addItem(productId, quantity = 1) {
    const pId = Number(productId);
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const items = this.getItems();
    const existingIndex = items.findIndex(i => i.productId === pId);

    if (existingIndex > -1) {
      items[existingIndex].quantity += qty;
    } else {
      items.push({ productId: pId, quantity: qty });
    }
    this.saveItems(items);
  },

  updateQuantity(productId, quantity) {
    const pId = Number(productId);
    const qty = parseInt(quantity, 10);
    let items = this.getItems();

    if (qty <= 0) {
      items = items.filter(i => i.productId !== pId);
    } else {
      const item = items.find(i => i.productId === pId);
      if (item) {
        item.quantity = qty;
      }
    }
    this.saveItems(items);
  },

  removeItem(productId) {
    const pId = Number(productId);
    const items = this.getItems().filter(i => i.productId !== pId);
    this.saveItems(items);
  },

  clear() {
    localStorage.removeItem(CART_KEY);
    updateHeaderBadge();
  },

  getDetails() {
    const items = this.getItems();
    return items.map(item => {
      const product = PRODUCTS.find(p => p.id === item.productId);
      return {
        product: product || { id: item.productId, name: '상품 정보 없음', price: 0, svg: '' },
        quantity: item.quantity,
        subtotal: (product ? product.price : 0) * item.quantity
      };
    });
  },

  getTotalPrice() {
    return this.getDetails().reduce((acc, item) => acc + item.subtotal, 0);
  }
};

// 5. 공통 헤더 갱신 함수
function updateHeaderBadge() {
  const badgeEl = document.getElementById('cart-badge');
  if (badgeEl) {
    badgeEl.textContent = Cart.getCount();
  }
}

function initCommonHeader() {
  updateHeaderBadge();

  const authArea = document.getElementById('header-auth-area');
  if (authArea) {
    if (Auth.isLoggedIn()) {
      const user = Auth.getCurrentUser();
      authArea.innerHTML = `
        <span class="user-greeting" data-testid="user-greeting">${user ? user.username : 'demo'}님</span>
        <button id="logout-button" class="btn-logout" data-testid="logout-button">로그아웃</button>
      `;
      const logoutBtn = document.getElementById('logout-button');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
          e.preventDefault();
          Auth.logout();
        });
      }
    } else {
      authArea.innerHTML = `
        <a href="login.html" id="login-nav-link" class="nav-link" data-testid="login-nav-link">로그인</a>
      `;
    }
  }
}

// 6. 각 화면별 초기화 로직
document.addEventListener('DOMContentLoaded', () => {
  initCommonHeader();

  const page = document.body.dataset.page;
  switch (page) {
    case 'login':
      initLoginPage();
      break;
    case 'products':
      initProductsPage();
      break;
    case 'product-detail':
      initProductDetailPage();
      break;
    case 'cart':
      initCartPage();
      break;
    case 'checkout':
      initCheckoutPage();
      break;
    case 'complete':
      initCompletePage();
      break;
    default:
      // index.html 등 기타 페이지
      break;
  }
});

// 로그인 페이지 초기화
function initLoginPage() {
  const loginForm = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');

  // 이미 로그인되어 있는 상태라면 다음 목적지 또는 상품 목록으로 이동
  if (Auth.isLoggedIn()) {
    const urlParams = new URLSearchParams(window.location.search);
    const nextUrl = urlParams.get('next') || 'products.html';
    window.location.replace(nextUrl);
    return;
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value;

      if (Auth.login(username, password)) {
        if (errorBox) errorBox.style.display = 'none';
        const urlParams = new URLSearchParams(window.location.search);
        const nextUrl = urlParams.get('next') || 'products.html';
        window.location.href = nextUrl;
      } else {
        if (errorBox) {
          errorBox.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
          errorBox.style.display = 'flex';
        }
      }
    });
  }
}

// 상품 목록 페이지 초기화
function initProductsPage() {
  // 로그인 검증 (로그인 안 했으면 login.html 로)
  if (!Auth.requireAuth('products.html')) {
    return;
  }

  const productsGrid = document.getElementById('products-grid');
  const searchInput = document.getElementById('product-search');
  const countDisplay = document.getElementById('products-count');

  function renderList(query = '') {
    if (!productsGrid) return;
    const filtered = PRODUCTS.filter(p => 
      p.name.toLowerCase().includes(query.trim().toLowerCase())
    );

    if (countDisplay) {
      countDisplay.textContent = `총 ${filtered.length}개 상품`;
    }

    if (filtered.length === 0) {
      productsGrid.innerHTML = `
        <div class="no-products" data-testid="no-products-message">
          <p>검색 결과가 없습니다.</p>
        </div>
      `;
      return;
    }

    productsGrid.innerHTML = filtered.map(product => `
      <article class="product-card" data-testid="product-card-${product.id}">
        <div class="product-card-img">
          ${product.svg}
        </div>
        <div class="product-card-body">
          <span class="product-card-category">${product.category}</span>
          <h2 class="product-card-name">${product.name}</h2>
          <div class="product-card-bottom">
            <span class="product-card-price">${formatPrice(product.price)}</span>
            <a href="product.html?id=${product.id}" 
               class="btn btn-outline btn-sm" 
               aria-label="자세히 보기 — ${product.name}"
               data-testid="product-detail-${product.id}">
              자세히 보기
            </a>
          </div>
        </div>
      </article>
    `).join('');
  }

  renderList('');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderList(e.target.value);
    });
  }
}

// 상품 상세 페이지 초기화
function initProductDetailPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const productId = parseInt(urlParams.get('id'), 10);
  const product = PRODUCTS.find(p => p.id === productId);

  const container = document.getElementById('product-detail-container');
  if (!container) return;

  if (!product) {
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 60px 20px;">
        <h2 style="font-size: 20px; margin-bottom: 12px;">상품을 찾을 수 없습니다.</h2>
        <p style="color: var(--text-muted); margin-bottom: 24px;">요청하신 상품이 존재하지 않거나 판매가 종료되었습니다.</p>
        <a href="products.html" class="btn btn-primary">상품 목록으로 돌아가기</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="product-detail-layout">
      <div class="detail-img-box">
        ${product.svg}
      </div>
      <div class="detail-info">
        <span class="detail-category">${product.category}</span>
        <h1 class="detail-name" data-testid="product-name">${product.name}</h1>
        <div class="detail-price" data-testid="product-price">${formatPrice(product.price)}</div>
        <p class="detail-desc" data-testid="product-description">${product.description}</p>
        
        <div class="quantity-control">
          <label for="product-quantity">수량</label>
          <input type="number" id="product-quantity" name="quantity" class="quantity-input" min="1" max="99" value="1" data-testid="product-quantity">
        </div>

        <div id="cart-notice" class="alert alert-success" style="display: none;" role="status" data-testid="cart-notice">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
          <span>장바구니에 담았습니다.</span>
        </div>

        <div class="detail-actions">
          <button type="button" id="add-to-cart-btn" class="btn btn-primary btn-lg" data-testid="add-to-cart">
            장바구니에 담기
          </button>
          <a href="cart.html" id="go-to-cart-link" class="btn btn-secondary btn-lg" data-testid="go-to-cart">
            장바구니로 가기
          </a>
        </div>
      </div>
    </div>
  `;

  const addBtn = document.getElementById('add-to-cart-btn');
  const qtyInput = document.getElementById('product-quantity');
  const cartNotice = document.getElementById('cart-notice');

  if (addBtn && qtyInput) {
    addBtn.addEventListener('click', () => {
      const quantity = parseInt(qtyInput.value, 10) || 1;
      Cart.addItem(product.id, quantity);

      if (cartNotice) {
        cartNotice.style.display = 'flex';
        setTimeout(() => {
          // 일정 시간 후 부드럽게 유지하거나 계속 노출
        }, 3000);
      }
    });
  }
}

// 장바구니 페이지 초기화
function initCartPage() {
  const cartContent = document.getElementById('cart-content');
  if (!cartContent) return;

  function renderCart() {
    const details = Cart.getDetails();

    if (details.length === 0) {
      cartContent.innerHTML = `
        <div class="empty-cart-box">
          <div class="empty-cart-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="9" cy="21" r="1"></circle>
              <circle cx="20" cy="21" r="1"></circle>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>
          </div>
          <p class="empty-cart-message" data-testid="empty-cart-message">장바구니가 비어 있습니다.</p>
          <a href="products.html" class="btn btn-primary" data-testid="shop-now-link">쇼핑 계속하기</a>
        </div>
        <div class="order-summary-card">
          <h2 class="summary-title">주문 요약</h2>
          <div class="summary-row">
            <span>상품 금액</span>
            <span>0원</span>
          </div>
          <div class="summary-row">
            <span>배송비</span>
            <span>0원</span>
          </div>
          <div class="summary-total">
            <span>총 주문 금액</span>
            <span class="summary-total-price" data-testid="cart-total-price">0원</span>
          </div>
          <button id="cart-checkout-btn" class="btn btn-primary btn-block btn-lg" disabled data-testid="checkout-button">
            주문하기
          </button>
        </div>
      `;
      return;
    }

    const total = Cart.getTotalPrice();

    cartContent.innerHTML = `
      <div class="cart-layout">
        <div class="cart-table-wrap">
          <table class="cart-table">
            <thead>
              <tr>
                <th scope="col">상품 정보</th>
                <th scope="col" style="width: 120px;">수량</th>
                <th scope="col" style="width: 120px;">소계</th>
                <th scope="col" style="width: 80px; text-align: center;">관리</th>
              </tr>
            </thead>
            <tbody>
              ${details.map(item => `
                <tr data-testid="cart-row-${item.product.id}">
                  <td>
                    <div class="cart-item-info">
                      <div class="cart-item-thumb">
                        ${item.product.svg}
                      </div>
                      <div>
                        <a href="product.html?id=${item.product.id}" class="cart-item-name">${item.product.name}</a>
                        <div class="cart-item-unit-price">${formatPrice(item.product.price)}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <label for="cart-qty-${item.product.id}" class="sr-only">${item.product.name} 수량</label>
                    <input type="number" 
                           id="cart-qty-${item.product.id}" 
                           class="cart-qty-input" 
                           min="1" 
                           max="99" 
                           value="${item.quantity}"
                           aria-label="수량 — ${item.product.name}"
                           data-product-id="${item.product.id}"
                           data-testid="cart-qty-${item.product.id}">
                  </td>
                  <td>
                    <span class="cart-subtotal">${formatPrice(item.subtotal)}</span>
                  </td>
                  <td style="text-align: center;">
                    <button type="button" 
                            class="btn btn-danger btn-sm btn-remove-item" 
                            aria-label="삭제 — ${item.product.name}"
                            data-product-id="${item.product.id}"
                            data-testid="cart-remove-${item.product.id}">
                      삭제
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="order-summary-card">
          <h2 class="summary-title">주문 요약</h2>
          <div class="summary-row">
            <span>상품 금액</span>
            <span>${formatPrice(total)}</span>
          </div>
          <div class="summary-row">
            <span>배송비</span>
            <span>무료</span>
          </div>
          <div class="summary-total">
            <span>총 결제 예정 금액</span>
            <span class="summary-total-price" data-testid="cart-total-price">${formatPrice(total)}</span>
          </div>
          <a href="checkout.html" id="cart-checkout-btn" class="btn btn-primary btn-block btn-lg" data-testid="checkout-button">
            주문하기
          </a>
        </div>
      </div>
    `;

    // 수량 변경 이벤트 바인딩
    const qtyInputs = cartContent.querySelectorAll('.cart-qty-input');
    qtyInputs.forEach(input => {
      input.addEventListener('change', (e) => {
        const pId = Number(e.target.dataset.productId);
        const val = parseInt(e.target.value, 10);
        if (val > 0) {
          Cart.updateQuantity(pId, val);
          renderCart();
        } else {
          Cart.removeItem(pId);
          renderCart();
        }
      });
    });

    // 삭제 버튼 이벤트 바인딩
    const removeButtons = cartContent.querySelectorAll('.btn-remove-item');
    removeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pId = Number(btn.dataset.productId);
        Cart.removeItem(pId);
        renderCart();
      });
    });
  }

  renderCart();
}

// 결제 페이지 초기화
function initCheckoutPage() {
  const form = document.getElementById('checkout-form');
  const errorBox = document.getElementById('checkout-error');
  const nameInput = document.getElementById('receiver-name');
  const addressInput = document.getElementById('receiver-address');
  const phoneInput = document.getElementById('receiver-phone');
  const summaryItems = document.getElementById('checkout-items');
  const summaryTotal = document.getElementById('checkout-total-price');

  const items = Cart.getItems();
  if (items.length === 0) {
    window.location.replace('cart.html');
    return;
  }

  if (summaryItems && summaryTotal) {
    const details = Cart.getDetails();
    summaryItems.innerHTML = details.map(d => `
      <div class="summary-row">
        <span>${d.product.name} × ${d.quantity}</span>
        <span>${formatPrice(d.subtotal)}</span>
      </div>
    `).join('');
    summaryTotal.textContent = formatPrice(Cart.getTotalPrice());
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = nameInput ? nameInput.value.trim() : '';
      const address = addressInput ? addressInput.value.trim() : '';
      const phone = phoneInput ? phoneInput.value.trim() : '';

      if (!name || !address || !phone) {
        if (errorBox) {
          errorBox.textContent = '모든 필수 항목을 입력해 주세요.';
          errorBox.style.display = 'flex';
        }
        return;
      }

      // 결제 방법 선택 확인
      const paymentMethodRadio = document.querySelector('input[name="paymentMethod"]:checked');
      const paymentMethod = paymentMethodRadio ? paymentMethodRadio.value : 'card';

      // 주문 번호 생성 (예: ORD-20261101-4829)
      const now = new Date();
      const datePart = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
      const randomPart = Math.floor(1000 + Math.random() * 9000);
      const orderId = `ORD-${datePart}-${randomPart}`;

      const orderData = {
        orderId,
        items: Cart.getDetails(),
        totalPrice: Cart.getTotalPrice(),
        receiver: { name, address, phone },
        paymentMethod: paymentMethod === 'card' ? '신용/체크카드' : '실시간 계좌이체',
        orderedAt: now.toISOString()
      };

      // 주문 정보 저장 및 장바구니 비우기
      localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(orderData));
      Cart.clear();

      // 완료 페이지로 이동
      window.location.href = 'complete.html';
    });
  }
}

// 주문 완료 페이지 초기화
function initCompletePage() {
  const orderIdEl = document.getElementById('order-id');
  const orderPriceEl = document.getElementById('order-price');
  const orderReceiverEl = document.getElementById('order-receiver');

  try {
    const lastOrder = JSON.parse(localStorage.getItem(LAST_ORDER_KEY) || 'null');
    if (lastOrder) {
      if (orderIdEl) orderIdEl.textContent = lastOrder.orderId;
      if (orderPriceEl) orderPriceEl.textContent = formatPrice(lastOrder.totalPrice);
      if (orderReceiverEl) orderReceiverEl.textContent = `${lastOrder.receiver.name} (${lastOrder.receiver.address})`;
    } else {
      if (orderIdEl) orderIdEl.textContent = 'ORD-20261101-0000';
    }
  } catch (e) {
    if (orderIdEl) orderIdEl.textContent = 'ORD-20261101-0000';
  }
}
