import { expect } from "chai";
import {
    checkBridgeResponse,
    checkCredentialFields,
    formatCheck,
    isLikelyClientId,
    normalizeRedirectUri,
    redirectUriWarning,
} from "../../src/setup-checks";

describe("setup checks", () => {
    it("recognizes Google OAuth client ID shape", () => {
        expect(isLikelyClientId("abc.apps.googleusercontent.com")).to.equal(true);
        expect(isLikelyClientId("abc")).to.equal(false);
    });

    it("trims redirect URIs and warns on non-HTTPS", () => {
        expect(normalizeRedirectUri("  https://example.com/bridge/  ")).to.equal(
            "https://example.com/bridge/",
        );
        expect(redirectUriWarning("http://example.com")).to.contain("https://");
        expect(redirectUriWarning("https://example.com")).to.equal(null);
    });

    it("formats actionable credential checks", () => {
        const checks = checkCredentialFields({
            clientId: "not-google",
            clientSecret: "",
            redirectUri: "https://example.com/bridge/",
        });
        expect(checks.map((c) => c.level)).to.deep.equal(["warn", "fail", "ok"]);
        expect(checks.map(formatCheck).join("\n")).to.contain("[!] OAuth client ID looks unusual");
    });

    describe("checkBridgeResponse", () => {
        it("passes a 200 response containing the bridge fingerprint", () => {
            const html =
                '<html><script>window.location.href = "obsidian://google-sync?code=abc&state=xyz";</script></html>';
            const { ok, message } = checkBridgeResponse(200, html);
            expect(ok).to.equal(true);
            expect(message).to.contain("live and ready");
        });

        it("fails a non-200 status", () => {
            const { ok, message } = checkBridgeResponse(404, "Not found");
            expect(ok).to.equal(false);
            expect(message).to.contain("HTTP 404");
        });

        it("fails a 200 response that lacks the bridge fingerprint", () => {
            const { ok, message } = checkBridgeResponse(200, "<html>Hello world</html>");
            expect(ok).to.equal(false);
            expect(message).to.contain("does not look like the expected bridge");
        });

        it("passes checking the single-file bridge HTML", () => {
            const html = [
                "<!doctype html>",
                '<html lang="en">',
                "<head>",
                "<script>",
                "function computeBridgeRedirect(search) {",
                '    const p = new URLSearchParams(search || "");',
                '    const error = p.get("error");',
                '    const code = p.get("code");',
                '    const state = p.get("state");',
                "    if (error) {",
                '        return { target: "obsidian://google-sync?error=" + encodeURIComponent(error) };',
                "    }",
                "</script>",
                "</html>",
            ].join("\n");
            const { ok } = checkBridgeResponse(200, html);
            expect(ok).to.equal(true);
        });
    });
});
