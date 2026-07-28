// Marveluzz Hub - Authentication Integration & Mock OAuth Test Suite
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.208.0/path/mod.ts";

const mainTsPath = join(fromFileUrl(import.meta.url), "../../src/main.ts");

Deno.test("Authentication Suite: Local Session Lifecycle & Mock Login (MOCK_AUTH=true)", async (t) => {
  const port = "8008";
  const serverProc = new Deno.Command("deno", {
    args: ["run", "--allow-net", "--allow-env", "--allow-read", mainTsPath],
    env: {
      PORT: port,
      DISABLE_AUTH: "false",
      MOCK_AUTH: "true",
      ALLOWED_GITHUB_USERS: "alice,bob",
      GITHUB_CLIENT_ID: "mock_client_id",
      GITHUB_CLIENT_SECRET: "mock_client_secret"
    }
  }).spawn();

  await new Promise(resolve => setTimeout(resolve, 1000));
  const baseUrl = `http://localhost:${port}`;
  let activeSessionId = "";

  try {
    await t.step("Unauthenticated request to protected route redirects to /login", async () => {
      const unauthRes = await fetch(`${baseUrl}/devices`, { redirect: "manual" });
      assertEquals(unauthRes.status, 302);
      assertEquals(unauthRes.headers.get("location"), `${baseUrl}/login`);
      await unauthRes.body?.cancel();
    });

    await t.step("Login page renders Mock Auth warnings and developer form", async () => {
      const loginPageRes = await fetch(`${baseUrl}/login`);
      assertEquals(loginPageRes.status, 200);
      const loginHtml = await loginPageRes.text();
      assertEquals(loginHtml.includes("Mock Authentication Active"), true);
      assertEquals(loginHtml.includes("Developer Login"), true);
    });

    await t.step("Unauthorized user ('charlie') login attempt is rejected", async () => {
      const githubRedirectRes = await fetch(`${baseUrl}/login/github?mock_code=charlie`, { redirect: "manual" });
      assertEquals(githubRedirectRes.status, 302);
      const callbackUrl = githubRedirectRes.headers.get("location") || "";
      assertEquals(callbackUrl, `${baseUrl}/login/callback?code=charlie`);
      await githubRedirectRes.body?.cancel();

      const failLoginRes = await fetch(callbackUrl, { redirect: "manual" });
      assertEquals(failLoginRes.status, 302);
      assertEquals(failLoginRes.headers.get("location"), `${baseUrl}/login?error=not_allowed`);
      assertEquals(failLoginRes.headers.get("set-cookie"), null);
      await failLoginRes.body?.cancel();
    });

    await t.step("Allowed user ('alice') logs in successfully and receives session cookie", async () => {
      const githubRedirectSuccessRes = await fetch(`${baseUrl}/login/github?mock_code=alice`, { redirect: "manual" });
      assertEquals(githubRedirectSuccessRes.status, 302);
      const callbackSuccessUrl = githubRedirectSuccessRes.headers.get("location") || "";
      assertEquals(callbackSuccessUrl, `${baseUrl}/login/callback?code=alice`);
      await githubRedirectSuccessRes.body?.cancel();

      const successLoginRes = await fetch(callbackSuccessUrl, { redirect: "manual" });
      assertEquals(successLoginRes.status, 302);
      assertEquals(successLoginRes.headers.get("location"), "/");

      const cookieHeader = successLoginRes.headers.get("set-cookie");
      assertNotEquals(cookieHeader, null);

      const cookieMatch = cookieHeader!.match(/marveluzz_session=([^;]+)/);
      assertNotEquals(cookieMatch, null);
      activeSessionId = cookieMatch![1];
      assertNotEquals(activeSessionId, "");
      await successLoginRes.body?.cancel();
    });

    await t.step("Authenticated page load succeeds with valid session cookie", async () => {
      const authPageRes = await fetch(`${baseUrl}/devices`, {
        headers: { "Cookie": `marveluzz_session=${activeSessionId}` }
      });
      assertEquals(authPageRes.status, 200);
      const htmlText = await authPageRes.text();
      assertEquals(htmlText.includes("Marveluzz Hub"), true);

      const configRes = await fetch(`${baseUrl}/api/config`, {
        headers: { "Cookie": `marveluzz_session=${activeSessionId}` }
      });
      assertEquals(configRes.status, 200);
      const configJson = await configRes.json();
      assertEquals(configJson.disableAuth, false);
      assertEquals(configJson.mockAuth, true);
    });

    await t.step("Logout routine invalidates active session and clears cookie", async () => {
      const logoutRes = await fetch(`${baseUrl}/logout`, {
        method: "GET",
        headers: { "Cookie": `marveluzz_session=${activeSessionId}` },
        redirect: "manual"
      });
      assertEquals(logoutRes.status, 302);
      assertEquals(logoutRes.headers.get("location"), "/login");

      const expiredCookieHeader = logoutRes.headers.get("set-cookie") || "";
      assertEquals(expiredCookieHeader.includes("Max-Age=0") || expiredCookieHeader.includes("Expires=Thu, 01 Jan 1970"), true);
      await logoutRes.body?.cancel();
    });

    await t.step("Subsequent request with logged-out cookie gets rejected", async () => {
      const postLogoutRes = await fetch(`${baseUrl}/devices`, {
        headers: { "Cookie": `marveluzz_session=${activeSessionId}` },
        redirect: "manual"
      });
      assertEquals(postLogoutRes.status, 302);
      assertEquals(postLogoutRes.headers.get("location"), `${baseUrl}/login`);
      await postLogoutRes.body?.cancel();
    });
  } finally {
    try {
      serverProc.kill();
      await serverProc.status;
    } catch {
      // ignore
    }
  }
});

Deno.test("Authentication Suite: Production GitHub OAuth Gateway (MOCK_AUTH=false)", async (t) => {
  const oauthPort = "8009";
  const serverProc = new Deno.Command("deno", {
    args: ["run", "--allow-net", "--allow-env", "--allow-read", mainTsPath],
    env: {
      PORT: oauthPort,
      DISABLE_AUTH: "false",
      MOCK_AUTH: "false",
      GITHUB_CLIENT_ID: "github_app_client_id_123",
      GITHUB_CLIENT_SECRET: "github_app_client_secret_456"
    }
  }).spawn();

  await new Promise(resolve => setTimeout(resolve, 1000));
  const baseUrl = `http://localhost:${oauthPort}`;

  try {
    await t.step("/login/github redirects to github.com/login/oauth/authorize with client_id", async () => {
      const githubOAuthRes = await fetch(`${baseUrl}/login/github`, { redirect: "manual" });
      assertEquals(githubOAuthRes.status, 302);
      const targetUrl = githubOAuthRes.headers.get("location") || "";
      assertEquals(targetUrl.startsWith("https://github.com/login/oauth/authorize"), true);
      assertEquals(targetUrl.includes("client_id=github_app_client_id_123"), true);
      await githubOAuthRes.body?.cancel();
    });

    await t.step("/login/callback without authorization code redirects to /login?error=oauth_failed", async () => {
      const noCodeRes = await fetch(`${baseUrl}/login/callback`, { redirect: "manual" });
      assertEquals(noCodeRes.status, 302);
      assertEquals(noCodeRes.headers.get("location"), `${baseUrl}/login?error=oauth_failed`);
      await noCodeRes.body?.cancel();
    });
  } finally {
    try {
      serverProc.kill();
      await serverProc.status;
    } catch {
      // ignore
    }
  }
});
