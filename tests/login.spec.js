const { test, expect } = require('@playwright/test');

test('카카오 로그인 성공만 기록되고 관리자만 조회할 수 있다', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  const invalid = await page.request.get('/auth/kakao/callback?state=wrong&code=test-authorization-code');
  await expect(invalid).toBeOK();
  expect(invalid.url()).toContain('error=failed');

  const kakaoLink = page.locator('a[href="/auth/kakao"]');
  await expect(kakaoLink).toBeVisible();
  const start = await page.request.get(await kakaoLink.getAttribute('href'), { maxRedirects: 0 });
  expect(start.status()).toBe(303);
  const authorize = new URL(start.headers().location);
  expect(authorize.origin + authorize.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
  expect(authorize.searchParams.get('client_id')).toBe('fake-kakao-project');
  const redirect = new URL(authorize.searchParams.get('redirect_uri'));
  expect(redirect.origin).toBe(baseURL);
  redirect.searchParams.set('state', authorize.searchParams.get('state'));
  redirect.searchParams.set('code', 'test-authorization-code');
  await page.goto(redirect.href);
  await expect(page).toHaveURL(baseURL + '/architecture');
  expect((await page.request.get('/api/tasks')).status()).toBe(200);
  expect((await page.request.get('/admin')).status()).toBe(401);
  await expect(page.getByRole('heading', { name: '서비스 구성도' })).toBeVisible();
  await page.route('**/api/weather?*', route => {
    const city = new URL(route.request().url()).searchParams.get('city');
    return route.fulfill({ json: { region: city || '서울', temperature: city === '부산' ? 21 : 4,
      precipitation: 0, probability: 20, rain: 0 } });
  });
  await page.getByRole('link', { name: '일정 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '날씨와 착장 색 조합' })).toBeVisible();
  await page.getByLabel('지역', { exact: true }).selectOption('부산');
  await expect(page.locator('#weather')).toContainText('부산 21°C');
  await expect(page.locator('#palettes article')).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel('지역', { exact: true })).toHaveValue('부산');
  await expect(page.locator('#weather')).toContainText('부산 21°C');

  await page.getByRole('link', { name: '자료 정리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '회의·발표 자료 정리' })).toBeVisible();

  const example = {
    name: '저소음 키보드 테스트 모델', price: 49000, tier: '실속형', rating: 4.6, reviews: 25,
    note: '모의 상품평', url: 'https://example.com/product', review_url: 'https://example.com/reviews'
  };
  await page.route('**/api/assistant/interpret', async route => {
    const text = route.request().postDataJSON().text;
    const intent = text === '부산에서 우산 챙길까?' ? {
      action: 'weather', mode: 'information', city: '부산', day: 1, query: '', alarm_at: ''
    } : null;
    await route.fulfill({ json: { intent } });
  });
  const recommendations = [
    example,
    { ...example, name: '테스트 중간 모델', tier: '중간 가격대', price: 89000 },
    { ...example, name: '테스트 고급 모델', tier: '프리미엄', price: 139000 }
  ];
  await page.route('**/api/assistant/compare', route => route.fulfill({ json: { products: recommendations } }));
  await page.route('**/api/assistant/weather?*', route => route.fulfill({
    json: { region: '부산', temperature: 16, low: 12, high: 19, probability: 55, rain: 1 }
  }));
  await page.getByRole('button', { name: 'AI 챗봇' }).click();
  const input = page.getByRole('textbox', { name: '챗봇에게 보낼 문장' });
  const log = page.getByRole('log', { name: '대화', exact: true });
  const send = async text => {
    await input.fill(text);
    await input.press('Enter');
    await expect(page.locator('#assistant-send')).toBeEnabled();
  };
  await send('내일 7시에 알람 맞출 수 있어?');
  await expect(log).toContainText('알람을 설정할까요?');
  expect((await (await page.request.get('/api/assistant/alarms')).json()).alarms).toHaveLength(0);
  await send('네');
  await expect(log).toContainText('웹 알람을 설정했어요');
  await send('내일 8시에 알람 맞춰 줘');
  expect((await (await page.request.get('/api/assistant/alarms')).json()).alarms).toHaveLength(2);
  await send('저소음 키보드 찜해줘');
  await expect(log.getByRole('link', { name: '상품평 출처' })).toHaveCount(3);
  await page.getByRole('link', { name: '쇼핑', exact: true }).click();
  await expect(page.getByRole('heading', { name: '찜 목록' })).toBeVisible();
  const shopping = page.getByRole('textbox', { name: '챗봇으로 상품 찾기' });
  const cards = page.locator('#shop-recommendations article');
  await expect(cards).toHaveCount(3);
  await shopping.fill('저소음 키보드 추천해줘');
  await shopping.press('Enter');
  await expect(page.locator('#assistant-panel')).toBeHidden();
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(2)).toContainText('139,000원');
  await expect(cards.first()).toContainText('모의 상품평');
  await page.getByRole('button', { name: 'AI 챗봇' }).click();
  await expect(log.getByRole('heading', { name: /저소음 키보드 테스트 모델/ })).toBeVisible();
  await input.fill('첫 번째 상품 찜 목록에 추가해줘');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/shop#saved$/);
  await expect(page.getByRole('heading', { name: '찜 목록' })).toBeVisible();
  await expect(page.locator('#saved').getByRole('heading', { name: example.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI 챗봇' }).click();
  await send('부산에서 우산 챙길까?');
  await expect(log).toContainText('최대 강수확률 55퍼센트');
  await expect(log).toContainText('3색 착장');

  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/tasks')).status()).toBe(401);

  await page.getByRole('button', { name: '게스트로 입장' }).click();
  await expect(page).toHaveURL(baseURL + '/architecture');
  await expect(page.getByText(/게스트 모드 · 입력 기록/)).toBeVisible();
  expect((await (await page.request.get('/api/tasks')).json()).tasks).toEqual([]);
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login$/);

  const admin = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    httpCredentials: { username: 'browser-test', password: 'browser-test-only', origin: baseURL },
  });
  try {
    const audit = await admin.newPage();
    await audit.goto('/login');
    await audit.getByRole('link', { name: '관리자 모드' }).click();
    await expect(audit.getByRole('heading', { name: '로그인 기록' })).toBeVisible();
    const rows = audit.getByRole('row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).getByRole('cell').first()).toHaveText(/^[a-f0-9]{24}$/);
    await expect(rows.nth(1).getByRole('cell').nth(1)).toHaveText(/\+09:00$/);
    await expect(rows.nth(1).getByRole('cell').nth(2)).toHaveText('127.0.0.1');
    await expect(audit.getByRole('heading', { name: '관리자 대시보드' })).toBeVisible();
    await expect(audit.getByRole('region', { name: '이용 현황' })).toContainText('예정 알람');
    await audit.getByRole('textbox', { name: '계정 식별자 또는 IP 검색' }).fill('127.0.0.1');
    await audit.getByRole('button', { name: '검색' }).click();
    await expect(audit.getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveText('127.0.0.1');
    expect((await audit.request.get('/api/tasks')).status()).toBe(401);
  } finally {
    await admin.close();
  }
});
