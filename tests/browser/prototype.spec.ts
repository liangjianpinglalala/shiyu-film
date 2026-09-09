import { test, expect } from "@playwright/test";
async function login(page: any, phone = "13800138000") {
  await page.getByLabel("手机号码", { exact: true }).fill(phone);
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await page.getByLabel("短信验证码", { exact: true }).fill("123456");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .click();
}
test("login validation, creation, download and account isolation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  await page.getByLabel("古诗名或成语").fill("静夜思");
  await page.getByRole("button", { name: "生成动画", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "11 位",
  );
  await page.getByLabel("手机号码", { exact: true }).fill("13800138000");
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await page.getByLabel("短信验证码", { exact: true }).fill("999999");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "不正确",
  );
  await page.getByLabel("短信验证码", { exact: true }).fill("123456");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "「静夜思」正在化作画面" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "静夜思", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载演示说明" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "静夜思-演示说明.txt",
  );
  await page.reload();
  await page
    .getByRole("button", { name: /我的作品/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "静夜思", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page
    .getByRole("button", { name: /我的作品/ })
    .first()
    .click();
  await login(page, "13900139000");
  await expect(page.getByText("你的第一部作品，即将诞生")).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page
    .getByRole("button", { name: /我的作品/ })
    .first()
    .click();
  await login(page);
  await page.getByRole("button", { name: "删除静夜思" }).click();
  await expect(page.getByText("你的第一部作品，即将诞生")).toBeVisible();
});
test("mobile layout, settings and preview controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "更多设置" }).click();
  await page.getByLabel("画面比例").selectOption("9:16 竖屏");
  await expect(page.locator(".creator-footer")).toContainText("9:16 竖屏");
  await page.getByRole("button", { name: /古诗动画 静夜思/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "分镜3", exact: true }).click();
  await expect(page.locator(".scene-caption")).toHaveText("举头望明月");
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
});
test("desktop composition and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /让文字里的世界/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/desktop-home.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("verification expires and changing phone invalidates it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page.getByLabel("手机号码", { exact: true }).fill("13800138000");
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await page.getByLabel("手机号码", { exact: true }).fill("13900139000");
  await page.getByLabel("短信验证码", { exact: true }).fill("123456");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "请先获取",
  );
  await page.clock.install();
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  for (let i = 0; i < 61; i++) await page.clock.runFor(1000);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "请先获取",
  );
  await page.screenshot({ path: "test-results/login-mobile.png" });
});

test("mobile user can sign out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await login(page);
  await page.getByRole("button", { name: "退出当前账户" }).click();
  await expect(
    page.getByRole("button", { name: "登录 / 注册", exact: true }),
  ).toBeVisible();
});
