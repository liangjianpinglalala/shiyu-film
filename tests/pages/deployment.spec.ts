import { test, expect } from "@playwright/test";
test("Pages loads all assets from repository path and never calls backend", async ({
  page,
}) => {
  const failed: string[] = [];
  const apiCalls: string[] = [];
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) apiCalls.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  await expect(page.getByText("GitHub Pages · 展示版")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成动画", exact: true }),
  ).toBeDisabled();
  for (const img of await page.locator("img").all())
    expect(
      await img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    ).toBeTruthy();
  await page.getByRole("button", { name: /古诗动画 静夜思/ }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "分镜3", exact: true }).click();
  await expect(page.locator(".scene-caption")).toHaveText("举头望明月");
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "登录 / 注册", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "获取验证码", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "关闭登录" }).click();
  await page.getByRole("link", { name: "诗语映画首页" }).click();
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/shiyu-film/");
  expect(failed).toEqual([]);
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/pages-desktop.png",
    fullPage: true,
  });
});
test("Pages mobile layout and settings work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  await page.getByRole("button", { name: "更多设置" }).click();
  await page.getByLabel("画面比例").selectOption("9:16 竖屏");
  await expect(page.locator(".creator-footer")).toContainText("9:16 竖屏");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/pages-mobile.png",
    fullPage: true,
  });
});
