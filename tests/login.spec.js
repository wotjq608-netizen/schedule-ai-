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
  await page.getByRole('link', { name: '일정 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '날씨와 착장 색 조합' })).toBeVisible();
  await page.getByRole('link', { name: '자료 정리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '회의·발표 자료 정리' })).toBeVisible();

  const example = {
    name: '저소음 키보드 테스트 모델', price: 49000, tier: '실속형', rating: 4.6, reviews: 25,
    note: '모의 상품평', url: 'https://example.com/product', review_url: 'https://example.com/reviews'
  };
  await page.route('**/api/assistant/compare', route => route.fulfill({ json: { products: [example] } }));
  await page.route('**/api/assistant/weather?*', route => route.fulfill({
    json: { region: '부산', temperature: 16, low: 12, high: 19, probability: 55, rain: 1 }
  }));
  await page.getByRole('button', { name: 'AI 챗봇' }).click();
  const input = page.getByRole('textbox', { name: '챗봇에게 보낼 문장' });
  const log = page.getByRole('log', { name: '대화', exact: true });
  const send = async text => {
    await input.fill(text);
    await input.press('Enter');
    await expect(page.getByRole('button', { name: '보내기', exact: true })).toBeEnabled();
  };
  await send('내일 7시에 알람 맞출 수 있어?');
  await expect(log).toContainText('알람을 설정할까요?');
  expect((await (await page.request.get('/api/assistant/alarms')).json()).alarms).toHaveLength(0);
  await send('네');
  await expect(log).toContainText('웹 알람을 설정했어요');
  await send('내일 8시에 알람 맞춰 줘');
  expect((await (await page.request.get('/api/assistant/alarms')).json()).alarms).toHaveLength(2);
  await send('저소음 키보드 찜해줘');
  await expect(log.getByRole('link', { name: '상품평 출처' })).toBeVisible();
  await send('1번 찜해줘');
  await expect(log.locator('[aria-label="찜 목록"]')).toContainText(example.name);
  await send('부산 내일 날씨랑 옷차림');
  await expect(log).toContainText('최대 강수확률 55퍼센트');
  await expect(log).toContainText('3색 착장');

  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/tasks')).status()).toBe(401);

  const admin = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    httpCredentials: { username: 'browser-test', password: 'browser-test-only', origin: baseURL },
  });
  try {
    const audit = await admin.newPage();
    await audit.goto('/login');
    await audit.getByRole('link', { name: '관리자 모드' }).click();
    await expect(audit.getByRole('heading', { name: '카카오 로그인 기록' })).toBeVisible();
    const rows = audit.getByRole('row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).getByRole('cell').first()).toHaveText(/^[a-f0-9]{24}$/);
    await expect(rows.nth(1).getByRole('cell').last()).toHaveText(/\+09:00$/);
    expect((await audit.request.get('/api/tasks')).status()).toBe(401);
  } finally {
    await admin.close();
  }
});
