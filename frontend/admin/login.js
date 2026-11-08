/* School staff & portal login */
(function () {
    const API = window.SCHOOL_API || "http://127.0.0.1:8000";
    const TOKEN_KEY = "tsa_admin_token";
    const USER_KEY = "tsa_admin_user";
    const REQUEST_TIMEOUT = 30000;

    function targetFor(role) {
        if (role === "teacher") return "../teacher.html";
        if (role === "admissions") return "../admissions-portal.html";
        if (role === "parent") return "../parent.html";
        if (role === "student") return "../portal.html";
        return "dashboard.html";
    }

    function storageFor(role) {
        if (role === "teacher") return ["tsa_teacher_token", "tsa_teacher_user"];
        if (role === "admissions") return ["tsa_admissions_token", "tsa_admissions_user"];
        if (role === "parent") return ["tsa_parent_token", "tsa_parent_user"];
        if (role === "student") return ["tsa_portal_token", "tsa_portal_user"];
        return [TOKEN_KEY, USER_KEY];
    }

    // Already signed in? Go straight to the right place.
    const SESSIONS = [
        ["tsa_admin_token", "tsa_admin_user"],
        ["tsa_teacher_token", "tsa_teacher_user"],
        ["tsa_admissions_token", "tsa_admissions_user"],
        ["tsa_parent_token", "tsa_parent_user"],
        ["tsa_portal_token", "tsa_portal_user"],
    ];

    for (const [tokenKey, userKey] of SESSIONS) {
        if (!localStorage.getItem(tokenKey)) continue;

        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(userKey) || "null");
        } catch (err) {
            saved = null;
        }

        if (!saved || !saved.role) continue;
        if (!["admin", "owner", "teacher", "admissions", "parent", "student"].includes(saved.role)) {
            continue;
        }

        // Only honour a token when it sits in the slot that belongs to its
        // role. Otherwise an old teacher/student token could send this page
        // to the dashboard, which then bounces back here — an endless loop.
        const expectedTokenKey = storageFor(saved.role)[0];
        if (expectedTokenKey !== tokenKey) continue;

        window.location.replace(targetFor(saved.role));
        return;
    }

    const form = document.getElementById("loginForm");
    const errorBox = document.getElementById("error");
    const submitBtn = document.getElementById("submitBtn");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorBox.textContent = "";

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        if (!email || !password) {
            errorBox.textContent = "Email and password are required.";
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Signing in…";

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        try {
            const response = await fetch(`${API}/auth/login`, {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            let data = null;
            try {
                data = await response.json();
            } catch (ignored) {
                // non-JSON response
            }

            if (!response.ok) {
                const detail = data && data.detail;
                throw new Error(
                    typeof detail === "string"
                        ? detail
                        : "Login failed. Please try again."
                );
            }

            if (!data || !data.user || !data.user.role) {
                throw new Error("This account could not be signed in.");
            }

            const role = data.user.role;
            if (!["admin", "owner", "teacher", "admissions", "parent", "student"].includes(role)) {
                throw new Error("This account does not have access to a portal.");
            }

            const [tokenKey, userKey] = storageFor(role);
            localStorage.setItem(tokenKey, data.access_token);
            localStorage.setItem(userKey, JSON.stringify(data.user));
            window.location.replace(targetFor(role));
        } catch (error) {
            errorBox.textContent = error.name === "AbortError"
                ? "The server is taking too long to respond. Please check the database connection and try again."
                : error.message;
            submitBtn.disabled = false;
            submitBtn.textContent = "Sign In";
        } finally {
            clearTimeout(timer);
        }
    });
})();
