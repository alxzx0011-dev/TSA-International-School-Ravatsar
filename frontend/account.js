/* Shared "Change password" dialog used by every portal. */
(function () {
    "use strict";

    let overlay = null;
    let options = null;

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[ch]));
    }

    function build() {
        overlay = document.createElement("div");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.style.cssText = [
            "position:fixed", "inset:0", "z-index:9999",
            "display:flex", "align-items:center", "justify-content:center",
            "padding:18px", "background:rgba(6,28,22,.55)",
            "backdrop-filter:blur(3px)",
        ].join(";");

        overlay.innerHTML = `
            <div style="width:100%;max-width:430px;background:#fff;border-radius:18px;
                        box-shadow:0 24px 70px rgba(0,0,0,.28);padding:26px 24px;">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
                    <div>
                        <p style="margin:0;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#0b6b4f;">ACCOUNT SECURITY</p>
                        <h2 style="margin:6px 0 0;font-size:22px;color:#0b3d2e;">Change Password</h2>
                    </div>
                    <button type="button" data-close aria-label="Close"
                            style="border:0;background:#eef4f1;color:#31564a;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;">✕</button>
                </div>

                <form id="tsaPasswordForm" style="display:flex;flex-direction:column;gap:4px;margin-top:16px;">
                    <label style="font-size:12px;font-weight:800;letter-spacing:.5px;color:#0b3d2e;margin-top:10px;">CURRENT PASSWORD</label>
                    <input id="tsaCurrentPassword" type="password" autocomplete="current-password" required
                           style="padding:12px 14px;border:1px solid #cfe0d8;border-radius:10px;font:inherit;">
                    <label style="font-size:12px;font-weight:800;letter-spacing:.5px;color:#0b3d2e;margin-top:12px;">NEW PASSWORD</label>
                    <input id="tsaNewPassword" type="password" autocomplete="new-password" minlength="8" required
                           style="padding:12px 14px;border:1px solid #cfe0d8;border-radius:10px;font:inherit;">
                    <label style="font-size:12px;font-weight:800;letter-spacing:.5px;color:#0b3d2e;margin-top:12px;">CONFIRM NEW PASSWORD</label>
                    <input id="tsaConfirmPassword" type="password" autocomplete="new-password" minlength="8" required
                           style="padding:12px 14px;border:1px solid #cfe0d8;border-radius:10px;font:inherit;">
                    <p id="tsaPasswordStatus" style="min-height:20px;margin:12px 0 0;font-size:13px;"></p>
                    <button type="submit" id="tsaPasswordSave"
                            style="margin-top:6px;padding:13px 18px;border:0;border-radius:10px;background:#0b3d2e;color:#fff;font-weight:700;cursor:pointer;">
                        Update Password
                    </button>
                </form>
            </div>`;

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay || event.target.closest("[data-close]")) close();
        });

        document.addEventListener("keydown", onKey);

        overlay.querySelector("#tsaPasswordForm").addEventListener("submit", submit);
        document.body.append(overlay);
        overlay.querySelector("#tsaCurrentPassword").focus();
    }

    function onKey(event) {
        if (event.key === "Escape") close();
    }

    function status(text, kind) {
        const el = overlay.querySelector("#tsaPasswordStatus");
        el.textContent = text || "";
        el.style.color = kind === "error" ? "#b3261e" : kind === "ok" ? "#0b6b4f" : "#5b7268";
    }

    async function submit(event) {
        event.preventDefault();
        if (!overlay) return;

        const current = overlay.querySelector("#tsaCurrentPassword").value;
        const next = overlay.querySelector("#tsaNewPassword").value;
        const confirm = overlay.querySelector("#tsaConfirmPassword").value;

        if (next.length < 8) {
            status("New password must be at least 8 characters.", "error");
            return;
        }
        if (next !== confirm) {
            status("The two new passwords do not match.", "error");
            return;
        }

        const button = overlay.querySelector("#tsaPasswordSave");
        button.disabled = true;
        button.textContent = "Saving…";
        status("Saving…");

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);

        try {
            const token = localStorage.getItem(options.tokenKey);
            const response = await fetch(`${options.api}/auth/change-password`, {
                method: "POST",
                signal: controller.signal,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token || ""}`,
                },
                body: JSON.stringify({
                    current_password: current,
                    new_password: next,
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    typeof data.detail === "string"
                        ? data.detail
                        : "The password could not be changed."
                );
            }

            status("Password updated successfully.", "ok");
            if (typeof options.onSuccess === "function") options.onSuccess();
            setTimeout(close, 1200);
        } catch (err) {
            status(
                err && err.name === "AbortError"
                    ? "The server is taking too long to respond. Please try again."
                    : err.message,
                "error"
            );
            button.disabled = false;
            button.textContent = "Update Password";
        } finally {
            clearTimeout(timer);
        }
    }

    function close() {
        if (!overlay) return;
        overlay.remove();
        overlay = null;
        document.removeEventListener("keydown", onKey);
    }

    window.TSAOpenPasswordDialog = function (opts) {
        options = opts || {};
        if (overlay) return;
        build();
    };
})();
