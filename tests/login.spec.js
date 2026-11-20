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
  await expect(page).toHaveURL(baseURL + '/');
  expect((await page.request.get('/api/tasks')).status()).toBe(200);
  expect((await page.request.get('/admin')).status()).toBe(401);
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
