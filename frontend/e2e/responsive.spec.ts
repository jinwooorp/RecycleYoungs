import { expect, noOverflow, test } from './test-support';

test('320×568에서 키보드로 상세 패널을 열고 스크롤하며 지역 필터를 조작한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/explore');

  const menu = page.getByRole('button', { name: '상권 분석', exact: true });
  const panel = page.getByRole('complementary', { name: '상권 분석' });
  const title = panel.getByRole('heading', { name: '상권 분석', level: 2 });
  const close = panel.getByRole('button', { name: '상권 분석 패널 닫기' });

  await menu.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(title).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();

  const filter = page.getByRole('button', { name: '지역 필터', exact: true });
  const controls = page.getByRole('group', { name: '지역 필터' });
  const district = controls.getByRole('combobox', { name: '자치구' });
  const notice = page.getByText('지도와 검색 서비스를 불러오지 못했습니다.', {
    exact: true,
  });
  const retry = page.getByRole('button', {
    name: '검색 서비스 다시 시도',
    exact: true,
  });
  const noticeCard = page
    .getByRole('search', { name: '장소 검색', exact: true })
    .locator(':scope > div')
    .filter({ has: notice })
    .filter({ has: retry });
  await expect(filter).toBeInViewport({ ratio: 1 });
  await expect(noticeCard).toBeInViewport({ ratio: 1 });
  const filterBox = (await filter.boundingBox())!;
  const cardBox = (await noticeCard.boundingBox())!;
  expect(filterBox.y + filterBox.height).toBeLessThanOrEqual(cardBox.y);

  await filter.click();
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(controls).toBeVisible();
  await expect(district).toBeEnabled();
  await district.selectOption('11440');
  await district.press('Escape');
  await expect(controls).toBeHidden();
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(filter).toBeFocused();
  await expect(filter).toContainText('마포구');

  await menu.press('Enter');
  await expect(title).toBeFocused();
  await expect(
    panel.getByRole('region', { name: '점포 수 요약' }),
  ).toContainText('120');
  // 패널 전환이 끝나 닫기 버튼을 누를 수 있는 위치에서 스크롤을 검사합니다.
  await close.click({ trial: true });
  // 일반 클릭과 같은 조작 가능 여부를 확인하되 SDK 재시도는 실행하지 않습니다.
  await retry.click({ trial: true });
  const stores = panel.getByRole('tab', { name: '점포 현황' });
  await expect(stores).not.toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(stores).toBeFocused();
  await expect(stores).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => innerWidth)).toBe(320);
  await noOverflow(page);
});

test('768×1024와 1024×768 전환에서 지역 선택과 포커스를 유지한다', async ({
  page,
}) => {
  const compact = { width: 768, height: 1024 };
  const wide = { width: 1024, height: 768 };
  await page.setViewportSize(compact);
  await page.goto('/explore');

  const filter = page.getByRole('button', { name: '지역 필터', exact: true });
  const controls = page.getByRole('group', { name: '지역 필터' });
  const district = controls.getByRole('combobox', { name: '자치구' });

  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(controls).toBeHidden();
  await filter.click();
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(controls).toBeVisible();
  await expect(district).toBeEnabled();
  await district.selectOption('11440');
  await district.focus();
  await expect(district).toBeFocused();

  await page.setViewportSize(wide);
  await expect(filter).toBeHidden();
  await expect(controls).toBeVisible();
  await expect(district).toHaveValue('11440');
  await expect(district).toBeFocused();
  await noOverflow(page);

  await page.setViewportSize(compact);
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(filter).toBeFocused();
  await expect(filter).toContainText('마포구');
  await expect(controls).toBeHidden();

  await page.keyboard.press('Enter');
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(district).toHaveValue('11440');
  await expect(district).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(controls).toBeHidden();
  await expect(filter).toBeFocused();

  // 화면을 넓히면 사라지는 모바일 버튼의 포커스를 표시 중인 필터로 넘깁니다.
  await page.setViewportSize(wide);
  await expect(filter).toBeHidden();
  await expect(district).toBeFocused();
  await page.setViewportSize(compact);
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(filter).toBeFocused();
  await expect(controls).toBeHidden();
  await noOverflow(page);
});
