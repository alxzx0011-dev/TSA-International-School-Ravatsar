/* Forgot password → email OTP → reset password. */
(function () {
    "use strict";

    const API = window.SCHOOL_API || "";
    const REQUEST_TIMEOUT = 30000;

    let overlay = null;

    function build() {
        overlay = document.createElement("div");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.style.cssText = [
            "position:fixed", "inset:0", "z-index:9999",
            "display:flex", "align-items:center", "justify-content:center",
            "padding:18px", "background:rgba(6,18,43,.55)",
            "backdrop-filter:blur(3px)",
        ].join(";");

        overlay.innerHTML = `
            <div style="width:100%;max-width:440px;max-height:92vh;overflow:auto;background:#fff;
                        border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.28);padding:26px 24px;">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
                    <div>
                        <p style="margin:0;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#1e3f94;">ACCOUNT RECOVERY</p>
                        <h2 style="margin:6px 0 0;font-size:22px;color:#0c1f45;">Reset Password</h2>
                    </div>
                    <button type="button" data-close aria-label="Close"
                            style="border:0;background:#eff3fa;color:#34446a;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;">✕</button>
                </div>

                <form id="tsaForgotForm" style="display:flex;flex-direction:column;gap:4px;margin-top:14px;">
                    <div id="tsaStepOne">
                        <p style="margin:0 0 6px;font-size:13px;color:#56637f;">
                            Enter the email registered with the school. We will send a 6-digit code.
                        </p>
                        <label style="font-size:12px;font-weight:800;letter-spacing:.5px;color:#0c1f45;margin-top:10px;">EMAIL</label>
                        <input id="tsaForgotEmail" type="email" autocomplete="email" required
                               style="padding:12px 14px;border:1px solid #d7deec;border-radius:10px;font:inherit;">
                        <button type="submit" id="tsaSendCode"
                                style="margin-top:14px;padding:13px 18px;border:0;border-radius:10px;background:#0c1f45;color:#fff;font-weight:700;cursor:pointer;">
                            Send Code
                        </button>
                    </div>

                    <div id="tsaStepTwo" hidden>
                        <p style="margin:0 0 4px;font-size:13px;color:#56637f;">
                            Code sent to <strong id="tsaSentTo"></strong>. It expires in 10 minutes.
                        </p>

                        <label style="font-size:12px;font-weight:800;letter-spacing:.5px;color:#0c1f45;margin-top:12px;">6-DIGIT CODE</label>
                        <input id="tsaOtp" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="one-time-code" required
                               style="padding:12px 14px;border:1px solid #d7deec;border-radius:10px;font:inherit;letter-spacing:5px;font-size:18px;">

                        <label style="font-size:12px;font-weight:800;letter-spacing:.5px;color:#0c1f45;margin-top:12px;">NEW PASSWORD</label>
                        <input id="tsaNewPass" type="password" minlength="8" autocomplete="new-password" required
                               style="padding:12px 14px;border:1px solid #d7deec;border-radius:10px;font:inherit;">

                        <label style="font-size:12px;font-weight:800;letter-spacing:.5px;color:#0c1f45;margin-top:12px;">CONFIRM NEW PASSWORD</label>
                        <input id="tsaConfirmPass" type="password" minlength="8" autocomplete="new-password" required
                               style="padding:12px 14px;border:1px solid #d7deec;border-radius:10px;font:inherit;">

                        <button type="submit" id="tsaResetBtn"
                                style="margin-top:14px;padding:13px 18px;border:0;border-radius:10px;background:#0c1f45;color:#fff;font-weight:700;cursor:pointer;">
                            Reset Password
                        </button>

                        <div style="display:flex;justify-content:space-between;gap:12px;margin-top:6px;">
                            <button type="button" id="tsaResendBtn"
                                    style="border:0;background:none;color:#1e3f94;font:inherit;font-size:13px;font-weight:700;cursor:pointer;padding:6px 0;">
                                Resend code
                            </button>
                            <button type="button" id="tsaChangeEmail"
                                    style="border:0;background:none;color:#56637f;font:inherit;font-size:13px;cursor:pointer;padding:6px 0;">
                                Use a different email
                            </button>
                        </div>
                    </div>

                    <p id="tsaForgotStatus" style="min-height:20px;margin:12px 0 0;font-size:13px;"></p>
                </form>
            </div>`;

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay || event.target.closest("[data-close]")) close();
        });
        document.addEventListener("keydown", onKey);

        overlay.querySelector("#tsaForgotForm").addEventListener("submit", submit);
        overlay.querySelector("#tsaResendBtn").addEventListener("click", () => sendCode(true));
        overlay.querySelector("#tsaChangeEmail").addEventListener("click", showStepOne);

        document.body.append(overlay);
        overlay.querySelector("#tsaForgotEmail").focus();
    }

    function onKey(event) {
        if (event.key === "Escape") close();
    }

    function close() {
        if (!overlay) return;
        overlay.remove();
        overlay = null;
        document.removeEventListener("keydown", onKey);
    }

    function status(text, kind) {
        const el = overlay.querySelector("#tsaForgotStatus");
        el.textContent = text || "";
        el.style.color = kind === "error" ? "#b3261e" : kind === "ok" ? "#1e3f94" : "#56637f";
    }

    function setBusy(button, busy, label) {
        button.disabled = busy;
        button.textContent = busy ? "Please wait…" : label;
    }

    function showStepOne() {
        overlay.querySelector("#tsaStepOne").hidden = false;
        overlay.querySelector("#tsaStepTwo").hidden = true;
        status("");
        overlay.querySelector("#tsaForgotEmail").focus();
    }

    function showStepTwo(email) {
        overlay.querySelector("#tsaStepOne").hidden = true;
        overlay.querySelector("#tsaStepTwo").hidden = false;
        overlay.querySelector("#tsaSentTo").textContent = email;
        status("");
        overlay.querySelector("#tsaOtp").focus();
    }

    async function post(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        try {
            const response = await fetch(API + path, {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
            });
            const data = await response.json().catch(() => ({}));
            return { ok: response.ok, data };
        } finally {
            clearTimeout(timer);
        }
    }

    async function sendCode(isResend) {
        const input = overlay.querySelector("#tsaForgotEmail");
        const email = input.value.trim();
        if (!email) {
            status("Enter your email address.", "error");
            return;
        }

        const button = isResend
            ? overlay.querySelector("#tsaResendBtn")
            : overlay.querySelector("#tsaSendCode");

        button.disabled = true;
        status("Sending…");

        try {
            const result = await post("/auth/forgot-password", { email });
            if (!result.ok && result.data.detail) {
                status(String(result.data.detail), "error");
                return;
            }
            showStepTwo(email);
            status(
                isResend
                    ? "If this email is registered, a new code has been sent."
                    : "Check your inbox and spam folder for the 6-digit code.",
                "ok"
            );
        } catch (err) {
            status(
                err && err.name === "AbortError"
                    ? "The server is taking too long. Please try again."
                    : "Could not reach the server. Check your connection.",
                "error"
            );
        } finally {
            button.disabled = false;
        }
    }

    async function submit(event) {
        event.preventDefault();

        const stepTwoVisible = !overlay.querySelector("#tsaStepTwo").hidden;
        if (!stepTwoVisible) {
            await sendCode(false);
            return;
        }

        const email = overlay.querySelector("#tsaForgotEmail").value.trim();
        const otp = overlay.querySelector("#tsaOtp").value.trim();
        const next = overlay.querySelector("#tsaNewPass").value;
        const confirm = overlay.querySelector("#tsaConfirmPass").value;

        if (!/^\d{6}$/.test(otp)) {
            status("Enter the 6-digit code from the email.", "error");
            return;
        }
        if (next.length < 8) {
            status("The new password must be at least 8 characters.", "error");
            return;
        }
        if (next !== confirm) {
            status("The two new passwords do not match.", "error");
            return;
        }

        const button = overlay.querySelector("#tsaResetBtn");
        setBusy(button, true, "Reset Password");
        status("Resetting…");

        try {
            const result = await post("/auth/reset-password", {
                email,
                otp,
                new_password: next,
            });

            if (!result.ok) {
                status(
                    typeof result.data.detail === "string"
                        ? result.data.detail
                        : "The password could not be reset.",
                    "error"
                );
                setBusy(button, false, "Reset Password");
                return;
            }

            overlay.querySelector("#tsaStepTwo").hidden = true;
            overlay.querySelector("#tsaStepOne").hidden = true;
            status("Password updated successfully. You can now sign in.", "ok");

            const closeRow = document.createElement("button");
            closeRow.type = "button";
            closeRow.textContent = "Back to Sign In";
            closeRow.style.cssText = "margin-top:14px;padding:13px 18px;border:0;border-radius:10px;background:#0c1f45;color:#fff;font-weight:700;cursor:pointer;width:100%;";
            closeRow.addEventListener("click", close);
            overlay.querySelector("#tsaForgotForm").append(closeRow);
        } catch (err) {
            status(
                err && err.name === "AbortError"
                    ? "The server is taking too long. Please try again."
                    : "Could not reach the server. Check your connection.",
                "error"
            );
            setBusy(button, false, "Reset Password");
        }
    }

    function open() {
        if (overlay) return;
        build();
    }

    window.TSAOpenForgotPassword = open;

    function bind() {
        document.querySelectorAll("[data-forgot-password]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                open();
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bind);
    } else {
        bind();
    }
})();
