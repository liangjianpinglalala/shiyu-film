import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
let seq = 0;
const base = Number("150" + String(Date.now()).slice(-8));
const phone = () => String(base + seq++);
async function login(page: Page, number = phone()) {
  await page.getByLabel("手机号码", { exact: true }).fill(number);
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(page.getByRole("button", { name: /后重新获取/ })).toBeVisible();
  await page.getByLabel("短信验证码", { exact: true }).fill("123456");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  return number;
}
async function home(page: Page) {
  await page.goto("/");
  await expect(page.locator("[data-ready=true]")).toBeVisible();
}
test("server login, refresh during job, download and account isolation", async ({
  page,
}) => {
  await home(page);
  await page.getByLabel("古诗名或成语").fill("静夜思");
  await page.getByRole("button", { name: "生成动画", exact: true }).click();
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "11 位",
  );
  await login(page);
  await expect(
    page.getByRole("heading", { name: "「静夜思」正在化作画面" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "静夜思", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载演示说明" }).click();
  expect((await download).suggestedFilename()).toBe("静夜思-演示说明.txt");
  await page
    .getByRole("button", { name: "返回我的作品", exact: false })
    .click();
  await page.getByRole("button", { name: "删除静夜思" }).click();
  await expect(page.getByText("你的第一部作品，即将诞生")).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await login(page);
  await expect(page.getByText("你的第一部作品，即将诞生")).toBeVisible();
});
test("mobile layout, settings, preview and sign out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "更多设置" }).click();
  await page.getByLabel("画面比例").selectOption("9:16 竖屏");
  await expect(page.locator(".creator-footer")).toContainText("9:16 竖屏");
  await page.getByRole("button", { name: /古诗动画 静夜思/ }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "分镜3" }).click();
  await expect(page.locator(".scene-caption")).toHaveText("举头望明月");
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await login(page);
  await page.getByRole("button", { name: "退出当前账户" }).click();
  await expect(
    page.getByRole("button", { name: "登录 / 注册", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
});
test("changing phone invalidates UI challenge and server rejects incorrect code", async ({
  page,
}) => {
  await home(page);
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page.getByLabel("手机号码", { exact: true }).fill(phone());
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(page.getByRole("button", { name: /后重新获取/ })).toBeVisible();
  await page.getByLabel("短信验证码", { exact: true }).fill("999999");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "不正确",
  );
  await page.getByLabel("手机号码", { exact: true }).fill(phone());
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录 / 注册", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "请先获取",
  );
});
test("desktop composition has no browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await home(page);
  await expect(
    page.getByRole("heading", { name: /让文字里的世界/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/desktop-home.png",
    fullPage: true,
  });
  for (const card of await page.locator(".card-art").all()) {
    const container = await card.boundingBox();
    const title = await card.locator(".art-title").boundingBox();
    expect(title!.y + title!.height).toBeLessThanOrEqual(
      container!.y + container!.height,
    );
  }
  expect(errors).toEqual([]);
});
const headers = { Origin: "http://127.0.0.1:3100" };
async function apiLogin(request: APIRequestContext, number: string) {
  expect(
    (
      await request.post("/api/auth/code", { headers, data: { phone: number } })
    ).status(),
  ).toBe(200);
  const response = await request.post("/api/auth/verify", {
    headers,
    data: { phone: number, code: "123456" },
  });
  expect(response.status()).toBe(200);
  return response;
}
test("API enforces auth, origins, ownership, revocation and one-use codes", async ({
  playwright,
}) => {
  const a = await playwright.request.newContext({
      baseURL: "http://127.0.0.1:3100",
    }),
    b = await playwright.request.newContext({
      baseURL: "http://127.0.0.1:3100",
    });
  try {
    expect((await a.get("/api/jobs")).status()).toBe(401);
    expect(
      (
        await a.post("/api/auth/code", {
          headers: { Origin: "https://evil.example" },
          data: { phone: phone() },
        })
      ).status(),
    ).toBe(403);
    const number = phone();
    const response = await apiLogin(a, number);
    expect(response.headers()["set-cookie"]).toContain("HttpOnly");
    expect(response.headers()["set-cookie"]).toContain("SameSite=lax");
    expect(
      (
        await a.post("/api/auth/verify", {
          headers,
          data: { phone: number, code: "123456" },
        })
      ).status(),
    ).toBe(400);
    const data = {
      title: "守株待兔",
      kind: "成语",
      ratio: "9:16 竖屏",
      age: "小学阶段",
    };
    const h = { ...headers, "Idempotency-Key": "unique-request-123456789" };
    const first = await a.post("/api/jobs", { headers: h, data });
    expect(first.status()).toBe(202);
    const { job } = await first.json();
    const duplicate = await a.post("/api/jobs", { headers: h, data });
    expect((await duplicate.json()).job.id).toBe(job.id);
    await apiLogin(b, phone());
    expect((await b.get("/api/jobs/" + job.id)).status()).toBe(404);
    expect((await b.get("/api/jobs/" + job.id + "/download")).status()).toBe(
      404,
    );
    expect(
      (await b.delete("/api/jobs/" + job.id, { headers, data: {} })).status(),
    ).toBe(404);
    const cookie = (await a.storageState()).cookies.find(
      (c) => c.name === "shiyu_session",
    )!;
    await a.post("/api/auth/logout", { headers, data: {} });
    expect(
      (
        await a.get("/api/jobs", {
          headers: { Cookie: "shiyu_session=" + cookie.value },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
